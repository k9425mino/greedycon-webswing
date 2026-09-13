import { expect, test } from '@playwright/test';
import { io } from 'socket.io-client';

// 테스트 응답에만 읽기 전용 관찰 함수를 붙인다. 제품 코드에는 테스트 훅을 두지 않는다.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const data = document.documentElement.dataset;
      data.oscillators = String(Number(data.oscillators ?? 0) + 1);
      data.activeOscillators = String(Number(data.activeOscillators ?? 0) + 1);
      const osc = original.call(this);
      const disconnect = osc.disconnect.bind(osc);
      osc.disconnect = () => {
        data.activeOscillators = String(Number(data.activeOscillators) - 1);
        disconnect();
      };
      return osc;
    };
  });
  await page.route('**/host/main.ts', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `
        export function readEffects() {
          return { phase, firing: swing?.phase === 'firing',
            beam: fireBeamLine.visible, beamOpacity: fireBeamLine.material.opacity,
            flash: attachFlash.visible,
            attached: attachedPoint !== null, audioAvailable: sfx.available };
        }
      `,
    });
  });
});

test('빗나간 발사는 한 번 표시된 뒤 누르고 있어도 사라진다', async ({ page }) => {
  await page.goto('/?input=mouse');
  await expect(page.locator('#status-physics')).toHaveText('준비됨');
  await page.locator('#btn-start').click();
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#crosshair')).toHaveAttribute('data-has-target', 'false');

  // 짧은 효과를 놓치지 않도록 발사 전에 프레임별 관찰을 예약한다.
  await page.evaluate(async () => {
    const path = '/host/main.ts';
    const { readEffects } = await import(path);
    const deadline = performance.now() + 1500;
    function observe() {
      const effect = readEffects();
      if (effect.beam) {
        document.documentElement.dataset.missBeamSeen = 'true';
        if (effect.beamOpacity < 0 || effect.beamOpacity > 1) {
          document.documentElement.dataset.invalidBeamOpacity = 'true';
        }
      }
      if (performance.now() < deadline) requestAnimationFrame(observe);
    }
    requestAnimationFrame(observe);
  });
  await page.mouse.down();
  await expect(page.locator('html')).toHaveAttribute('data-miss-beam-seen', 'true');
  await page.waitForTimeout(400);
  expect(
    await page.evaluate(async () => {
      const path = '/host/main.ts';
      return (await import(path)).readEffects();
    }),
  ).toMatchObject({ phase: 'playing', beam: false, attached: false });
  await expect(page.locator('html')).not.toHaveAttribute('data-invalid-beam-opacity', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-oscillators', '2');
  await page.mouse.up();
});

test('발사 중 정지하면 임시 효과가 사라지고 재개 후 다시 발사할 수 있다', async ({ page }) => {
  await page.goto('/?input=mouse');
  await expect(page.locator('#status-physics')).toHaveText('준비됨');
  await page.locator('#btn-start').click();
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.35);
  // 100ms 발사 구간을 놓치지 않도록 브라우저 프레임 안에서 정지 버튼을 누른다.
  await page.evaluate(async () => {
    const path = '/host/main.ts';
    const { readEffects } = await import(path);
    const deadline = performance.now() + 5000;
    function check() {
      if (readEffects().firing) {
        document.querySelector<HTMLButtonElement>('#btn-stop')!.click();
      } else if (performance.now() < deadline) requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  });
  await page.mouse.down();
  await expect(page.locator('#status-phase')).toHaveText('paused');
  await page.mouse.up();
  await expect(page.locator('#status-phase')).toHaveText('paused');
  await page.waitForTimeout(300);
  const snapshot = () =>
    page.evaluate(async () => {
      const path = '/host/main.ts';
      return (await import(path)).readEffects();
    });
  expect(await snapshot()).toMatchObject({ beam: false, flash: false });
  await page.locator('#btn-start').click();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.35);
  await page.mouse.down();
  await expect.poll(snapshot).toMatchObject({ attached: true });
  // 네이티브 버튼 호출은 마우스 해제를 만들지 않아 부착 보존도 검증한다.
  await page.locator('#btn-stop').evaluate((button: HTMLButtonElement) => button.click());
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
  await expect(page.locator('#status-physics')).toHaveText('준비됨');
  await page.locator('#btn-start').click();
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.35);
  await page.mouse.down();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = '/host/main.ts';
        return (await import(path)).readEffects();
      }),
    )
    .toMatchObject({ attached: true, audioAvailable: false });
  await page.mouse.up();
  await expect(page.locator('#status-phase')).toHaveText('gameOver', { timeout: 15000 });
  await page.locator('#btn-restart').click();
  await expect(page.locator('#status-phase')).toHaveText('ready');
  expect(errors).toEqual([]);
});

test('실제 AudioContext에서 음소거 해제와 정지 후 음소거 해제를 구분한다', async ({ page }) => {
  await page.goto('/?input=mouse');
  await expect(page.locator('#status-physics')).toHaveText('준비됨');
  await page.locator('#btn-start').click();
  await expect(page.locator('html')).toHaveAttribute('data-oscillators', '1');
  await page.locator('#btn-mute').click();
  await page.locator('#btn-mute').click();
  await expect(page.locator('html')).toHaveAttribute('data-oscillators', '2');
  await page.locator('#btn-stop').click();
  await page.locator('#btn-mute').click();
  await page.locator('#btn-mute').click();
  await expect(page.locator('html')).toHaveAttribute('data-oscillators', '2');
  await expect(page.locator('html')).toHaveAttribute('data-active-oscillators', '0');
});

test('플레이 중 폰 교체는 바람과 임시 효과를 정리한다', async ({ page, baseURL }) => {
  await page.goto('/');
  await expect(page.locator('#status-physics')).toHaveText('준비됨');
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
        sensorHz: 20,
        sendHz: 20,
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
    await expect(page.locator('html')).toHaveAttribute('data-active-oscillators', '1');
    await page.locator('#btn-switch-phone').click();
    await expect(page.locator('#status-phase')).toHaveText('pairing');
    await expect(page.locator('html')).toHaveAttribute('data-active-oscillators', '0');
    expect(
      await page.evaluate(async () => {
        const path = '/host/main.ts';
        return (await import(path)).readEffects();
      }),
    ).toMatchObject({ beam: false, flash: false });
  } finally {
    clearInterval(timer);
    controller.disconnect();
  }
});
