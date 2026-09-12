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
