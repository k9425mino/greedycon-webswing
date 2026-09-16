import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../shared/config';
import { initialCameraFeel, speedRatioFor, updateCameraFeel } from '../../client/host/cameraFeel';

const HIGH_ALTITUDE_M = gameConfig.camera.groundShakeStartM + 20;

function settle(input: {
  speedMs: number;
  anchorOffsetM?: number | null;
  altitudeM?: number;
  attachElapsedMs?: number | null;
}) {
  let state = initialCameraFeel();
  // 보간이 수렴할 만큼 반복한다(60fps로 2초).
  for (let i = 0; i < 120; i++) {
    state = updateCameraFeel(state, {
      speedMs: input.speedMs,
      anchorOffsetM: input.anchorOffsetM ?? null,
      altitudeM: input.altitudeM ?? HIGH_ALTITUDE_M,
      attachElapsedMs: input.attachElapsedMs ?? null,
      nowMs: i * 16.7,
      dtSec: 1 / 60,
    });
  }
  return state;
}

describe('카메라 연출', () => {
  const [slowMs, fastMs] = gameConfig.camera.fovSpeedRangeMs;

  it('빠를수록 시야각이 넓어지고 양 끝에서 멈춘다', () => {
    const slow = settle({ speedMs: slowMs });
    const mid = settle({ speedMs: (slowMs + fastMs) / 2 });
    const fast = settle({ speedMs: fastMs });
    const faster = settle({ speedMs: fastMs * 2 });

    expect(slow.fovDeg).toBeCloseTo(gameConfig.cameraVerticalFovDeg, 1);
    expect(mid.fovDeg).toBeGreaterThan(slow.fovDeg);
    expect(fast.fovDeg).toBeGreaterThan(mid.fovDeg);
    expect(fast.fovDeg).toBeCloseTo(gameConfig.camera.maxFovDeg, 1);
    expect(faster.fovDeg).toBeCloseTo(gameConfig.camera.maxFovDeg, 1);
  });

  it('줄이 걸린 쪽으로 화면이 기울고 상한을 지킨다', () => {
    const right = settle({ speedMs: fastMs, anchorOffsetM: 8 });
    const left = settle({ speedMs: fastMs, anchorOffsetM: -8 });
    const extreme = settle({ speedMs: fastMs, anchorOffsetM: 1000 });
    const released = settle({ speedMs: fastMs, anchorOffsetM: null });
    const maxRollRad = (gameConfig.camera.maxRollDeg * Math.PI) / 180;

    expect(right.rollRad).toBeGreaterThan(0);
    expect(right.rollRad).toBeCloseTo(-left.rollRad, 6);
    expect(Math.abs(extreme.rollRad)).toBeLessThanOrEqual(maxRollRad + 1e-6);
    expect(released.rollRad).toBeCloseTo(0, 3);
  });

  it('지면에 가까울수록 크게 흔들리고 높은 곳에서는 흔들리지 않는다', () => {
    const high = settle({ speedMs: slowMs, altitudeM: HIGH_ALTITUDE_M });
    const low = settle({ speedMs: slowMs, altitudeM: 2 });
    const lower = settle({ speedMs: slowMs, altitudeM: 0 });

    expect(Math.hypot(...high.shakeM)).toBe(0);
    expect(Math.hypot(...low.shakeM)).toBeGreaterThan(0);
    expect(Math.hypot(...lower.shakeM)).toBeGreaterThan(Math.hypot(...low.shakeM));
  });

  it('부착 직후에만 충격이 더해진다', () => {
    const kicked = settle({ speedMs: slowMs, attachElapsedMs: 0 });
    const settled = settle({
      speedMs: slowMs,
      attachElapsedMs: gameConfig.camera.attachKickDurationMs + 1,
    });

    expect(Math.hypot(...kicked.shakeM)).toBeGreaterThan(0);
    expect(Math.hypot(...settled.shakeM)).toBe(0);
  });

  // 2026-09-17 사용자 요청으로 85% 줄였다. 줄이기 전 최악은 약 1.1m였다.
  it('가장 심한 경우에도 흔들림 폭이 20cm를 넘지 않는다', () => {
    const worst = settle({ speedMs: fastMs * 2, altitudeM: 0, attachElapsedMs: 0 });
    expect(Math.hypot(...worst.shakeM)).toBeLessThan(0.2);
  });

  it('속도 비율은 0~1로 잘린다', () => {
    expect(speedRatioFor(slowMs - 10)).toBe(0);
    expect(speedRatioFor(fastMs + 10)).toBe(1);
  });
});
