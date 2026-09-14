import { expect, test, type Page } from '@playwright/test';

// 폰에서 노트북까지의 실제 경로를 확인한다. 모의하는 것은 deviceorientation 이벤트뿐이고
// 터치 처리·전송·보정·표적 선택·물리는 모두 제품 코드를 그대로 지난다.

type Orientation = { alpha: number; beta: number; gamma: number };

type SwingState = {
  phase: string;
  swingPhase: string | null;
  failure: string | null;
  attachment: { point: [number, number, number]; length: number; distance: number } | null;
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

// 테스트 응답에만 읽기 전용 관찰 함수를 붙인다. 제품 코드에는 테스트 훅을 두지 않는다.
async function exposeSwingState(page: Page) {
  await page.route('**/host/main.ts', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
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

        function readRope() {
          const positions = ropeLine.geometry.getAttribute('position');
          const camera = sceneHandle.camera.position;
          const viewRay = (index) => {
            const v = [
              positions.getX(index) - camera.x,
              positions.getY(index) - camera.y,
              positions.getZ(index) - camera.z,
            ];
            const len = Math.hypot(v[0], v[1], v[2]) || 1;
            return [v[0] / len, v[1] / len, v[2] / len];
          };
          const a = viewRay(0);
          const b = viewRay(1);
          const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
          return {
            visible: ropeLine.visible,
            separationDeg: (Math.acos(dot) * 180) / Math.PI,
            endpoint: [positions.getX(1), positions.getY(1), positions.getZ(1)],
          };
        }
      `,
    });
  });
}

function readSwingState(page: Page): Promise<SwingState> {
  return page.evaluate(async () => {
    const path = '/host/main.ts';
    return (await import(path)).readSwingState();
  });
}

async function readAimAngles(page: Page): Promise<{ yawDeg: number; pitchDeg: number }> {
  const text = (await page.locator('#diag-aim').textContent()) ?? '';
  const [yaw, pitch] = text.match(/-?\d+\.\d/g)?.map(Number) ?? [];
  return { yawDeg: yaw ?? NaN, pitchDeg: pitch ?? NaN };
}

async function connectPhone(page: Page, inviteUrl: string) {
  await mockPhoneSensor(page);
  await page.goto(inviteUrl);
  await page.click('#btn-permission');
}

async function openHost(page: Page): Promise<string> {
  await exposeSwingState(page);
  await page.goto('/');
  await expect(page.locator('#status-physics')).toHaveText('준비됨', { timeout: 15_000 });
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

    await expect(hostPage.locator('#status-connection')).toHaveText('연결됨', { timeout: 10_000 });
    await expect(hostPage.locator('#status-sensor')).toHaveText('정상', { timeout: 10_000 });

    // 기준 자세에서 보정한다.
    await aimPhone(controllerPage, FORWARD);
    await hostPage.click('#btn-calibrate');
    await expect(hostPage.locator('#status-phase')).toHaveText('ready', { timeout: 5000 });

    // 좌우 ±30도·위쪽 30도가 그대로 조준각에 나타난다.
    await aimPhone(controllerPage, AIM_RIGHT_UP);
    await expect.poll(async () => (await readAimAngles(hostPage)).yawDeg).toBeCloseTo(30, 0);
    expect((await readAimAngles(hostPage)).pitchDeg).toBeCloseTo(30, 0);
    await aimPhone(controllerPage, AIM_LEFT_UP);
    await expect.poll(async () => (await readAimAngles(hostPage)).yawDeg).toBeCloseTo(-30, 0);

    await aimPhone(controllerPage, AIM_RIGHT_UP);
    await hoverTouchArea(controllerPage);
    await hostPage.click('#btn-start');
    await expect(hostPage.locator('#status-phase')).toHaveText('playing');

    // 표적 마커가 먼저 보이고, 터치를 유지하면 firing을 거쳐 실제 물리 부착까지 간다.
    await expect(hostPage.locator('#crosshair')).toHaveAttribute('data-has-target', 'true', {
      timeout: 3000,
    });
    await expect(hostPage.locator('#target-marker')).toBeVisible();
    await expect(hostPage.locator('#diag-target')).toContainText('있음');

    await controllerPage.mouse.down();
    await expect(hostPage.locator('#status-touch')).toHaveText('누름', { timeout: 3000 });
    await expect(hostPage.locator('#hud-web-status')).toHaveText('부착됨', { timeout: 5000 });
    await expect(hostPage.locator('#diag-web-phase')).toHaveText('attached');
    await expect(hostPage.locator('#diag-attach')).toContainText('부착');
    await expect(hostPage.locator('#diag-web-failure')).toHaveText('없음');

    const attached = await readSwingState(hostPage);
    expect(attached.attachment).not.toBeNull();
    const startY = attached.position![1];

    // 발사 연출(100ms)이 끝난 뒤에도 부착 줄이 남고, 화면에서 한 점이 아니라 선으로 보인다.
    await expect(hostPage.locator('#hud-web-status')).toHaveText('부착됨');
    expect(attached.rope.visible).toBe(true);
    expect(attached.rope.separationDeg).toBeGreaterThan(1);
    // 줄 끝은 시각 보정 없이 실제 물리 앵커에 고정된다(정점 버퍼가 float32라 근사 비교).
    for (const axis of [0, 1, 2]) {
      expect(attached.rope.endpoint[axis]!).toBeCloseTo(attached.attachment!.point[axis]!, 3);
    }

    // 3초 동안 매달린 채 유지되는지 확인한다. playing인지만 보지 않고 위치·앵커 거리를 함께 기록한다.
    const samples: SwingState[] = [];
    for (let i = 0; i < 12; i++) {
      await hostPage.waitForTimeout(250);
      samples.push(await readSwingState(hostPage));
    }
    for (const sample of samples) {
      expect(sample.phase).toBe('playing');
      expect(sample.attachment).not.toBeNull();
      // 줄 길이가 양방향으로 고정된다. 자유낙하였다면 앵커 거리가 줄 길이를 크게 넘어선다.
      expect(Math.abs(sample.attachment!.distance - sample.attachment!.length)).toBeLessThanOrEqual(
        0.1,
      );
      // 누르는 동안 줄 선이 계속 갱신돼 사라지지 않는다.
      expect(sample.rope.visible).toBe(true);
    }
    const ys = samples.map((sample) => sample.position![1]);
    const zs = samples.map((sample) => sample.position![2]);
    // 중력으로 내려갔다가 줄에 밀려 다시 올라오는 구간이 있어야 스윙이다.
    // 자유낙하 여부는 위의 phase 검사가 이미 거른다.
    expect(Math.min(...ys)).toBeLessThan(startY - 1);
    expect(Math.max(...ys.slice(ys.indexOf(Math.min(...ys))))).toBeGreaterThan(
      Math.min(...ys) + 0.5,
    );
    // 실제로 전방(-Z)으로 이동한다.
    expect(Math.min(...zs)).toBeLessThan(attached.position![2] - 5);

    // 손을 떼면 줄을 놓는다.
    await controllerPage.mouse.up();
    await expect(hostPage.locator('#status-touch')).toHaveText('해제', { timeout: 3000 });
    await expect.poll(async () => (await readSwingState(hostPage)).attachment).toBeNull();
    await expect(hostPage.locator('#diag-web-phase')).toHaveText('idle');
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
    await expect(hostPage.locator('#status-sensor')).toHaveText('정상', { timeout: 10_000 });

    await aimPhone(controllerPage, FORWARD);
    await hostPage.click('#btn-calibrate');
    await expect(hostPage.locator('#status-phase')).toHaveText('ready', { timeout: 5000 });

    await aimPhone(controllerPage, AIM_SKY);
    await hoverTouchArea(controllerPage);
    await hostPage.click('#btn-start');
    await expect(hostPage.locator('#status-phase')).toHaveText('playing');
    await expect(hostPage.locator('#crosshair')).toHaveAttribute('data-has-target', 'false');

    await controllerPage.mouse.down();
    await expect(hostPage.locator('#hud-web-status')).toHaveText('빗나감', { timeout: 3000 });
    await expect(hostPage.locator('#diag-web-failure')).toHaveText('표적 없음');
    expect((await readSwingState(hostPage)).attachment).toBeNull();

    // 누르는 동안에는 표적을 다시 겨눠도 재발사하지 않는다.
    await aimPhone(controllerPage, AIM_RIGHT_UP);
    await hostPage.waitForTimeout(600);
    expect(await readSwingState(hostPage)).toMatchObject({
      swingPhase: 'releasedRequired',
      attachment: null,
    });

    // 떼고 다시 누르면 재시도해 부착한다.
    await controllerPage.mouse.up();
    await expect(hostPage.locator('#diag-web-phase')).toHaveText('idle', { timeout: 3000 });
    await controllerPage.mouse.down();
    await expect(hostPage.locator('#hud-web-status')).toHaveText('부착됨', { timeout: 5000 });
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
    await expect(hostPage.locator('#status-sensor')).toHaveText('정상', { timeout: 10_000 });

    await aimPhone(controllerPage, FORWARD);
    await hostPage.click('#btn-calibrate');
    await expect(hostPage.locator('#status-phase')).toHaveText('ready', { timeout: 5000 });

    await aimPhone(controllerPage, AIM_RIGHT_UP);
    await hoverTouchArea(controllerPage);
    await hostPage.click('#btn-start');
    await controllerPage.mouse.down();
    await expect(hostPage.locator('#hud-web-status')).toHaveText('부착됨', { timeout: 5000 });

    // 매달린 채로 운영자가 중지한다. 폰 입력이 살아 있으면 곧바로 재보정 단계로 넘어간다.
    await hostPage.click('#btn-stop');
    await expect(hostPage.locator('#status-phase')).not.toHaveText('playing', { timeout: 5000 });
    // 플레이가 끝나도 마지막 발사 결과는 진단에 남는다.
    await expect(hostPage.locator('#diag-web-phase')).toHaveText('attached');
    await expect(hostPage.locator('#diag-attach')).toContainText('부착');

    // 재보정은 손을 뗀 뒤에만 가능하다.
    await controllerPage.mouse.up();
    await expect(hostPage.locator('#status-phase')).toHaveText('calibrating', { timeout: 5000 });
    await hostPage.click('#btn-calibrate');
    await expect(hostPage.locator('#status-phase')).toHaveText('ready');

    // 다시 손가락을 올린 채로는 시작할 수 없다(누름 상태에서의 자동 발사 차단).
    await controllerPage.mouse.down();
    await expect(hostPage.locator('#status-touch')).toHaveText('누름', { timeout: 3000 });
    await expect(hostPage.locator('#btn-start')).toBeDisabled();

    await controllerPage.mouse.up();
    await expect(hostPage.locator('#btn-start')).toBeEnabled({ timeout: 3000 });
    await hostPage.click('#btn-start');
    await expect(hostPage.locator('#status-phase')).toHaveText('playing');

    // 재개 직후에는 이전 줄이 사라져 있고, 누르지 않는 동안 스스로 부착하지 않는다.
    expect(await readSwingState(hostPage)).toMatchObject({ swingPhase: 'idle', attachment: null });
    await hostPage.waitForTimeout(500);
    expect((await readSwingState(hostPage)).attachment).toBeNull();
  } finally {
    await controllerContext.close();
    await hostContext.close();
  }
});
