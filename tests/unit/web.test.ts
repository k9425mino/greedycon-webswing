import { describe, expect, it } from 'vitest';
import {
  selectTarget,
  WebSwing,
  type TargetHit,
  type TargetQuery,
  type Vec3,
} from '../../client/host/web';

const options = {
  travelSpeedMps: 120,
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
  // 줄 끝이 표적 거리(약 11.7m)를 지나는 시각. 120m/s로 약 0.097초다.
  // 부동소수 오차로 줄 끝이 표적 거리에 한 틱 모자라지 않도록 아주 작은 여유를 둔다.
  const arrivalSec = target.distance / options.travelSpeedMps + 1e-6;

  // 줄 끝이 아직 닿지 않은 건물은 걸리지 않는다. maxDistance(=지금까지 뻗은 길이)를 존중한다.
  function reachable(hit: TargetHit): TargetQuery {
    return query({
      raycastBuilding: (_o, _d, maxDistance) => (hit.distance <= maxDistance ? hit : null),
    });
  }

  function makeSwing(query_: TargetQuery = reachable(target)) {
    return new WebSwing(query_, options);
  }

  it('발사 중 뗀 다음 바로 다시 눌러도 다음 발사가 시작된다', () => {
    const swing = makeSwing();
    const callbacks = { onAttach: () => {}, onRelease: () => {} };
    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    swing.update(false, 0.02, [0, 0, 0], [0, 0, -1], callbacks);
    swing.update(true, 0.04, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    swing.update(true, 0.04 + arrivalSec, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('attached');
  });

  it('줄 끝이 표적에 닿기 전에는 부착하지 않는다', () => {
    const swing = makeSwing();
    let attachCount = 0;
    const callbacks = { onAttach: () => attachCount++, onRelease: () => {} };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    // 0.05초면 6m까지만 뻗어 표적(약 11.7m)에 닿지 않는다.
    swing.update(true, 0.05, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    expect(attachCount).toBe(0);

    swing.update(true, arrivalSec, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('attached');
    expect(attachCount).toBe(1);
    expect(swing.lastFailure).toBeNull();

    // 계속 누르고 있어도 재발사하지 않는다
    swing.update(true, 0.5, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('attached');
    expect(attachCount).toBe(1);
  });

  it('줄 끝이 뻗어나가는 동안 tipPoint가 발사 방향으로 자란다', () => {
    const swing = makeSwing();
    const callbacks = { onAttach: () => {}, onRelease: () => {} };

    expect(swing.tipPoint).toBeNull();
    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.tipPoint).toEqual([0, 0, 0]);

    swing.update(true, 0.05, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.tipPoint).toEqual([0, 0, -6]);

    swing.update(true, arrivalSec, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('attached');
    expect(swing.tipPoint).toBeNull();
  });

  it('최대 사거리까지 아무것도 못 걸면 releasedRequired로 이동하고, 뗄 때까지 재발사를 막는다', () => {
    const swing = makeSwing(query());
    let attachCount = 0;
    const callbacks = { onAttach: () => attachCount++, onRelease: () => {} };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    // 최대 사거리(70m)까지 뻗기 전에는 아직 발사 중이다.
    expect(swing.phase).toBe('firing');
    swing.update(true, 0.3, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');

    swing.update(true, 0.6, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('releasedRequired');
    expect(swing.lastFailure).toBe('noTarget');

    swing.update(true, 0.7, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('releasedRequired');
    expect(attachCount).toBe(0);

    swing.update(false, 0.8, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('idle');
    // 실패 사유는 다음 발사까지 남아 진단에 보인다.
    expect(swing.lastFailure).toBe('noTarget');
  });

  it('뻗어나가는 도중 손을 떼면 부착하지 않고 idle로 돌아온다', () => {
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
    swing.update(true, arrivalSec, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('attached');

    swing.update(false, 0.3, [0, 0, 0], [0, 0, -1], callbacks);
    expect(released).toBe(true);
    expect(swing.phase).toBe('idle');
  });

  it('줄은 발사 순간의 출발점·방향을 따라간다(플레이어가 움직여도 바뀌지 않는다)', () => {
    const origins: Vec3[] = [];
    const swing = new WebSwing(
      query({
        raycastBuilding: (origin) => {
          origins.push(origin);
          return null;
        },
      }),
      options,
    );
    const callbacks = { onAttach: () => {}, onRelease: () => {} };

    swing.update(true, 0, [0, 2, 0], [0, 0, -1], callbacks);
    // 발사 후 플레이어가 이동하고 조준도 바뀌었지만 줄의 반직선은 그대로다.
    swing.update(true, 0.05, [5, 3, -20], [1, 0, 0], callbacks);
    expect(origins).toEqual([[0, 2, 0]]);
    expect(swing.tipPoint).toEqual([0, 2, -6]);
  });

  it('발사 시작에 onFireStart를 한 번만 호출한다', () => {
    const swing = makeSwing();
    let fireStartCount = 0;
    const callbacks = {
      onFireStart: () => fireStartCount++,
      onAttach: () => {},
      onRelease: () => {},
    };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    expect(fireStartCount).toBe(1);

    // 뻗어나가는 동안 계속 눌러도 다시 호출되지 않는다.
    swing.update(true, 0.05, [0, 0, 0], [0, 0, -1], callbacks);
    expect(fireStartCount).toBe(1);
  });

  it('표적이 없으면 최대 사거리에 도달한 줄 끝·방향과 함께 onFireMiss를 한 번 호출한다', () => {
    const swing = makeSwing(query());
    const misses: Array<{ tip: Vec3; direction: Vec3 }> = [];
    const callbacks = {
      onFireMiss: (tip: Vec3, direction: Vec3) => misses.push({ tip, direction }),
      onAttach: () => {},
      onRelease: () => {},
    };

    swing.update(true, 0, [0, 1, 0], [1, 0, 0], callbacks);
    swing.update(true, 0.6, [0, 1, 0], [1, 0, 0], callbacks);
    expect(swing.phase).toBe('releasedRequired');
    expect(misses).toEqual([{ tip: [70, 1, 0], direction: [1, 0, 0] }]);

    // 손을 떼기 전에는 다시 발사하지 않는다.
    swing.update(true, 0.8, [0, 1, 0], [1, 0, 0], callbacks);
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

  it('낮은 벽면도 높이와 무관하게 부착한다', () => {
    const low: TargetHit = { point: [0, 1, -10], distance: Math.hypot(1, 10) };
    const swing = makeSwing(reachable(low));
    const attached: TargetHit[] = [];
    const callbacks = {
      onAttach: (hit: TargetHit) => attached.push(hit),
      onRelease: () => {},
    };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    swing.update(
      true,
      low.distance / options.travelSpeedMps + 1e-6,
      [0, 0, 0],
      [0, 0, -1],
      callbacks,
    );
    expect(swing.phase).toBe('attached');
    expect(attached[0]!.point).toEqual(low.point);
    expect(swing.lastFailure).toBeNull();

    // 새 게임·재시작 기준을 다시 잡으면 실패 사유도 지워진다.
    swing.reset();
    expect(swing.lastFailure).toBeNull();
  });
});
