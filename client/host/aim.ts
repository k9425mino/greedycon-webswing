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

// 화면 크로스헤어 위치(0~1 비율)로 변환. FOV 안쪽으로 매핑하고 clamp된 값은 가장자리에 붙는다.
export function anglesToScreenRatio({ yawDeg, pitchDeg }: AimAngles): { x: number; y: number } {
  const halfFovV = gameConfig.cameraVerticalFovDeg / 2;
  const halfFovH = halfFovV; // 화면 비율은 CSS가 처리하므로 동일 반각 기준으로 정규화
  const x = 0.5 + (yawDeg / halfFovH) * 0.5;
  const y = 0.5 - (pitchDeg / halfFovV) * 0.5;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}
