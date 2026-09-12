import { describe, expect, it } from 'vitest';
import { WebSwing, selectTarget, type TargetHit, type TargetQuery } from '../../client/host/web';

const options = { effectSec: 0.1, minDistance: 3, maxDistance: 70, coneHalfAngleDeg: 12 };

function query(overrides: Partial<TargetQuery> = {}): TargetQuery {
  return {
    raycastBuilding: () => null,
    isVisible: () => true,
    ...overrides,
  };
}

describe('selectTarget', () => {
  it('건물에 직접 맞으면 그 지점을 우선한다', () => {
    const directHit: TargetHit = { point: [1, 2, -10], distance: 10 };
    const q = query({ raycastBuilding: () => directHit });
    const result = selectTarget([0, 0, 0], [0, 0, -1], [], q, options);
    expect(result).toEqual(directHit);
  });

  it('직접 명중이 없으면 조준 원뿔 안의 가까운 후보를 선택한다', () => {
    const q = query();
    const candidates = [
      { point: [0, 0, -10] as [number, number, number] }, // 정면, 각도 0
      { point: [5, 0, -10] as [number, number, number] }, // 각도 있음
    ];
    const result = selectTarget([0, 0, 0], [0, 0, -1], candidates, q, options);
    expect(result?.point).toEqual([0, 0, -10]);
  });

  it('원뿔 밖의 후보는 선택하지 않는다', () => {
    const q = query();
    const candidates = [{ point: [50, 0, -10] as [number, number, number] }];
    const result = selectTarget([0, 0, 0], [0, 0, -1], candidates, q, options);
    expect(result).toBeNull();
  });

  it('가려진 후보는 선택하지 않는다', () => {
    const q = query({ isVisible: () => false });
    const candidates = [{ point: [0, 0, -10] as [number, number, number] }];
    const result = selectTarget([0, 0, 0], [0, 0, -1], candidates, q, options);
    expect(result).toBeNull();
  });
});

describe('WebSwing', () => {
  const target: TargetHit = { point: [0, 0, -10], distance: 10 };

  function makeSwing(query_: TargetQuery = query({ raycastBuilding: () => target })) {
    return new WebSwing(query_, [], options);
  }

  it('한 번 누를 때 한 번만 발사·부착한다', () => {
    const swing = makeSwing();
    let attachCount = 0;
    const callbacks = { onAttach: () => attachCount++, onRelease: () => {} };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    swing.update(true, 0.05, [0, 0, 0], [0, 0, -1], callbacks); // 효과 시간 전
    expect(swing.phase).toBe('firing');
    swing.update(true, 0.1, [0, 0, 0], [0, 0, -1], callbacks); // 효과 완료
    expect(swing.phase).toBe('attached');
    expect(attachCount).toBe(1);

    // 계속 누르고 있어도 재발사하지 않는다
    swing.update(true, 0.2, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('attached');
    expect(attachCount).toBe(1);
  });

  it('표적이 없으면 releasedRequired로 이동하고, 뗄 때까지 재발사를 막는다', () => {
    const swing = makeSwing(query());
    let attachCount = 0;
    const callbacks = { onAttach: () => attachCount++, onRelease: () => {} };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('releasedRequired');

    swing.update(true, 0.1, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('releasedRequired');
    expect(attachCount).toBe(0);

    swing.update(false, 0.2, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('idle');
  });

  it('발사 효과 중 손을 떼면 부착하지 않고 releasedRequired로 이동한다', () => {
    const swing = makeSwing();
    let attachCount = 0;
    const callbacks = { onAttach: () => attachCount++, onRelease: () => {} };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    swing.update(false, 0.05, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('releasedRequired');
    swing.update(false, 0.2, [0, 0, 0], [0, 0, -1], callbacks);
    expect(attachCount).toBe(0);
  });

  it('부착 후 손을 떼면 해제하고 idle로 돌아온다', () => {
    const swing = makeSwing();
    let released = false;
    const callbacks = { onAttach: () => {}, onRelease: () => (released = true) };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    swing.update(true, 0.1, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('attached');

    swing.update(false, 0.2, [0, 0, 0], [0, 0, -1], callbacks);
    expect(released).toBe(true);
    expect(swing.phase).toBe('idle');
  });

  it('효과 완료 시점에 표적이 더 이상 유효하지 않으면 부착하지 않는다', () => {
    // 발사 순간엔 사거리 안이지만, 재확인 시점(플레이어 이동)엔 최대 거리를 벗어난 경우
    const farTarget: TargetHit = { point: [0, 0, -10], distance: 10 };
    const swing = makeSwing(query({ raycastBuilding: () => farTarget }));
    let attachCount = 0;
    const callbacks = { onAttach: () => attachCount++, onRelease: () => {} };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    // 재확인 시점의 origin을 최대 사거리(70) 밖으로 옮긴다
    swing.update(true, 0.1, [0, 0, -85], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('releasedRequired');
    expect(attachCount).toBe(0);
  });

  it('새로 reset할 때 이미 눌려있으면 자동 발사로 취급하지 않는다', () => {
    const swing = makeSwing();
    let attachCount = 0;
    const callbacks = { onAttach: () => attachCount++, onRelease: () => {} };

    swing.reset(true); // 재개 직전 이미 눌려있던 상태를 기준으로 삼는다
    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('idle');
    expect(attachCount).toBe(0);

    // 손을 뗐다가 다시 누르면 정상적으로 발사한다
    swing.update(false, 0.1, [0, 0, 0], [0, 0, -1], callbacks);
    swing.update(true, 0.2, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
  });
});
