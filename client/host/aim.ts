import type { Quaternion } from '@shared/types';
import { gameConfig } from '@shared/config';
import { rotateVectorByQuaternion } from '@shared/quaternionMath';

export type AimAngles = { yawDeg: number; pitchDeg: number };

// 기기 좌표계에서 조준 방향으로 쓰는 축. 손목에 폰을 고정하고 폰 상단이 손가락을 향하는 장착이
// 기준이다(ARCHITECTURE 5절). 상단이 팔꿈치 쪽을 향하게 장착하면 [0, -1, 0]으로 바꾼다.
const DEVICE_AIM_AXIS: [number, number, number] = [0, 1, 0];

// 위에서 봤을 때 base에서 now까지의 반시계 각도(도). 두 벡터의 수평 성분만 사용한다.
function counterClockwiseAngleDeg(base: [number, number], now: [number, number]): number {
  const cross = base[0] * now[1] - base[1] * now[0];
  const dot = base[0] * now[0] + base[1] * now[1];
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

function elevationDeg(z: number): number {
  return (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI;
}

// DeviceOrientation 쿼터니언은 기기 좌표를 지면 좌표(X 동, Y 북, Z 위)로 옮긴다. 조준축을 지면
// 좌표로 옮긴 뒤 보정 자세(q0)의 조준축과 비교해 좌우(수평 방위 차)·상하(고도 차)를 구한다.
// 게임 좌표계(Y 위, 전방 -Z)에서 상대 회전을 바로 적용하면 수직축이 달라 팔을 좌우로 돌려도
// 조준이 움직이지 않으므로, 비교는 반드시 지면 좌표계에서 한다.
// 조준축을 중심으로 손목을 비트는 회전(롤)은 조준에 영향을 주지 않는다.
export function aimAnglesFromOrientation(current: Quaternion, reference: Quaternion): AimAngles {
  const now = rotateVectorByQuaternion(current, DEVICE_AIM_AXIS);
  const base = rotateVectorByQuaternion(reference, DEVICE_AIM_AXIS);

  // 조준축이 수직에 가까우면 방위가 정해지지 않는다. 그 순간에는 좌우를 정면으로 둔다.
  const horizontal = Math.hypot(now[0], now[1]) > 1e-6 && Math.hypot(base[0], base[1]) > 1e-6;
  const yawDeg = horizontal ? -counterClockwiseAngleDeg([base[0], base[1]], [now[0], now[1]]) : 0;

  return { yawDeg, pitchDeg: elevationDeg(now[2]) - elevationDeg(base[2]) };
}

export function clampAimAngles({ yawDeg, pitchDeg }: AimAngles): AimAngles {
  const limits = gameConfig.aimLimitsDeg;
  return {
    yawDeg: Math.max(-limits.yawLeft, Math.min(limits.yawRight, yawDeg)),
    pitchDeg: Math.max(-limits.pitchDown, Math.min(limits.pitchUp, pitchDeg)),
  };
}

// yaw/pitch를 게임 월드 방향 벡터로 변환한다. 마우스 입력(mouseInput.ts)과 같은 좌표계(Y 위쪽, 전방 -Z)를 쓴다.
export function anglesToDirection({ yawDeg, pitchDeg }: AimAngles): [number, number, number] {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

export type ScreenProjection = { x: number; y: number; onScreen: boolean };

// 월드 방향(카메라는 항상 -Z를 보고 롤이 없다고 가정, mouseInput.ts의 투영과 역함수)을
// 화면 비율(0~1)로 투영한다. 실제 발사 방향과 표시가 항상 일치하도록 조준점·표적 마커가 공용으로 쓴다.
// FOV 밖이거나 카메라 뒤쪽이면 onScreen=false이며 좌표는 가장자리로 clamp된다.
export function directionToScreenRatio(
  direction: [number, number, number],
  camera: { fov: number; aspect: number },
): ScreenProjection {
  const halfFovV = (camera.fov * Math.PI) / 360;
  const tanHalfV = Math.tan(halfFovV);
  const tanHalfH = tanHalfV * camera.aspect;

  const [dx, dy, dz] = direction;
  // 카메라 뒤쪽(dz >= 0)은 원근 투영으로 유한한 NDC를 만들 수 없다.
  const onScreenSide = dz < -1e-6;
  const scale = onScreenSide ? -1 / dz : Number.POSITIVE_INFINITY;
  const ndcX = onScreenSide ? (dx * scale) / tanHalfH : Math.sign(dx) || 1;
  const ndcY = onScreenSide ? (dy * scale) / tanHalfV : Math.sign(dy) || 1;

  const onScreen = onScreenSide && Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1;
  const clampedX = Math.max(-1, Math.min(1, ndcX));
  const clampedY = Math.max(-1, Math.min(1, ndcY));

  return { x: 0.5 + clampedX * 0.5, y: 0.5 - clampedY * 0.5, onScreen };
}
