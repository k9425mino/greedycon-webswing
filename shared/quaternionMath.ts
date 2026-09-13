import type { Quaternion } from './types';

export function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function conjugateQuaternion([x, y, z, w]: Quaternion): Quaternion {
  return [-x, -y, -z, w];
}

export function quaternionFromAxisAngle(
  axis: [number, number, number],
  angleDeg: number,
): Quaternion {
  const halfRad = (angleDeg * Math.PI) / 180 / 2;
  const s = Math.sin(halfRad);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(halfRad)];
}

// 쿼터니언 회전을 벡터에 적용한다. v' = v + 2w(qv × v) + 2 qv × (qv × v), qv = (x,y,z).
export function rotateVectorByQuaternion(
  [x, y, z, w]: Quaternion,
  [vx, vy, vz]: [number, number, number],
): [number, number, number] {
  const t1x = y * vz - z * vy;
  const t1y = z * vx - x * vz;
  const t1z = x * vy - y * vx;

  const t2x = y * t1z - z * t1y;
  const t2y = z * t1x - x * t1z;
  const t2z = x * t1y - y * t1x;

  return [vx + 2 * w * t1x + 2 * t2x, vy + 2 * w * t1y + 2 * t2y, vz + 2 * w * t1z + 2 * t2z];
}
