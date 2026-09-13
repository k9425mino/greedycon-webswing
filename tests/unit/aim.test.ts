import { describe, expect, it } from 'vitest';
import {
  aimAnglesFromOrientation,
  anglesToDirection,
  clampAimAngles,
  directionToScreenRatio,
} from '../../client/host/aim';
import { applyScreenOrientation, orientationToQuaternion } from '../../client/controller/sensor';
import { mouseNdcToDirection } from '../../client/host/mouseInput';

// 손목에 폰을 평평하게 고정하고(화면 위) 폰 상단이 손가락을 향한 채 팔을 전방으로 뻗은 자세다.
// DeviceOrientation의 alpha는 위에서 본 반시계 회전이라 팔을 오른쪽으로 돌리면 alpha가 줄어든다.
const WRIST_FORWARD = orientationToQuaternion(0, 0, 0);

describe('aimAnglesFromOrientation', () => {
  it.each([0, 90, 180, 270])(
    '화면 방향 %s도에서도 기울어진 보정 자세의 차이를 유지한다',
    (screenAngle) => {
      const reference = applyScreenOrientation(orientationToQuaternion(170, 15, 35), screenAngle);
      const current = applyScreenOrientation(orientationToQuaternion(140, -5, -20), screenAngle);
      const angles = aimAnglesFromOrientation(current, reference);
      expect(angles.yawDeg).toBeCloseTo(30, 3);
      expect(angles.pitchDeg).toBeCloseTo(-20, 3);
    },
  );

  it('방위각 360도 경계에서는 짧은 회전 방향을 사용한다', () => {
    const angles = aimAnglesFromOrientation(
      orientationToQuaternion(10, 0, 0),
      orientationToQuaternion(350, 0, 0),
    );
    expect(angles.yawDeg).toBeCloseTo(-20, 3);
  });

  it('조준축이 수직이면 좌우는 정면으로 두고 고도는 유지한다', () => {
    const angles = aimAnglesFromOrientation(orientationToQuaternion(30, 90, 0), WRIST_FORWARD);
    expect(angles.yawDeg).toBe(0);
    expect(angles.pitchDeg).toBeCloseTo(90, 3);
  });

  it('보정 자세와 같으면 정면(0,0)이다', () => {
    const angles = aimAnglesFromOrientation(WRIST_FORWARD, WRIST_FORWARD);
    expect(angles.yawDeg).toBeCloseTo(0, 5);
    expect(angles.pitchDeg).toBeCloseTo(0, 5);
  });

  it('팔을 오른쪽으로 30도 돌리면 조준도 오른쪽 30도로 간다', () => {
    const angles = aimAnglesFromOrientation(orientationToQuaternion(-30, 0, 0), WRIST_FORWARD);
    expect(angles.yawDeg).toBeCloseTo(30, 3);
    expect(angles.pitchDeg).toBeCloseTo(0, 3);
    // 게임 좌표에서 오른쪽은 +x, 전방은 -z다.
    const [x, y, z] = anglesToDirection(angles);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeCloseTo(0, 3);
    expect(z).toBeLessThan(0);
  });

  it('팔을 왼쪽으로 30도 돌리면 조준도 왼쪽 30도로 간다', () => {
    const angles = aimAnglesFromOrientation(orientationToQuaternion(30, 0, 0), WRIST_FORWARD);
    expect(angles.yawDeg).toBeCloseTo(-30, 3);
    expect(anglesToDirection(angles)[0]).toBeLessThan(0);
  });

  it('손목을 위로 20도 들면 pitch가 20도 올라간다', () => {
    const angles = aimAnglesFromOrientation(orientationToQuaternion(0, 20, 0), WRIST_FORWARD);
    expect(angles.pitchDeg).toBeCloseTo(20, 3);
    expect(angles.yawDeg).toBeCloseTo(0, 3);
    expect(anglesToDirection(angles)[1]).toBeGreaterThan(0);
  });

  it('조준축을 중심으로 손목을 비틀어도(롤) 조준은 움직이지 않는다', () => {
    const angles = aimAnglesFromOrientation(orientationToQuaternion(0, 0, 40), WRIST_FORWARD);
    expect(angles.yawDeg).toBeCloseTo(0, 3);
    expect(angles.pitchDeg).toBeCloseTo(0, 3);
  });

  it('좌우·상하·롤이 섞여도 좌우와 상하를 각각 그대로 낸다', () => {
    const angles = aimAnglesFromOrientation(orientationToQuaternion(-30, 20, 25), WRIST_FORWARD);
    expect(angles.yawDeg).toBeCloseTo(30, 3);
    expect(angles.pitchDeg).toBeCloseTo(20, 3);
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
