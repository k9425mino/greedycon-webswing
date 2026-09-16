import { expect, test, type Page } from '@playwright/test';
import { gameConfig } from '@shared/config';
import {
  expectAttachSeen,
  expectHostState,
  expectPhase,
  expectPhysicsReady,
  installHostProbe,
  readHostState,
  startAttachWatch,
} from './hostProbe';

// 폰에서 노트북까지의 실제 경로를 확인한다. 모의하는 것은 deviceorientation 이벤트뿐이고
// 터치 처리·전송·보정·표적 선택·물리는 모두 제품 코드를 그대로 지난다.

type Orientation = { alpha: number; beta: number; gamma: number };

type SwingState = {
  phase: string;
  swingPhase: string | null;
  failure: string | null;
  attachment: { point: [number, number, number]; distance: number; assisting: boolean } | null;
  position: [number, number, number] | null;
  velocity: [number, number, number] | null;
  // 화면에 그려지는 부착 줄. 카메라에서 본 두 끝점의 시선 각도가 0이면 한 점으로 겹쳐 보인다.
  rope: { visible: boolean; separationDeg: number; endpoint: [number, number, number] };
};

// 손목 장착 기준 자세에서 alpha는 위에서 본 반시계 회전이라 팔을 오른쪽으로 돌리면 줄어든다.
const FORWARD: Orientation = { alpha: 0, beta: 0, gamma: 0 };
const AIM_RIGHT_UP: Orientation = { alpha: -30, beta: 30, gamma: 0 };
const AIM_LEFT_UP: Orientation = { alpha: 30, beta: 30, gamma: 0 };
// 도로 한가운데서 위만 보면 건물(|x| >= 12m)에 걸릴 수 없다.
const AIM_SKY: Orientation = { alpha: 0, beta: 70, gamma: 0 };

async function mockPhoneSensor(page: Page) {
  await page.addInitScript(() => {
    const win = window as unknown as {
      __orientation: Orientation;
      DeviceOrientationEvent: { requestPermission?: () => Promise<string> };
    };
    win.__orientation = { alpha: 0, beta: 0, gamma: 0 };
    win.DeviceOrientationEvent.requestPermission = () => Promise.resolve('granted');
    setInterval(() => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', win.__orientation));
    }, 20);
  });
}

async function aimPhone(page: Page, orientation: Orientation) {
  await page.evaluate((next) => {
    (window as unknown as { __orientation: Orientation }).__orientation = next;
  }, orientation);
}

// 공용 관찰 함수에 스윙 물리·줄 표시 관찰을 덧붙인다.
async function exposeSwingState(page: Page) {
  await installHostProbe(
    page,
    `
        export function readSwingState() {
          return {
            phase,
            swingPhase: swing?.phase ?? null,
            failure: swing?.lastFailure ?? null,
            attachment: physics?.attachment ?? null,
            position: physics?.getPlayerPosition() ?? null,
            velocity: physics?.getPlayerVelocity() ?? null,
            rope: readRope(),
          };
        }

        // 줄은 앵커 높이까지 솟으면 저절로 풀린다. 부착 구간이 짧아 바깥에서 폴링하면
        // 놓치므로, 부착한 프레임부터 풀릴 때까지를 프레임마다 기록해 둔다.
        let swingRecord = null;
        export function startSwingRecording() {
          swingRecord = { samples: [], done: false };
          const record = swingRecord;
          function look() {
            const state = readSwingState();
            if (state.attachment) record.samples.push(state);
            else if (record.samples.length > 0) {
              record.done = true;
              return;
            }
            requestAnimationFrame(look);
          }
          requestAnimationFrame(look);
        }

        export function readSwingRecording() {
          return swingRecord ?? { samples: [], done: false };
        }

        function readRope() {
          // 부착 줄은 튜브 메시다. 시작 단면의 첫 정점과 끝 뭉치 위치로 화면에서의 벌어짐을 잰다.
          const positions = ropeStrand.core.geometry.getAttribute('position');
          // 한 번도 그리지 않은 가닥은 빈 geometry다(부착 전).
          if (!positions) return { visible: false, separationDeg: 0, endpoint: [0, 0, 0] };
          const camera = sceneHandle.camera.position;
          const viewRay = (point) => {
            const v = [point[0] - camera.x, point[1] - camera.y, point[2] - camera.z];
            const len = Math.hypot(v[0], v[1], v[2]) || 1;
            return [v[0] / len, v[1] / len, v[2] / len];
          };
          const tip = ropeStrand.tip.position;
          const endpoint = [tip.x, tip.y, tip.z];
          const a = viewRay([positions.getX(0), positions.getY(0), positions.getZ(0)]);
          const b = viewRay(endpoint);
          const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
          return {
            visible: ropeStrand.group.visible,
            separationDeg: (Math.acos(dot) * 180) / Math.PI,
            endpoint,
          };
        }
      `,
  );
}

