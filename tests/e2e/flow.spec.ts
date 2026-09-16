import { expect, test, type Page } from '@playwright/test';
import { io } from 'socket.io-client';
import { expectHostState, expectPhase, installHostProbe, readHostState } from './hostProbe';

async function mockOrientationPermission(page: Page, result: 'granted' | 'denied' | 'missing') {
  await page.addInitScript((mockResult) => {
    setInterval(() => {
      window.dispatchEvent(
        new DeviceOrientationEvent('deviceorientation', { alpha: 10, beta: 5, gamma: 0 }),
      );
    }, 50);
    if (mockResult === 'missing') return; // requestPermission 자체가 없는 환경(Android 등) 시뮬레이션
    const win = window as unknown as {
      DeviceOrientationEvent: { requestPermission?: () => Promise<string> };
    };
    win.DeviceOrientationEvent.requestPermission = () =>
      Promise.resolve(mockResult === 'granted' ? 'granted' : 'denied');
  }, result);
}

async function dispatchOrientation(page: Page, alpha: number, beta: number, gamma: number) {
  await page.evaluate(
    ({ alpha, beta, gamma }) => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha, beta, gamma }));
    },
    { alpha, beta, gamma },
  );
}

test('서버는 역할이 다른 입력과 잘못된 상태를 중계하지 않는다', async ({ baseURL }) => {
  const host = io(baseURL!, { forceNew: true });
  const controller = io(baseURL!, { forceNew: true });
  try {
    host.emit('session:create', {}); // ACK 누락 요청이 서버를 종료시키지 않아야 한다.
    const session = await host.timeout(5000).emitWithAck('session:create', {});
    expect(session.ok).toBe(true);
    const joined = await controller
      .timeout(5000)
      .emitWithAck('session:join', { inviteToken: session.inviteToken });
    expect(joined.ok).toBe(true);
    const inputs: unknown[] = [];
    const statuses: unknown[] = [];
    const hostStates: unknown[] = [];
    host.on('controller:input', (frame) => inputs.push(frame));
    host.on('controller:status', (status) => statuses.push(status));
    controller.on('host:state', (state) => hostStates.push(state));
    host.emit('host:state', null);
    host.emit('host:state', { phase: 'unknown', calibrated: false });
    host.emit('host:state', { phase: 'playing', calibrated: 'true' });
    host.emit('host:state', { phase: 'paused', calibrated: false, reason: 'unknown' });
    const state = { phase: 'paused', calibrated: false, reason: 'operator' };
    host.emit('host:state', state);
    await expect.poll(() => hostStates.length).toBeGreaterThan(0);
    await host.timeout(5000).emitWithAck('session:create', {});
    await expect.poll(() => hostStates.at(-1)).toEqual(state);
    expect(hostStates).toEqual([state]);
    host.emit('controller:input', { seq: 1, orientation: [0, 0, 0, 1], pressed: true });
    await host.timeout(5000).emitWithAck('session:create', {});
    controller.emit('controller:status', null);
    controller.emit('controller:input', { seq: -1, orientation: [0, 0, 0, 1], pressed: true });
    const frame = { seq: 2, orientation: [0, 0, 0, 1], pressed: false };
    controller.emit('controller:input', frame);
    await expect.poll(() => inputs.length).toBe(1);
    expect(inputs).toEqual([frame]);
    expect(statuses).toEqual([]);
  } finally {
    host.disconnect();
    controller.disconnect();
  }
});

test('살아 있는 소켓을 복구하면 이전 연결을 종료하고 새 입력 순번을 받을 수 있다', async ({
  baseURL,
}) => {
  const host = io(baseURL!, { forceNew: true });
  const controller = io(baseURL!, { forceNew: true });
  const replacement = io(baseURL!, { forceNew: true });
  const replacementHost = io(baseURL!, { forceNew: true });
  try {
    const session = await host.timeout(5000).emitWithAck('session:create', {});
    const statuses: { controllerConnected: boolean }[] = [];
    host.on('session:status', (status) => statuses.push(status));
    const joined = await controller
      .timeout(5000)
      .emitWithAck('session:join', { inviteToken: session.inviteToken });
    await expect.poll(() => statuses.map((status) => status.controllerConnected)).toEqual([true]);
    statuses.length = 0;
    const inputs: unknown[] = [];
    host.on('controller:input', (frame) => inputs.push(frame));
    const resumed = await replacement
      .timeout(5000)
      .emitWithAck('session:resume', { token: joined.controllerToken });
    expect(resumed.ok).toBe(true);
    await expect.poll(() => controller.connected).toBe(false);
    await expect
      .poll(() => statuses.map((status) => status.controllerConnected))
      .toEqual([false, true]);
    const frame = { seq: 1, orientation: [0, 0, 0, 1], pressed: false };
    replacement.emit('controller:input', frame);
    await expect.poll(() => inputs).toEqual([frame]);

    const hostResumed = await replacementHost
      .timeout(5000)
      .emitWithAck('session:resume', { token: session.hostToken });
    expect(hostResumed.ok).toBe(true);
    await expect.poll(() => host.connected).toBe(false);
    const newHostInputs: unknown[] = [];
    replacementHost.on('controller:input', (input) => newHostInputs.push(input));
    replacement.emit('controller:input', { ...frame, seq: 2 });
    await expect.poll(() => newHostInputs).toEqual([{ ...frame, seq: 2 }]);
  } finally {
    host.disconnect();
    controller.disconnect();
    replacement.disconnect();
    replacementHost.disconnect();
  }
});

