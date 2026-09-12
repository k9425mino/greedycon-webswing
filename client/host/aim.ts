import type { Quaternion } from '@shared/types';
import { gameConfig } from '@shared/config';
import { conjugateQuaternion, multiplyQuaternions } from '@shared/quaternionMath';

// 기준 자세(q0) 대비 현재 자세의 상대 회전.
export function relativeRotation(current: Quaternion, reference: Quaternion): Quaternion {
  return multiplyQuaternions(conjugateQuaternion(reference), current);
}

export type AimAngles = { yawDeg: number; pitchDeg: number };

// 정면(-Z, 카메라 forward) 기준 상대 회전을 yaw/pitch로 변환한다.
export function relativeRotationToAngles([x, y, z, w]: Quaternion): AimAngles {
  // v' = v + 2*w*(qv x v) + 2*qv x (qv x v), qv = (x,y,z), v = forward(0,0,-1)
  const vx = 0;
  const vy = 0;
  const vz = -1;

  const t1x = y * vz - z * vy;
  const t1y = z * vx - x * vz;
  const t1z = x * vy - y * vx;

  const t2x = y * t1z - z * t1y;
  const t2y = z * t1x - x * t1z;
  const t2z = x * t1y - y * t1x;

  const rx = vx + 2 * w * t1x + 2 * t2x;
  const ry = vy + 2 * w * t1y + 2 * t2y;
  const rz = vz + 2 * w * t1z + 2 * t2z;

  const yawDeg = (Math.atan2(rx, -rz) * 180) / Math.PI;
  const horizontalDist = Math.sqrt(rx * rx + rz * rz);
  const pitchDeg = (Math.atan2(ry, horizontalDist) * 180) / Math.PI;

  return { yawDeg, pitchDeg };
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
