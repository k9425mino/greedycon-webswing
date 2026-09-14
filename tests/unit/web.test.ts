import { describe, expect, it } from 'vitest';
import { selectTarget, WebSwing, type TargetHit, type TargetQuery } from '../../client/host/web';

const options = {
  effectSec: 0.1,
  minDistance: 3,
  maxDistance: 70,
  assistRadius: 2.5,
};

function query(overrides: Partial<TargetQuery> = {}): TargetQuery {
  return {
    raycastBuilding: () => null,
    sweepBuilding: () => null,
    isVisible: () => true,
    ...overrides,
  };
}

describe('selectTarget', () => {
  const high: TargetHit = { point: [1, 6, -10], distance: Math.hypot(1, 6, 10) };

  it('건물에 직접 맞으면 그 지점을 우선한다', () => {
    const q = query({ raycastBuilding: () => high });
    expect(selectTarget([0, 0, 0], [0, 0, -1], q, options)).toEqual(high);
  });

  it('직접 명중이 없으면 구체 스윕 결과를 쓴다', () => {
    const q = query({ sweepBuilding: () => high });
    expect(selectTarget([0, 0, 0], [0, 0, -1], q, options)).toEqual(high);
  });

  it('직접 명중도 스윕도 없으면 표적이 없다', () => {
    expect(selectTarget([0, 0, 0], [0, 0, -1], query(), options)).toBeNull();
  });

  it('최소 사거리보다 가까우면 선택하지 않는다', () => {
    const near: TargetHit = { point: [0, 1, -1], distance: Math.hypot(1, 1) };
    const q = query({ raycastBuilding: () => near, sweepBuilding: () => near });
    expect(selectTarget([0, 0, 0], [0, 0, -1], q, options)).toBeNull();
  });

  it('스윕 접촉점이 최대 사거리 밖이면 미리보기 표적으로 선택하지 않는다', () => {
    const far: TargetHit = { point: [2, 0, -70], distance: Math.hypot(2, 70) };
    expect(
      selectTarget([0, 0, 0], [0, 0, -1], query({ sweepBuilding: () => far }), options),
    ).toBeNull();
  });

  it('스윕 접촉점까지 직선 경로가 가려지면 선택하지 않는다', () => {
    const q = query({ sweepBuilding: () => high, isVisible: () => false });
    expect(selectTarget([0, 0, 0], [0, 0, -1], q, options)).toBeNull();
  });

  it('수평·아래쪽 벽면도 조준한 지점 그대로 선택한다', () => {
    const level: TargetHit = { point: [0, 0, -10], distance: 10 };
    const below: TargetHit = { point: [0, -6, -10], distance: Math.hypot(6, 10) };
    expect(
      selectTarget([0, 0, 0], [0, 0, -1], query({ raycastBuilding: () => level }), options),
    ).toEqual(level);
    expect(
      selectTarget([0, 0, 0], [0, 0, -1], query({ raycastBuilding: () => below }), options),
    ).toEqual(below);
  });
});

