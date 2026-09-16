import { test, expect } from '@playwright/test';

test('마우스 플레이: 운영자 중지 후 시작 버튼으로 재개한다', async ({ page }) => {
  await page.goto('/?input=mouse');
  await expect(page.locator('#status-physics')).toHaveText('준비됨');
  await page.locator('#btn-start').click();
  await page.keyboard.press('Escape');
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

test('마우스 플레이: 점수가 진행 중에만 증가하고 종료 화면에 결과가 남는다', async ({ page }) => {
  await page.goto('/?input=mouse');
  await expect(page.locator('#status-physics')).toHaveText('준비됨', { timeout: 15_000 });

  const hudScore = page.locator('#hud-score');
  await expect(hudScore).toHaveText('0');

  await page.locator('#btn-start').click();
  await expect(page.locator('#status-phase')).toHaveText('playing');
  await expect.poll(async () => Number(await hudScore.textContent())).toBeGreaterThan(0);

  // 추락으로 종료된 뒤에는 점수가 더 늘지 않는다.
  await expect(page.locator('#status-phase')).toHaveText('gameOver', { timeout: 15_000 });
  const finalScore = Number(await hudScore.textContent());
  await page.waitForTimeout(1000);
  expect(Number(await hudScore.textContent())).toBe(finalScore);

  await expect(page.locator('#gameover-reason')).toHaveText('추락으로 종료되었습니다.');
  await expect(page.locator('#gameover-score')).toHaveText(String(finalScore));

  // 재시작하면 점수가 초기화된다.
  await page.locator('#btn-restart').click();
  await expect(page.locator('#status-phase')).toHaveText('ready');
  await expect(hudScore).toHaveText('0');
});

test('마우스 플레이: 건물을 겨눠 부착하면 거미줄이 표시된다', async ({ page }) => {
  await page.goto('/?input=mouse');
  await expect(page.locator('#status-physics')).toHaveText('준비됨', { timeout: 15_000 });

  await page.locator('#btn-start').click();
  await expect(page.locator('#status-phase')).toHaveText('playing');
  const startedAt = Date.now();

  const canvas = page.locator('#scene');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  // 왼쪽 위(왼쪽 건물 방향)를 겨누고 유지한다. 오른쪽은 운영 패널이 캔버스를 가린다.
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.18);
  await page.mouse.down();
  await page.waitForTimeout(300);

  const pressed = await page.locator('#crosshair').getAttribute('data-pressed');
  expect(pressed).toBe('true');

  // 부착 보조는 부착점을 지나면 끝나므로 계속 누르고 있어도 결국 추락한다. 살아 있는 시간으로
  // 부착 효과를 본다. 시작 높이 18m에서 자유낙하라면 약 1.9초에 끝난다.
  await expect(page.locator('#status-phase')).toHaveText('gameOver', { timeout: 15_000 });
  expect(Date.now() - startedAt).toBeGreaterThan(2400);

  await page.mouse.up();
});

test('마우스 플레이: 조준점이 마우스 위치를 따라가고 표적을 겨누면 마커가 표시된다', async ({
  page,
}) => {
  await page.goto('/?input=mouse');
  await expect(page.locator('#status-physics')).toHaveText('준비됨', { timeout: 15_000 });
  await page.locator('#btn-start').click();
  await expect(page.locator('#status-phase')).toHaveText('playing');
  const startedAt = Date.now();

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
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.18);
  await expect(page.locator('#target-marker')).toBeVisible({ timeout: 2000 });
  await expect(crosshair).toHaveAttribute('data-has-target', 'true');
});
