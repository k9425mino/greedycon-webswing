import { test, expect } from '@playwright/test';

test('마우스 플레이: 운영자 중지 후 시작 버튼으로 재개한다', async ({ page }) => {
  await page.goto('/?input=mouse');
  await expect(page.locator('#status-physics')).toHaveText('준비됨');
  await page.locator('#btn-start').click();
  await page.locator('#btn-stop').click();
  await expect(page.locator('#status-phase')).toHaveText('paused');
  await page.waitForTimeout(2200);
  await expect(page.locator('#status-phase')).toHaveText('paused');
  await expect(page.locator('#btn-start')).toBeEnabled();
  await page.locator('#btn-start').click();
  await expect(page.locator('#status-phase')).toHaveText('playing');
  await expect(page.locator('#status-phase')).toHaveText('gameOver', { timeout: 15_000 });
  await expect(page.locator('#btn-switch-phone')).toBeDisabled();
});

// 마우스 입력(?input=mouse)으로 물리·거미줄·추락·재시작을 검증한다.
// 폰 없이 이번 세션에서 구현한 playing 동작을 확인하기 위한 개발용 경로다.
test('마우스 플레이: 새 게임, 추락, 재시작', async ({ page }) => {
  await page.goto('/?input=mouse');

  const statusPhysics = page.locator('#status-physics');
  await expect(statusPhysics).toHaveText('준비됨', { timeout: 15_000 });

  const btnStart = page.locator('#btn-start');
  await expect(btnStart).toBeEnabled();
  await btnStart.click();
  await expect(page.locator('#status-phase')).toHaveText('playing');

  // 조준하지 않고 그대로 두면 초기 전방 속도로 날아가다 중력에 의해 추락한다.
  await expect(page.locator('#status-phase')).toHaveText('gameOver', { timeout: 15_000 });
  await expect(page.locator('#gameover-section')).toBeVisible();

  const btnRestart = page.locator('#btn-restart');
  await btnRestart.click();
  await expect(page.locator('#status-phase')).toHaveText('ready');
  await expect(btnStart).toBeEnabled();
});

test('마우스 플레이: 건물을 겨눠 부착하면 거미줄이 표시된다', async ({ page }) => {
  await page.goto('/?input=mouse');
  await expect(page.locator('#status-physics')).toHaveText('준비됨', { timeout: 15_000 });

  await page.locator('#btn-start').click();
  await expect(page.locator('#status-phase')).toHaveText('playing');

  const canvas = page.locator('#scene');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  // 왼쪽 위(왼쪽 건물 방향)를 겨누고 유지한다. 오른쪽은 운영 패널이 캔버스를 가린다.
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.waitForTimeout(300);

  const pressed = await page.locator('#crosshair').getAttribute('data-pressed');
  expect(pressed).toBe('true');

  // 자유낙하라면 약 1.9초 안에 바닥에 닿아 종료된다. 부착에 성공했다면 그보다 오래 살아남는다.
  await page.waitForTimeout(2800);
  await expect(page.locator('#status-phase')).toHaveText('playing');

  await page.mouse.up();
});

test('마우스 플레이: 조준점이 마우스 위치를 따라가고 표적을 겨누면 마커가 표시된다', async ({
  page,
}) => {
  await page.goto('/?input=mouse');
  await expect(page.locator('#status-physics')).toHaveText('준비됨', { timeout: 15_000 });
  await page.locator('#btn-start').click();
  await expect(page.locator('#status-phase')).toHaveText('playing');

  const canvas = page.locator('#scene');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  // 화면 중앙을 겨누면 조준점도 중앙 근처에 있어야 한다(발사 방향과 일치).
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX, centerY);
  const crosshair = page.locator('#crosshair');
  await expect
    .poll(async () => {
      const box2 = await crosshair.boundingBox();
      return box2 ? Math.abs(box2.x + box2.width / 2 - centerX) : Infinity;
    })
    .toBeLessThan(5);

  // 왼쪽 건물 방향(원거리 부착 후보)을 겨누면 표적 마커가 나타난다. 실제 발사(마우스 다운) 없이 미리보기만 확인한다.
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.35);
  await expect(page.locator('#target-marker')).toBeVisible({ timeout: 2000 });
  await expect(crosshair).toHaveAttribute('data-has-target', 'true');
});