test('연결부터 입력 표시, 두 번째 컨트롤러 거절까지', async ({ browser }) => {
  test.setTimeout(90_000);
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  await installHostProbe(hostPage);
  await hostPage.goto('/');

  await expect(hostPage.locator('#invite-link')).toHaveAttribute('href', /.+/, { timeout: 5000 });
  const inviteUrl = await hostPage.locator('#invite-link').getAttribute('href');
  expect(inviteUrl).toBeTruthy();

  const controllerContext = await browser.newContext();
  const controllerPage = await controllerContext.newPage();
  await mockOrientationPermission(controllerPage, 'granted');
  await controllerPage.goto(inviteUrl!);
  await controllerPage.click('#btn-permission');
  await controllerPage.waitForTimeout(100);
  await dispatchOrientation(controllerPage, 10, 5, 0);

  await expectHostState(
    hostPage,
    { controllerConnected: true, sensorAvailable: true },
    { timeout: 5000 },
  );

  // 터치 유지 -> 호스트 크로스헤어가 눌림으로 반영된다.
  const touchArea = controllerPage.locator('#touch-area');
  const box = await touchArea.boundingBox();
  await controllerPage.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await controllerPage.mouse.down();
  await expect(hostPage.locator('#crosshair')).toHaveAttribute('data-pressed', 'true', {
    timeout: 5000,
  });
  await controllerPage.mouse.up();
  await expect(hostPage.locator('#crosshair')).toHaveAttribute('data-pressed', 'false', {
    timeout: 5000,
  });

  // 정면 보정: 터치가 해제된 상태에서만 가능하다.
  await hostPage.click('#btn-calibrate');
  await expectPhase(hostPage, 'ready', { timeout: 5000 });

  // 두 번째 컨트롤러는 거절된다(OP-01).
  const secondControllerContext = await browser.newContext();
  const secondControllerPage = await secondControllerContext.newPage();
  await mockOrientationPermission(secondControllerPage, 'granted');
  await secondControllerPage.goto(inviteUrl!);
  await secondControllerPage.click('#btn-permission');
  await expect(secondControllerPage.locator('#status-message')).toContainText('이미 다른 폰', {
    timeout: 5000,
  });

  await secondControllerContext.close();

  // 연결 중단: 컨트롤러를 닫으면 호스트는 pairing으로 돌아간다.
  await hostPage.click('#btn-start');
  await expectPhase(hostPage, 'playing');
  await controllerContext.setOffline(true);
  await expect.poll(() => readHostState(hostPage)).not.toMatchObject({ phase: 'playing' });
  await controllerContext.setOffline(false);
  await expectPhase(hostPage, 'calibrating', { timeout: 15000 });
  await hostPage.click('#btn-calibrate');
  await expectPhase(hostPage, 'ready');
  await hostPage.reload();
  await expectPhase(hostPage, 'calibrating');
  await hostPage.click('#btn-calibrate');
  await expectPhase(hostPage, 'ready');
  await controllerPage.reload();
  await controllerPage.click('#btn-permission');
  await expectPhase(hostPage, 'calibrating');
  await hostPage.click('#btn-calibrate');
  await expectPhase(hostPage, 'ready');
  await hostContext.setOffline(true);
  await expectHostState(hostPage, { controllerConnected: false }, { timeout: 45_000 });
  await hostContext.setOffline(false);
  await expectPhase(hostPage, 'calibrating', { timeout: 15000 });
  await hostPage.click('#btn-calibrate');
  await expectPhase(hostPage, 'ready');
  await hostPage.click('#btn-start');
  await controllerContext.close();
  await expectPhase(hostPage, 'paused', { timeout: 5000 });

  await hostContext.close();
});

test('같은 폰에서 다른 QR을 열면 이전 세션 대신 새 호스트에 연결한다', async ({
  browser,
  baseURL,
}) => {
  const firstHost = io(baseURL!, { forceNew: true });
  const secondHost = io(baseURL!, { forceNew: true });
  const context = await browser.newContext();
  try {
    const first = await firstHost.timeout(5000).emitWithAck('session:create', {});
    const second = await secondHost.timeout(5000).emitWithAck('session:create', {});
    const page = await context.newPage();
    await mockOrientationPermission(page, 'granted');
    await page.goto(`/controller/?invite=${first.inviteToken}`);
    await page.click('#btn-permission');
    await expect(page.locator('#status-message')).toContainText('연결됨');

    let secondConnected = false;
    secondHost.on('session:status', (status) => {
      secondConnected = status.controllerConnected;
    });
    await page.goto(`/controller/?invite=${second.inviteToken}`);
    await page.click('#btn-permission');
    await expect.poll(() => secondConnected).toBe(true);
  } finally {
    await context.close();
    firstHost.disconnect();
    secondHost.disconnect();
  }
});

test('컨트롤러 리다이렉트가 초대 토큰을 유지한다', async ({ page }) => {
  await page.goto('/controller?invite=test-token');
  await expect(page).toHaveURL(/\/controller\/\?invite=test-token$/);
});

test('센서 권한 거부 시 안내를 표시한다', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  await installHostProbe(hostPage);
  await hostPage.goto('/');
  await expect(hostPage.locator('#invite-link')).toHaveAttribute('href', /.+/, { timeout: 5000 });
  const inviteUrl = await hostPage.locator('#invite-link').getAttribute('href');

  const controllerContext = await browser.newContext();
  const controllerPage = await controllerContext.newPage();
  await mockOrientationPermission(controllerPage, 'denied');
  await controllerPage.goto(inviteUrl!);
  await controllerPage.click('#btn-permission');

  await expect(controllerPage.locator('#status-message')).toContainText('거부', { timeout: 5000 });

  await controllerContext.close();
  await hostContext.close();
});
