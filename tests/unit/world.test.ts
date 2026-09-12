import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../shared/config';
import { buildChunk, chunkIndexForZ, ChunkedWorld } from '../../client/host/world';

const L = gameConfig.world.chunkLengthM;

function trackingWorld() {
  const added: number[] = [];
  const removed: number[] = [];
  const world = new ChunkedWorld({
    onAdd: (chunk) => added.push(chunk.index),
    onRemove: (index) => removed.push(index),
  });
  return { world, added, removed };
}

describe('buildChunk', () => {
  it('같은 index는 생성 순서와 무관하게 같은 배치를 만든다', () => {
    expect(buildChunk(7)).toEqual(buildChunk(7));
    expect(buildChunk(7)).not.toEqual(buildChunk(8));
  });

  it('구간 안에만 건물과 도로를 배치한다', () => {
    const chunk = buildChunk(3);
    const startZ = -3 * L;
    const endZ = -4 * L;
    expect(chunk.road.center[2]).toBeCloseTo((startZ + endZ) / 2, 5);
    for (const building of chunk.buildings) {
      expect(building.center[2] + building.halfExtents[2]).toBeLessThanOrEqual(startZ);
      expect(building.center[2] - building.halfExtents[2]).toBeGreaterThanOrEqual(endZ - 1e-6);
    }
    expect(chunk.buildings.length).toBeGreaterThan(0);
  });

  it('구간 0은 시작 직후 양쪽에 발사 가능한 표적을 보장한다', () => {
    const chunk = buildChunk(0);
    const start: [number, number, number] = [0, gameConfig.physics.startHeight, 0];
    for (const side of [-1, 1]) {
      const reachable = chunk.candidates.filter((candidate) => {
        if (Math.sign(candidate.point[0]) !== side) return false;
        const dx = candidate.point[0] - start[0];
        const dy = candidate.point[1] - start[1];
        const dz = candidate.point[2] - start[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return distance >= gameConfig.web.minFireDistance && distance <= gameConfig.web.maxFireDistance;
      });
      expect(reachable.length).toBeGreaterThan(0);
    }
  });
});

describe('ChunkedWorld', () => {
  it('시작 시 앞 4구간·뒤 2구간을 유지한다', () => {
    const { world, added } = trackingWorld();
    world.update(0, null);
    expect(added).toEqual([-2, -1, 0, 1, 2, 3, 4]);
    expect(world.activeChunkIndices).toEqual([-2, -1, 0, 1, 2, 3, 4]);
  });

  it('전진하면 앞 구간을 만들고 멀어진 구간을 회수한다', () => {
    const { world, added, removed } = trackingWorld();
    world.update(0, null);
    added.length = 0;

    world.update(-2 * L - 1, null); // 구간 2로 이동
    expect(removed).toEqual([-2, -1]);
    expect(added).toEqual([5, 6]);
    expect(world.activeChunkIndices).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('부착 중인 앵커가 속한 구간은 회수하지 않는다', () => {
    const { world, removed } = trackingWorld();
    world.update(0, null);

    world.update(-2 * L - 1, -2); // 구간 -2에 부착한 채 전진
    expect(removed).toEqual([-1]);
    expect(world.activeChunkIndices).toContain(-2);
  });

  it('후보 배열은 같은 인스턴스를 유지하며 활성 구간만 담는다', () => {
    const { world } = trackingWorld();
    world.update(0, null);
    const candidates = world.candidates;
    const before = candidates.length;

    world.update(-10 * L, null);
    expect(world.candidates).toBe(candidates);
    expect(candidates.length).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(chunkIndexForZ(candidate.point[2])).toBeGreaterThanOrEqual(8);
    }
  });

  it('reset은 모든 구간을 회수하고 시작 구간을 다시 만든다', () => {
    const { world, added, removed } = trackingWorld();
    world.update(-10 * L, null);
    added.length = 0;
    removed.length = 0;

    world.reset();
    expect(removed.sort((a, b) => a - b)).toEqual([8, 9, 10, 11, 12, 13, 14]);
    expect(world.activeChunkIndices).toEqual([-2, -1, 0, 1, 2, 3, 4]);
  });
});
