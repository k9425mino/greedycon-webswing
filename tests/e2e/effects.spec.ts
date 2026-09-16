import { expect, test } from '@playwright/test';
import { io } from 'socket.io-client';
import type { Page } from '@playwright/test';
import { expectPhase, expectPhysicsReady, installHostProbe, readHostState } from './hostProbe';

// 플레이 중에는 조작 창이 숨겨진다. 오디오·세션 동작만 보는 검증은 버튼을 직접 호출한다.
async function clickHidden(page: Page, selector: string) {
  await page.locator(selector).evaluate((button: HTMLButtonElement) => button.click());
}

test.beforeEach(async ({ page }) => {
  await installHostProbe(page);
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const data = document.documentElement.dataset;
      data.oscillators = String(Number(data.oscillators ?? 0) + 1);
      return original.call(this);
    };
  });
});

test('빗나간 발사는 한 번 표시된 뒤 누르고 있어도 사라진다', async ({ page }) => {
  await page.goto('/?input=mouse');
  await expectPhysicsReady(page);
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');

  // 짧은 효과를 놓치지 않도록 발사 전에 프레임별 관찰을 예약한다. 부착하지 않는 발사라
  // 플레이가 시작되면 약 1.9초 뒤 낙하로 끝난다. 관찰 준비(동적 import)를 시작 전에 끝내
  // 그 시간이 플레이 구간을 먹지 않게 한다.
  await page.evaluate(async () => {
    const path = '/host/main.ts';
    const { readHostState } = await import(path);
    const deadline = performance.now() + 5000;
    const data = document.documentElement.dataset;
    function observe() {
      const effect = readHostState();
      if (effect.attached) data.missAttached = 'true';
      if (effect.beam) {
        if (data.missBeamGone === 'true') data.missBeamRefired = 'true';
        data.missBeamSeen = 'true';
        if (effect.beamOpacity < 0 || effect.beamOpacity > 1) data.invalidBeamOpacity = 'true';
      } else if (data.missBeamSeen === 'true' && data.missBeamGone !== 'true') {
        // 사라진 순간의 단계를 남긴다. 연출이 끝나서 사라진 것과 종료로 지워진 것을 구분한다.
        data.missBeamGone = 'true';
        data.missBeamGonePhase = effect.phase;
      }
      if (performance.now() < deadline) requestAnimationFrame(observe);
    }
    requestAnimationFrame(observe);
  });

  await page.locator('#btn-start').click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#crosshair')).toHaveAttribute('data-has-target', 'false');
  await page.mouse.down();
  await expect(page.locator('html')).toHaveAttribute('data-miss-beam-seen', 'true');

  // 브라우저 프레임 안에서 기록한 값으로 판정한다. 벽시계 대기 시점에 읽으면 실행 속도에 따라
  // 낙하 종료가 먼저 와서 결과가 뒤집힌다.
  await expect(page.locator('html')).toHaveAttribute('data-miss-beam-gone', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-miss-beam-gone-phase', 'playing');
  await page.waitForTimeout(300);
  await expect(page.locator('html')).not.toHaveAttribute('data-miss-beam-refired', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-miss-attached', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-invalid-beam-opacity', 'true');
  // 발사음 + 실패음. 줄이 손을 떠난 뒤 최대 사거리에서 실패하므로 발사음도 함께 난다.
  await expect(page.locator('html')).toHaveAttribute('data-oscillators', '2');
  await page.mouse.up();
});

test('발사 중 정지하면 임시 효과가 사라지고 재개 후 다시 발사할 수 있다', async ({ page }) => {
  await page.goto('/?input=mouse');
  await expectPhysicsReady(page);
  await page.locator('#btn-start').click();
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.18);
  // 100ms 발사 구간을 놓치지 않도록 브라우저 프레임 안에서 정지(Esc)를 보낸다.
  await page.evaluate(async () => {
    const path = '/host/main.ts';
    const { readHostState } = await import(path);
    const deadline = performance.now() + 5000;
    function check() {
      if (readHostState().firing) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      } else if (performance.now() < deadline) requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  });
  await page.mouse.down();
  await expectPhase(page, 'paused');
  await page.mouse.up();
  await expectPhase(page, 'paused');
  await page.waitForTimeout(300);
  const snapshot = () => readHostState(page);
  expect(await snapshot()).toMatchObject({ beam: false, flash: false });
  await page.locator('#btn-start').click();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.18);
  await page.mouse.down();
  await expect.poll(snapshot).toMatchObject({ attached: true });
  // 키보드 정지는 마우스 해제를 만들지 않아 부착 보존도 검증한다.
  await page.keyboard.press('Escape');
  expect(await snapshot()).toMatchObject({
    phase: 'paused',
    attached: true,
    beam: false,
    flash: false,
  });
  await page.mouse.up();
});

test('오디오 노드 생성 실패에도 발사·부착과 종료·재시작이 진행된다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    AudioContext.prototype.createOscillator = () => {
      throw new Error('test audio failure');
    };
  });
  await page.goto('/?input=mouse');
  await expectPhysicsReady(page);
  await page.locator('#btn-start').click();
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.18);
  await page.mouse.down();
  await expect
    .poll(() => readHostState(page))
    .toMatchObject({ attached: true, audioAvailable: false });
  await page.mouse.up();
  await expectPhase(page, 'gameOver', { timeout: 15000 });
  await page.locator('#btn-restart').click();
  await expectPhase(page, 'ready');
  expect(errors).toEqual([]);
});

test('플레이 중 폰 교체는 임시 효과를 정리한다', async ({ page, baseURL }) => {
  await page.goto('/');
  await expectPhysicsReady(page);
  await expect(page.locator('#invite-link')).toHaveAttribute('href', /invite=/);
  const invite = new URL(
    (await page.locator('#invite-link').getAttribute('href'))!,
  ).searchParams.get('invite');
  const controller = io(baseURL!, { forceNew: true });
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await new Promise<void>((resolve) =>
      controller.emit('session:join', { inviteToken: invite }, () => resolve()),
    );
    let seq = 0;
    timer = setInterval(() => {
      controller.emit('controller:status', {
        sensorAvailable: true,
        pageVisible: true,
      });
      controller.emit('controller:input', {
        seq: ++seq,
        orientation: [0, 0, 0, 1],
        pressed: false,
      });
    }, 50);
    await expect(page.locator('#btn-calibrate')).toBeEnabled();
    await page.locator('#btn-calibrate').click();
    await page.locator('#btn-start').click();
    await clickHidden(page, '#btn-switch-phone');
    await expectPhase(page, 'pairing');
    expect(await readHostState(page)).toMatchObject({ beam: false, flash: false });
  } finally {
    clearInterval(timer);
    controller.disconnect();
  }
});