function readSwingState(page: Page): Promise<SwingState> {
  return page.evaluate(async () => {
    const path = '/host/main.ts';
    return (await import(path)).readSwingState();
  });
}

async function startSwingRecording(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const path = '/host/main.ts';
    (await import(path)).startSwingRecording();
  });
}

// 한 번의 스윙이 끝날 때까지 기다렸다가 프레임별 표본을 돌려준다.
async function recordedSwing(page: Page): Promise<SwingState[]> {
  const read = () =>
    page.evaluate(async () => {
      const path = '/host/main.ts';
      return (await import(path)).readSwingRecording() as { samples: SwingState[]; done: boolean };
    });
  await expect.poll(async () => (await read()).done, { timeout: 10_000 }).toBe(true);
  return (await read()).samples;
}

// 조준각은 실제 발사에 쓰는 방향에서 그대로 되돌려 계산한다.
async function readAimAngles(page: Page): Promise<{ yawDeg: number; pitchDeg: number }> {
  const [dx, dy, dz] = (await readHostState(page)).aim;
  return {
    yawDeg: (Math.atan2(dx, -dz) * 180) / Math.PI,
    pitchDeg: (Math.asin(Math.max(-1, Math.min(1, dy))) * 180) / Math.PI,
  };
}

async function connectPhone(page: Page, inviteUrl: string) {
  await mockPhoneSensor(page);
  await page.goto(inviteUrl);
  await page.click('#btn-permission');
}

async function openHost(page: Page): Promise<string> {
  await exposeSwingState(page);
  await page.goto('/');
  await expectPhysicsReady(page, { timeout: 15_000 });
  await expect(page.locator('#invite-link')).toHaveAttribute('href', /.+/, { timeout: 5000 });
  const inviteUrl = await page.locator('#invite-link').getAttribute('href');
  if (!inviteUrl) throw new Error('invite url not rendered');
  return inviteUrl;
}

