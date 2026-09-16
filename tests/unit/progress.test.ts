import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../shared/config';
import { Progress } from '../../client/host/progress';

const dt = gameConfig.physics.fixedTimestepSec;
// 지면 근접 보너스가 끼어들지 않는 높이.
const HIGH = gameConfig.progress.nearGroundHeightM + 10;

function stepFor(progress: Progress, seconds: number, playerZ: number) {
  for (let i = 0; i < Math.round(seconds / dt); i++) progress.step(dt, playerZ, HIGH, 0);
}

describe('Progress', () => {
  it('점수는 실제 진행한 시뮬레이션 시간으로만 증가한다', () => {
    const progress = new Progress();
    progress.reset(0);
    expect(progress.score).toBe(0);

    // 1초 동안 전진하며 진행. 점수는 실제 시계가 아니라 수행한 step 수로만 정해진다.
    for (let i = 0; i < 60; i++) progress.step(dt, -i, HIGH, 0);
    expect(progress.score).toBe(gameConfig.progress.scorePerSecond);
    expect(progress.elapsedSeconds).toBeCloseTo(1, 5);
  });

  it('전진이 5m 늘면 정체 타이머가 초기화된다', () => {
    const progress = new Progress();
    progress.reset(0);

    stepFor(progress, 4, 0);
    expect(progress.stallState).toBe('ok');
    progress.step(dt, -gameConfig.progress.stallResetDistanceM, HIGH, 0);
    stepFor(progress, 4, -gameConfig.progress.stallResetDistanceM);
    // 초기화되었으므로 누적 8초가 지나도 종료가 아니다
    expect(progress.stallState).toBe('ok');
  });

  it('5초에 경고, 8초에 종료한다', () => {
    const progress = new Progress();
    progress.reset(0);

    stepFor(progress, gameConfig.progress.stallWarnSec - 0.5, 0);
    expect(progress.stallState).toBe('ok');
    stepFor(progress, 1, 0);
    expect(progress.stallState).toBe('warning');
    stepFor(progress, gameConfig.progress.stallEndSec - gameConfig.progress.stallWarnSec, 0);
    expect(progress.stallState).toBe('ended');
  });

  it('지난 구간을 왕복해도 정체 판정을 피하지 못한다', () => {
    const progress = new Progress();
    progress.reset(0);

    // 20m 전진해 기준점을 옮긴 뒤, 뒤로 갔다가 같은 위치로 돌아온다
    stepFor(progress, 1, -20);
    for (let round = 0; round < 4; round++) {
      stepFor(progress, 1, -5);
      stepFor(progress, 1, -20);
    }
    // 최고 도달 거리가 갱신되지 않았으므로 타이머는 계속 흘러 종료된다
    expect(progress.stallState).toBe('ended');
  });

  it('reset은 시작 위치를 기준점으로 삼는다', () => {
    const progress = new Progress();
    progress.reset(-100);
    stepFor(progress, gameConfig.progress.stallEndSec + 1, -100);
    expect(progress.stallState).toBe('ended');

    progress.reset(-100);
    expect(progress.score).toBe(0);
    expect(progress.stallState).toBe('ok');
  });
});

describe('지면 근접 보너스', () => {
  const low = gameConfig.progress.nearGroundHeightM / 2;
  const fast = gameConfig.progress.nearGroundMinSpeedMs;

  it('낮고 빠르게 지나가는 동안에만 쌓인다', () => {
    const progress = new Progress();
    progress.reset(0);
    for (let i = 0; i < 60; i++) progress.step(dt, -i, low, fast);
    expect(progress.bonusScore).toBeGreaterThan(0);
    expect(progress.isNearGround).toBe(true);

    const slow = new Progress();
    slow.reset(0);
    for (let i = 0; i < 60; i++) slow.step(dt, -i, low, fast - 1);
    expect(slow.bonusScore).toBe(0);
    expect(slow.isNearGround).toBe(false);

    const high = new Progress();
    high.reset(0);
    for (let i = 0; i < 60; i++) high.step(dt, -i, HIGH, fast);
    expect(high.bonusScore).toBe(0);
  });

  it('낮을수록 크게 주고 점수와 재시작에 반영된다', () => {
    const lower = new Progress();
    lower.reset(0);
    for (let i = 0; i < 60; i++) lower.step(dt, -i, 1, fast);

    const higher = new Progress();
    higher.reset(0);
    for (let i = 0; i < 60; i++) higher.step(dt, -i, low, fast);

    expect(lower.bonusScore).toBeGreaterThan(higher.bonusScore);
    expect(lower.score).toBe(gameConfig.progress.scorePerSecond + lower.bonusScore);

    lower.reset(0);
    expect(lower.bonusScore).toBe(0);
    expect(lower.isNearGround).toBe(false);
  });
});