describe('WebSwing', () => {
  const target: TargetHit = { point: [0, 6, -10], distance: Math.hypot(6, 10) };

  function makeSwing(query_: TargetQuery = query({ raycastBuilding: () => target })) {
    return new WebSwing(query_, options);
  }

  it('발사 중 뗀 다음 바로 다시 눌러도 다음 발사가 시작된다', () => {
    const swing = makeSwing();
    const callbacks = { onAttach: () => {}, onRelease: () => {} };
    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    swing.update(false, 0.02, [0, 0, 0], [0, 0, -1], callbacks);
    swing.update(true, 0.04, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    swing.update(true, 0.15, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('attached');
  });

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
    expect(swing.lastFailure).toBeNull();

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
    expect(swing.lastFailure).toBe('noTarget');

    swing.update(true, 0.1, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('releasedRequired');
    expect(attachCount).toBe(0);

    swing.update(false, 0.2, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('idle');
    // 실패 사유는 다음 발사까지 남아 진단에 보인다.
    expect(swing.lastFailure).toBe('noTarget');
  });

  it('발사 효과 중 손을 떼면 부착하지 않고 idle로 돌아온다', () => {
    const swing = makeSwing();
    let attachCount = 0;
    const callbacks = { onAttach: () => attachCount++, onRelease: () => {} };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    swing.update(false, 0.05, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('idle');
    expect(swing.lastFailure).toBe('releasedWhileFiring');
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
    const farTarget: TargetHit = { point: [0, 6, -10], distance: Math.hypot(6, 10) };
    const swing = makeSwing(query({ raycastBuilding: () => farTarget }));
    let attachCount = 0;
    const callbacks = { onAttach: () => attachCount++, onRelease: () => {} };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    // 재확인 시점의 origin을 최대 사거리(70) 밖으로 옮긴다
    swing.update(true, 0.1, [0, 0, -85], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('releasedRequired');
    expect(attachCount).toBe(0);
    expect(swing.lastFailure).toBe('outOfRange');
  });

  it('효과 완료 시점에 표적이 가려지면 가림을 실패 사유로 남긴다', () => {
    let visible = true;
    const swing = makeSwing(query({ raycastBuilding: () => target, isVisible: () => visible }));
    let attachCount = 0;
    const callbacks = { onAttach: () => attachCount++, onRelease: () => {} };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    visible = false;
    swing.update(true, 0.1, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('releasedRequired');
    expect(attachCount).toBe(0);
    expect(swing.lastFailure).toBe('occluded');

    // 새 게임·재시작 기준을 다시 잡으면 실패 사유도 지워진다.
    swing.reset();
    expect(swing.lastFailure).toBeNull();
  });

  it('firing 시작 시 onFireStart를 한 번만 호출하고 pendingTargetPoint를 노출한다', () => {
    const swing = makeSwing();
    let fireStartCount = 0;
    const callbacks = {
      onFireStart: () => fireStartCount++,
      onAttach: () => {},
      onRelease: () => {},
    };

    expect(swing.pendingTargetPoint).toBeNull();
    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    expect(fireStartCount).toBe(1);
    expect(swing.pendingTargetPoint).toEqual(target.point);

    // 효과 시간 동안 계속 눌러도 다시 호출되지 않는다.
    swing.update(true, 0.05, [0, 0, 0], [0, 0, -1], callbacks);
    expect(fireStartCount).toBe(1);

    swing.update(true, 0.1, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('attached');
    expect(swing.pendingTargetPoint).toBeNull();
  });

  it('표적이 없으면 onFireStart를 호출하지 않는다', () => {
    const swing = makeSwing(query());
    let fireStartCount = 0;
    const callbacks = {
      onFireStart: () => fireStartCount++,
      onAttach: () => {},
      onRelease: () => {},
    };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('releasedRequired');
    expect(fireStartCount).toBe(0);
  });

  it('표적이 없으면 조준 방향과 함께 onFireMiss를 한 번 호출한다', () => {
    const swing = makeSwing(query());
    const misses: Array<[number, number, number]> = [];
    const callbacks = {
      onFireMiss: (direction: [number, number, number]) => misses.push(direction),
      onAttach: () => {},
      onRelease: () => {},
    };

    swing.update(true, 0, [0, 0, 0], [1, 0, 0], callbacks);
    expect(swing.phase).toBe('releasedRequired');
    expect(misses).toEqual([[1, 0, 0]]);

    // 손을 떼기 전에는 다시 발사하지 않는다.
    swing.update(true, 0.2, [0, 0, 0], [1, 0, 0], callbacks);
    expect(misses).toHaveLength(1);
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

describe('WebSwing 실패 사유 구분', () => {
  it('낮은 벽면도 높이와 무관하게 부착한다', () => {
    const low: TargetHit = { point: [0, 1, -10], distance: Math.hypot(1, 10) };
    const swing = new WebSwing(query({ raycastBuilding: () => low }), options);
    const attached: TargetHit[] = [];
    const callbacks = {
      onAttach: (hit: TargetHit) => attached.push(hit),
      onRelease: () => {},
    };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    swing.update(true, 0.1, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('attached');
    expect(attached[0]!.point).toEqual(low.point);
    expect(swing.lastFailure).toBeNull();
  });

  it('건물 자체가 없으면 noTarget으로 남긴다', () => {
    const swing = new WebSwing(query(), options);

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], { onAttach: () => {}, onRelease: () => {} });
    expect(swing.lastFailure).toBe('noTarget');
  });
});