// 컨트롤러의 터치 영역 위에 포인터를 미리 올려둔다. 시작 직후 바로 누르기 위함이다.
async function hoverTouchArea(page: Page) {
  const box = await page.locator('#touch-area').boundingBox();
  if (!box) throw new Error('touch area not found');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

test('폰 입력: 보정·조준·터치 유지가 실제 물리 부착과 스윙으로 이어진다', async ({ browser }) => {
  test.setTimeout(90_000);
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const controllerContext = await browser.newContext();
  const controllerPage = await controllerContext.newPage();

  try {
    const inviteUrl = await openHost(hostPage);
    await connectPhone(controllerPage, inviteUrl);

    await expectHostState(
      hostPage,
      { controllerConnected: true, sensorAvailable: true },
      { timeout: 10_000 },
    );

    // 기준 자세에서 보정한다.
    await aimPhone(controllerPage, FORWARD);
    await hostPage.click('#btn-calibrate');
    await expectPhase(hostPage, 'ready', { timeout: 5000 });

    // 좌우 ±30도·위쪽 30도가 그대로 조준각에 나타난다.
    await aimPhone(controllerPage, AIM_RIGHT_UP);
    await expect.poll(async () => (await readAimAngles(hostPage)).yawDeg).toBeCloseTo(30, 0);
    expect((await readAimAngles(hostPage)).pitchDeg).toBeCloseTo(30, 0);
    await aimPhone(controllerPage, AIM_LEFT_UP);
    await expect.poll(async () => (await readAimAngles(hostPage)).yawDeg).toBeCloseTo(-30, 0);

    await aimPhone(controllerPage, AIM_RIGHT_UP);
    await hoverTouchArea(controllerPage);
    await hostPage.click('#btn-start');
    await expectPhase(hostPage, 'playing');

    // 표적 마커가 먼저 보이고, 터치를 유지하면 firing을 거쳐 실제 물리 부착까지 간다.
    await expect(hostPage.locator('#crosshair')).toHaveAttribute('data-has-target', 'true', {
      timeout: 3000,
    });
    await expect(hostPage.locator('#target-marker')).toBeVisible();

    await startSwingRecording(hostPage);
    await controllerPage.mouse.down();
    await expectHostState(hostPage, { pressed: true }, { timeout: 3000 });

    // 부착부터 줄이 풀릴 때까지를 브라우저 프레임 안에서 모은다. 줄은 앵커 높이까지
    // 솟으면 저절로 풀리므로 바깥에서 폴링하면 구간을 놓친다.
    const samples = await recordedSwing(hostPage);
    expect(samples.length).toBeGreaterThan(5);

    const attached = samples[0]!;
    expect(attached).toMatchObject({ swingPhase: 'attached', failure: null });
    const startY = attached.position![1];

    // 날아가던 줄이 걸린 뒤에도 부착 줄이 남고, 화면에서 한 점이 아니라 선으로 보인다.
    expect(attached.rope.visible).toBe(true);
    expect(attached.rope.separationDeg).toBeGreaterThan(1);
    // 줄 끝은 시각 보정 없이 실제 물리 앵커에 고정된다(정점 버퍼가 float32라 근사 비교).
    for (const axis of [0, 1, 2]) {
      expect(attached.rope.endpoint[axis]!).toBeCloseTo(attached.attachment!.point[axis]!, 3);
    }

    for (const sample of samples) {
      expect(sample.phase).toBe('playing');
      // 부착점은 움직이지 않는다(줄 표시 길이만 이동에 따라 변한다).
      for (const axis of [0, 1, 2]) {
        expect(sample.attachment!.point[axis]!).toBeCloseTo(attached.attachment!.point[axis]!, 3);
      }
      // 누르는 동안 줄 선이 계속 갱신돼 사라지지 않는다.
      expect(sample.rope.visible).toBe(true);
    }

    const zs = samples.map((sample) => sample.position![2]);
    // 실제로 전방(-Z)으로 이동하고, 전진 속도가 줄에 끌려 뒤집히지 않는다.
    expect(Math.min(...zs)).toBeLessThan(attached.position![2] - 3);
    expect(Math.min(...samples.map((sample) => -sample.velocity![2]))).toBeGreaterThan(0);
    // 위쪽 부착점에 걸면 낙하가 느려지는 데 그치지 않고 실제로 올라간다.
    expect(attached.attachment!.point[1]).toBeGreaterThan(startY);
    expect(Math.max(...samples.map((sample) => sample.position![1]))).toBeGreaterThan(startY);
    expect(Math.max(...samples.map((sample) => sample.velocity![1]))).toBeGreaterThan(0);

    // 손을 떼면 줄을 놓는다(이미 풀렸다면 그대로 idle이다).
    await controllerPage.mouse.up();
    await expectHostState(hostPage, { pressed: false }, { timeout: 3000 });
    await expect.poll(async () => (await readSwingState(hostPage)).attachment).toBeNull();
    expect((await readSwingState(hostPage)).swingPhase).toBe('idle');
  } finally {
    await controllerContext.close();
    await hostContext.close();
  }
});

test('폰 입력: 빗나가면 부착되지 않고, 누르는 동안 반복 발사하지 않으며, 떼고 다시 누르면 재시도한다', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const controllerContext = await browser.newContext();
  const controllerPage = await controllerContext.newPage();

  try {
    const inviteUrl = await openHost(hostPage);
    await connectPhone(controllerPage, inviteUrl);
    await expectHostState(hostPage, { sensorAvailable: true }, { timeout: 10_000 });

    await aimPhone(controllerPage, FORWARD);
    await hostPage.click('#btn-calibrate');
    await expectPhase(hostPage, 'ready', { timeout: 5000 });

    await aimPhone(controllerPage, AIM_SKY);
    await hoverTouchArea(controllerPage);
    await hostPage.click('#btn-start');
    await expectPhase(hostPage, 'playing');
    await expect(hostPage.locator('#crosshair')).toHaveAttribute('data-has-target', 'false');

    await controllerPage.mouse.down();
    await expect(hostPage.locator('#hud-web-status')).toHaveText('빗나감', { timeout: 3000 });
    expect((await readSwingState(hostPage)).failure).toBe('noTarget');
    expect((await readSwingState(hostPage)).attachment).toBeNull();

    // 누르는 동안에는 표적을 다시 겨눠도 재발사하지 않는다.
    await aimPhone(controllerPage, AIM_RIGHT_UP);
    await hostPage.waitForTimeout(100);
    expect(await readSwingState(hostPage)).toMatchObject({
      swingPhase: 'releasedRequired',
      attachment: null,
    });

    // 걸지 못한 발사는 낙하로 끝난다. 줄이 최대 사거리까지 날아가는 시간 때문에 한 판 안에
    // 빗나감과 재시도를 모두 담을 수 없어, 손을 떼고 새 판에서 재발사가 되는지 본다.
    await controllerPage.mouse.up();
    // 재시도 전에 폰의 해제가 호스트까지 전달됐는지 확인한다.
    await expectHostState(hostPage, { pressed: false });
    await expectPhase(hostPage, 'gameOver', { timeout: 5000 });
    await hostPage.click('#btn-restart');
    await expectPhase(hostPage, 'ready', { timeout: 5000 });
    await expect.poll(async () => (await readSwingState(hostPage)).swingPhase).toBe('idle');
    await hostPage.click('#btn-start');
    await expectPhase(hostPage, 'playing');
    await startAttachWatch(hostPage);
    await controllerPage.mouse.down();
    await expectAttachSeen(hostPage, { timeout: 5000 });
    await controllerPage.mouse.up();
  } finally {
    await controllerContext.close();
    await hostContext.close();
  }
});

