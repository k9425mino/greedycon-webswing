import { describe, expect, it } from 'vitest';
import {
  acceptSeq,
  createSeqTracker,
  isValidInputFrameShape,
  normalizeQuaternion,
} from '../../shared/inputValidation';

describe('isValidInputFrameShape', () => {
  it('정상 프레임을 받아들인다', () => {
    expect(isValidInputFrameShape({ seq: 1, orientation: [0, 0, 0, 1], pressed: false })).toBe(
      true,
    );
  });

  it('쿼터니언 성분이 유한하지 않으면 거절한다', () => {
    expect(
      isValidInputFrameShape({ seq: 1, orientation: [0, 0, 0, Number.NaN], pressed: false }),
    ).toBe(false);
  });

  it('orientation 길이가 4가 아니면 거절한다', () => {
    expect(isValidInputFrameShape({ seq: 1, orientation: [0, 0, 1], pressed: false })).toBe(false);
  });

  it('pressed가 boolean이 아니면 거절한다', () => {
    expect(isValidInputFrameShape({ seq: 1, orientation: [0, 0, 0, 1], pressed: 'true' })).toBe(
      false,
    );
  });

  it('객체가 아니면 거절한다', () => {
    expect(isValidInputFrameShape(null)).toBe(false);
    expect(isValidInputFrameShape('frame')).toBe(false);
  });
});

describe('acceptSeq', () => {
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    '잘못된 순번 %s는 기준을 변경하지 않는다',
    (seq) => {
      const tracker = createSeqTracker();
      expect(acceptSeq(tracker, seq)).toBe(false);
      expect(tracker.lastSeq).toBeNull();
      expect(isValidInputFrameShape({ seq, orientation: [0, 0, 0, 1], pressed: false })).toBe(
        false,
      );
    },
  );
  it('증가하는 seq만 허용한다', () => {
    const tracker = createSeqTracker();
    expect(acceptSeq(tracker, 1)).toBe(true);
    expect(acceptSeq(tracker, 2)).toBe(true);
    expect(acceptSeq(tracker, 2)).toBe(false);
    expect(acceptSeq(tracker, 1)).toBe(false);
    expect(acceptSeq(tracker, 3)).toBe(true);
  });

  it('새 tracker(재연결)는 seq 기준을 리셋한다', () => {
    const tracker = createSeqTracker();
    acceptSeq(tracker, 100);
    const freshTracker = createSeqTracker();
    expect(acceptSeq(freshTracker, 1)).toBe(true);
  });
});

describe('normalizeQuaternion', () => {
  it.each([Number.MAX_VALUE, Number.MIN_VALUE])(
    '극단적인 유한 성분 %s도 단위 길이로 정규화한다',
    (value) => {
      const q = normalizeQuaternion([value, value, 0, 0]);
      expect(Math.hypot(...q)).toBeCloseTo(1);
      expect(q[0]).toBeCloseTo(Math.SQRT1_2);
    },
  );
  it('길이 1로 정규화한다', () => {
    const [x, y, z, w] = normalizeQuaternion([0, 0, 0, 2]);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
    expect(w).toBeCloseTo(1);
  });

  it('영벡터는 항등 쿼터니언으로 처리한다', () => {
    expect(normalizeQuaternion([0, 0, 0, 0])).toEqual([0, 0, 0, 1]);
  });
});
