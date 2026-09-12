import type { InputFrame, Quaternion } from './types';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isQuaternion(value: unknown): value is Quaternion {
  return Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber);
}

// wire로 들어온 값의 타입·유한값 형태만 확인한다(신뢰하지 않는 네트워크 입력).
export function isValidInputFrameShape(value: unknown): value is InputFrame {
  if (typeof value !== 'object' || value === null) return false;
  const frame = value as Record<string, unknown>;
  return (
    isFiniteNumber(frame.seq) &&
    Number.isSafeInteger(frame.seq) &&
    frame.seq >= 0 &&
    typeof frame.pressed === 'boolean' &&
    isQuaternion(frame.orientation)
  );
}

export function normalizeQuaternion([x, y, z, w]: Quaternion): Quaternion {
  const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z), Math.abs(w));
  if (scale === 0) return [0, 0, 0, 1];
  x /= scale;
  y /= scale;
  z /= scale;
  w /= scale;
  const length = Math.hypot(x, y, z, w);
  if (length === 0) return [0, 0, 0, 1];
  return [x / length, y / length, z / length, w / length];
}

export type SeqTracker = { lastSeq: number | null };

export function createSeqTracker(): SeqTracker {
  return { lastSeq: null };
}

// 연결이 새로 시작되면(재연결·폰 교체) tracker를 새로 만들어 seq 기준을 리셋한다.
export function acceptSeq(tracker: SeqTracker, seq: number): boolean {
  if (!Number.isSafeInteger(seq) || seq < 0) return false;
  if (tracker.lastSeq !== null && seq <= tracker.lastSeq) return false;
  tracker.lastSeq = seq;
  return true;
}