test('폰 입력: 중지 후 재개하면 이전 줄이 남지 않고 자동 부착하지 않는다', async ({ browser }) => {
  test.setTimeout(90_000);
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const controllerContext = await browser.newContext();
  const controllerPage = await controllerContext.newPage();

  try {
    const inviteUrl = await openHost(hostPage);
    await connectPhone(controllerPage, inviteUrl);
    await expectHostState(hostPage, { sensorAvailable: true }, { timeout: 10_000 });

    await aimPhone(controllerPage, FORWARD);
    await hostPage.click('#btn-calibrate');
    await expectPhase(hostPage, 'ready', { timeout: 5000 });

    await aimPhone(controllerPage, AIM_RIGHT_UP);
    await hoverTouchArea(controllerPage);
    await hostPage.click('#btn-start');
    await startAttachWatch(hostPage);
    await controllerPage.mouse.down();
    await expectAttachSeen(hostPage, { timeout: 5000 });

    // 매달린 채로 운영자가 중지한다(모달을 없앤 뒤로 플레이 중 정지는 Esc다). 폰 입력이
    // 살아 있으면 곧바로 재보정 단계로 넘어간다.
    await hostPage.keyboard.press('Escape');
    await expect.poll(() => readHostState(hostPage)).not.toMatchObject({ phase: 'playing' });

    // 재보정은 손을 뗀 뒤에만 가능하다.
    await controllerPage.mouse.up();
    await expectPhase(hostPage, 'calibrating', { timeout: 5000 });
    await hostPage.click('#btn-calibrate');
    await expectPhase(hostPage, 'ready');

    // 다시 손가락을 올린 채로는 시작할 수 없다(누름 상태에서의 자동 발사 차단).
    await controllerPage.mouse.down();
    await expectHostState(hostPage, { pressed: true }, { timeout: 3000 });
    await expect(hostPage.locator('#btn-start')).toBeDisabled();

    await controllerPage.mouse.up();
    await expect(hostPage.locator('#btn-start')).toBeEnabled({ timeout: 3000 });
    await hostPage.click('#btn-start');
    await expectPhase(hostPage, 'playing');

    // 재개 직후에는 이전 줄이 사라져 있고, 누르지 않는 동안 스스로 부착하지 않는다.
    expect(await readSwingState(hostPage)).toMatchObject({ swingPhase: 'idle', attachment: null });
    await hostPage.waitForTimeout(500);
    expect((await readSwingState(hostPage)).attachment).toBeNull();
  } finally {
    await controllerContext.close();
    await hostContext.close();
  }
});
