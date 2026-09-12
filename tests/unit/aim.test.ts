import { describe, expect, it } from 'vitest';
import {
  anglesToScreenRatio,
  clampAimAngles,
  relativeRotation,
  relativeRotationToAngles,
} from '../../client/host/aim';
import { quaternionFromAxisAngle } from '../../shared/quaternionMath';

describe('relativeRotation / relativeRotationToAngles', () => {
  it('기준과 동일한 자세는 정면(0,0)을 가리킨다', () => {
    const q0 = quaternionFromAxisAngle([0, 1, 0], 30);
    const relative = relativeRotation(q0, q0);
    const angles = relativeRotationToAngles(relative);
    expect(angles.yawDeg).toBeCloseTo(0, 5);
    expect(angles.pitchDeg).toBeCloseTo(0, 5);
  });

  it('기준 대비 Y축으로 30도 회전하면 yaw 크기가 30도로 나온다', () => {
    const q0 = quaternionFromAxisAngle([0, 1, 0], 0);
    const current = quaternionFromAxisAngle([0, 1, 0], 30);
    const relative = relativeRotation(current, q0);
    const angles = relativeRotationToAngles(relative);
    expect(Math.abs(angles.yawDeg)).toBeCloseTo(30, 3);
    expect(angles.pitchDeg).toBeCloseTo(0, 3);
  });

  it('기준 대비 X축으로 20도 회전하면 pitch가 변한다', () => {
    const q0 = quaternionFromAxisAngle([1, 0, 0], 0);
    const current = quaternionFromAxisAngle([1, 0, 0], 20);
    const relative = relativeRotation(current, q0);
    const angles = relativeRotationToAngles(relative);
    expect(Math.abs(angles.pitchDeg)).toBeCloseTo(20, 3);
    expect(angles.yawDeg).toBeCloseTo(0, 3);
  });
});

describe('clampAimAngles', () => {
  it('설정된 허용 각도를 넘지 않게 자른다', () => {
    const clamped = clampAimAngles({ yawDeg: 999, pitchDeg: -999 });
    expect(clamped.yawDeg).toBe(70);
    expect(clamped.pitchDeg).toBe(-35);
  });
});

describe('anglesToScreenRatio', () => {
  it('정면(0,0)은 화면 중앙(0.5,0.5)이다', () => {
    const ratio = anglesToScreenRatio({ yawDeg: 0, pitchDeg: 0 });
    expect(ratio.x).toBeCloseTo(0.5, 5);
    expect(ratio.y).toBeCloseTo(0.5, 5);
  });

  it('결과는 항상 0~1 범위로 clamp된다', () => {
    const ratio = anglesToScreenRatio({ yawDeg: 999, pitchDeg: -999 });
    expect(ratio.x).toBeLessThanOrEqual(1);
    expect(ratio.y).toBeLessThanOrEqual(1);
    expect(ratio.x).toBeGreaterThanOrEqual(0);
    expect(ratio.y).toBeGreaterThanOrEqual(0);
  });
});
