import { expect, test, type Page } from '@playwright/test';

async function mockOrientationPermission(page: Page, result: 'granted' | 'denied' | 'missing') {
  await page.addInitScript((mockResult) => {
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

test('연결부터 입력 표시, 두 번째 컨트롤러 거절까지', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
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

  await expect(hostPage.locator('#status-connection')).toHaveText('연결됨', { timeout: 5000 });
  await expect(hostPage.locator('#status-sensor')).toHaveText('정상', { timeout: 5000 });

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
  await expect(hostPage.locator('#status-phase')).toHaveText('ready', { timeout: 5000 });

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
  await expect(hostPage.locator('#status-phase')).toHaveText('playing');
  await controllerContext.close();
  await expect(hostPage.locator('#status-phase')).toHaveText('paused', { timeout: 5000 });

  await hostContext.close();
});

test('센서 권한 거부 시 안내를 표시한다', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
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
