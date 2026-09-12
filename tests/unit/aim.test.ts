import { describe, expect, it } from 'vitest';
import {
  clampAimAngles,
  directionToScreenRatio,
  relativeRotation,
  relativeRotationToAngles,
} from '../../client/host/aim';
import { mouseNdcToDirection } from '../../client/host/mouseInput';
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

describe('directionToScreenRatio', () => {
  const cameras = [
    { fov: 75, aspect: 1 },
    { fov: 75, aspect: 16 / 9 },
    { fov: 60, aspect: 4 / 3 },
  ];

  it('정면(0,0,-1)은 화면 중앙(0.5,0.5)이고 화면 안이다', () => {
    for (const camera of cameras) {
      const ratio = directionToScreenRatio([0, 0, -1], camera);
      expect(ratio.x).toBeCloseTo(0.5, 5);
      expect(ratio.y).toBeCloseTo(0.5, 5);
      expect(ratio.onScreen).toBe(true);
    }
  });

  it('mouseNdcToDirection의 역함수다 (여러 종횡비에서 방향 투영이 일치한다)', () => {
    for (const camera of cameras) {
      const ndcPairs: Array<[number, number]> = [
        [0.3, 0.2],
        [-0.5, 0.4],
        [0.9, -0.9],
      ];
      for (const [ndcX, ndcY] of ndcPairs) {
        const direction = mouseNdcToDirection(ndcX, ndcY, camera);
        const ratio = directionToScreenRatio(direction, camera);
        expect(ratio.x).toBeCloseTo(0.5 + ndcX * 0.5, 5);
        expect(ratio.y).toBeCloseTo(0.5 - ndcY * 0.5, 5);
        expect(ratio.onScreen).toBe(true);
      }
    }
  });

  it('허용 각도 밖(FOV 밖)이면 onScreen이 false이고 가장자리로 clamp된다', () => {
    const camera = { fov: 75, aspect: 1 };
    const direction = mouseNdcToDirection(3, 0, camera); // NDC x=3, 화면 밖
    const ratio = directionToScreenRatio(direction, camera);
    expect(ratio.onScreen).toBe(false);
    expect(ratio.x).toBeCloseTo(1, 5);
    expect(ratio.y).toBeCloseTo(0.5, 5);
  });

  it('카메라 뒤쪽 방향은 onScreen이 false다', () => {
    const camera = { fov: 75, aspect: 1 };
    const ratio = directionToScreenRatio([0, 0, 1], camera);
    expect(ratio.onScreen).toBe(false);
  });

  it('결과는 항상 0~1 범위로 clamp된다', () => {
    const camera = { fov: 75, aspect: 1 };
    const ratio = directionToScreenRatio([1, 1, 1], camera);
    expect(ratio.x).toBeLessThanOrEqual(1);
    expect(ratio.y).toBeLessThanOrEqual(1);
    expect(ratio.x).toBeGreaterThanOrEqual(0);
    expect(ratio.y).toBeGreaterThanOrEqual(0);
  });
});
