import { describe, expect, it } from 'vitest';
import {
  selectTarget,
  WebSwing,
  type TargetHit,
  type TargetQuery,
  type SwingCallbacks,
  type Vec3,
} from '../../client/host/web';

const options = {
  travelSpeedMps: 120,
  travelGravity: 20,
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
  // z = -10 평면 전체를 건물 벽으로 두고, 날아가는 줄 끝이 그 벽을 지나는 순간을 본다.
  function wall(z: number): TargetQuery {
    return query({
      raycastBuilding: (origin, direction, maxDistance) => {
        if (direction[2] >= -1e-9) return null;
        const distance = (origin[2] - z) / -direction[2];
        if (distance < 0 || distance > maxDistance) return null;
        return {
          point: [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance, z],
          distance,
        };
      },
    });
  }

  const noCallbacks = { onAttach: () => {}, onRelease: () => {} };

  // 실제 루프처럼 60Hz로 갱신한다. 줄 끝은 구간마다 조금씩 나아가며 충돌을 검사한다.
  function advance(
    swing: WebSwing,
    untilSec: number,
    callbacks: SwingCallbacks = noCallbacks,
    origin: Vec3 = [0, 0, 0],
    direction: Vec3 = [0, 0, -1],
    startSec = 0,
  ): void {
    for (let t = startSec + 1 / 60; t <= untilSec + 1e-9; t += 1 / 60) {
      swing.update(true, t, origin, direction, callbacks);
    }
  }

  it('줄 끝이 벽에 닿는 순간 부착한다', () => {
    const swing = new WebSwing(wall(-10), options);
    const attached: TargetHit[] = [];
    const callbacks = { onAttach: (hit: TargetHit) => attached.push(hit), onRelease: () => {} };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('firing');
    // 0.05초면 6m까지만 날아 벽(10m)에 닿지 않는다.
    advance(swing, 0.05, callbacks);
    expect(swing.phase).toBe('firing');
    expect(attached).toHaveLength(0);

    advance(swing, 0.12, callbacks, [0, 0, 0], [0, 0, -1], 0.05);
    expect(swing.phase).toBe('attached');
    expect(attached).toHaveLength(1);
    expect(attached[0]!.point[2]).toBeCloseTo(-10);
    expect(swing.lastFailure).toBeNull();

    // 계속 누르고 있어도 재발사하지 않는다.
    advance(swing, 0.3, callbacks, [0, 0, 0], [0, 0, -1], 0.12);
    expect(attached).toHaveLength(1);
  });

  it('줄 끝이 중력을 받아 아래로 처지는 탄도를 그린다', () => {
    const swing = new WebSwing(query(), options);
    swing.update(true, 0, [0, 0, 0], [0, 0, -1], noCallbacks);
    expect(swing.tipPoint).toEqual([0, 0, 0]);

    swing.update(true, 0.05, [0, 0, 0], [0, 0, -1], noCallbacks);
    const tip = swing.tipPoint!;
    expect(tip[2]).toBeCloseTo(-6);
    // 0.5 * 20 * 0.05^2 = 0.025m. 6m 날아가는 동안 2.5cm 처진다(휘어짐이 크지 않다).
    expect(tip[1]).toBeCloseTo(-0.025);

    // 경로 샘플의 양 끝은 발사점과 현재 줄 끝이고, 가운데는 직선보다 아래에 있다.
    const path = swing.pathPoints(4);
    expect(path).toHaveLength(5);
    expect(path[0]).toEqual([0, 0, 0]);
    expect(path[4]![2]).toBeCloseTo(tip[2]);
    expect(path[2]![1]).toBeLessThan(0);
    expect(path[2]![1]).toBeGreaterThan(tip[1]);
  });

  it('최소 사거리 안쪽의 벽은 걸리지 않는다', () => {
    const swing = new WebSwing(wall(-2), options);
    advance(swing, 0.01, noCallbacks);
    swing.update(true, 0, [0, 0, 0], [0, 0, -1], noCallbacks);
    advance(swing, 0.05, noCallbacks);
    expect(swing.phase).toBe('firing');
  });

  it('최대 사거리까지 아무것도 못 걸면 releasedRequired로 이동하고, 뗄 때까지 재발사를 막는다', () => {
    const swing = new WebSwing(query(), options);
    let attachCount = 0;
    const callbacks = { onAttach: () => attachCount++, onRelease: () => {} };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    advance(swing, 0.3, callbacks);
    // 최대 사거리(70m)까지 날기 전에는 아직 발사 중이다.
    expect(swing.phase).toBe('firing');

    advance(swing, 0.8, callbacks, [0, 0, 0], [0, 0, -1], 0.3);
    expect(swing.phase).toBe('releasedRequired');
    expect(swing.lastFailure).toBe('noTarget');
    expect(attachCount).toBe(0);

    swing.update(true, 0.9, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('releasedRequired');

    swing.update(false, 1.0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(swing.phase).toBe('idle');
    // 실패 사유는 다음 발사까지 남아 진단에 보인다.
    expect(swing.lastFailure).toBe('noTarget');
  });

  it('빗나가면 그때까지의 비행 경로와 방향을 한 번 넘긴다', () => {
    const swing = new WebSwing(query(), options);
    const misses: Array<{ path: Vec3[]; direction: Vec3 }> = [];
    const callbacks = {
      onFireMiss: (path: Vec3[], direction: Vec3) => misses.push({ path, direction }),
      onAttach: () => {},
      onRelease: () => {},
    };

    swing.update(true, 0, [0, 1, 0], [0, 0, -1], callbacks);
    advance(swing, 0.8, callbacks, [0, 1, 0], [0, 0, -1]);
    expect(swing.phase).toBe('releasedRequired');
    expect(misses).toHaveLength(1);
    expect(misses[0]!.direction).toEqual([0, 0, -1]);
    expect(misses[0]!.path[0]).toEqual([0, 1, 0]);
    // 경로는 발사점에서 시작해 앞으로 갈수록 낮아진다.
    const path = misses[0]!.path;
    expect(path[path.length - 1]![2]).toBeLessThan(-60);
    expect(path[path.length - 1]![1]).toBeLessThan(0);

    // 손을 떼기 전에는 다시 발사하지 않는다.
    advance(swing, 1.2, callbacks, [0, 1, 0], [0, 0, -1], 0.8);
    expect(misses).toHaveLength(1);
  });

  it('발사 중 뗀 다음 바로 다시 눌러도 다음 발사가 시작된다', () => {
    const swing = new WebSwing(wall(-10), options);
    swing.update(true, 0, [0, 0, 0], [0, 0, -1], noCallbacks);
    swing.update(false, 0.02, [0, 0, 0], [0, 0, -1], noCallbacks);
    expect(swing.phase).toBe('idle');
    expect(swing.lastFailure).toBe('releasedWhileFiring');

    swing.update(true, 0.04, [0, 0, 0], [0, 0, -1], noCallbacks);
    expect(swing.phase).toBe('firing');
    advance(swing, 0.2, noCallbacks, [0, 0, 0], [0, 0, -1], 0.04);
    expect(swing.phase).toBe('attached');
  });

  it('부착 후 손을 떼면 해제하고 idle로 돌아온다', () => {
    const swing = new WebSwing(wall(-10), options);
    let released = false;
    const callbacks = { onAttach: () => {}, onRelease: () => (released = true) };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    advance(swing, 0.2, callbacks);
    expect(swing.phase).toBe('attached');

    swing.update(false, 0.3, [0, 0, 0], [0, 0, -1], callbacks);
    expect(released).toBe(true);
    expect(swing.phase).toBe('idle');
    expect(swing.tipPoint).toBeNull();
  });

  it('줄은 발사 순간의 출발점·방향을 따라간다(플레이어가 움직여도 바뀌지 않는다)', () => {
    const swing = new WebSwing(query(), options);

    swing.update(true, 0, [0, 2, 0], [0, 0, -1], noCallbacks);
    // 발사 후 플레이어가 이동하고 조준도 바뀌었지만 줄의 비행 경로는 그대로다.
    swing.update(true, 0.05, [5, 3, -20], [1, 0, 0], noCallbacks);
    const tip = swing.tipPoint!;
    expect(tip[0]).toBe(0);
    expect(tip[2]).toBeCloseTo(-6);
    expect(tip[1]).toBeCloseTo(2 - 0.025);
  });

  it('발사 시작에 onFireStart를 한 번만 호출한다', () => {
    const swing = new WebSwing(wall(-10), options);
    let fireStartCount = 0;
    const callbacks = {
      onFireStart: () => fireStartCount++,
      onAttach: () => {},
      onRelease: () => {},
    };

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], callbacks);
    expect(fireStartCount).toBe(1);
    advance(swing, 0.05, callbacks);
    expect(fireStartCount).toBe(1);
  });

  it('새로 reset할 때 이미 눌려있으면 자동 발사로 취급하지 않는다', () => {
    const swing = new WebSwing(wall(-10), options);
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

  it('조준 보정 스윕으로 걸린 지점은 가림 검사를 거친다', () => {
    const offAim: TargetHit = { point: [2, 0, -12], distance: 12 };
    let visible = false;
    const swing = new WebSwing(
      query({ sweepBuilding: () => offAim, isVisible: () => visible }),
      options,
    );

    swing.update(true, 0, [0, 0, 0], [0, 0, -1], noCallbacks);
    advance(swing, 0.1, noCallbacks);
    expect(swing.phase).toBe('firing');

    visible = true;
    advance(swing, 0.12, noCallbacks, [0, 0, 0], [0, 0, -1], 0.1);
    expect(swing.phase).toBe('attached');
    expect(swing.lastFailure).toBeNull();

    swing.reset();
    expect(swing.lastFailure).toBeNull();
  });
});
