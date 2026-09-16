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

  it('차도 폭을 유지하고 건물 앞에 양쪽 인도 공간을 확보한다', () => {
    const chunk = buildChunk(0);
    expect(chunk.road.halfExtents[0] * 2).toBe(gameConfig.world.roadWidthM);
    for (const building of chunk.buildings) {
      const innerFace = Math.abs(building.center[0]) - building.halfExtents[0];
      expect(innerFace - chunk.road.halfExtents[0]).toBe(gameConfig.world.buildingSetbackM);
    }
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

  it('모든 구간이 같은 난수 높이 규칙을 쓴다', () => {
    // 구간 0의 고정 높이 특례를 없앴다. 어느 구간이든 높이가 설정 범위 안에서 흩어져야 한다.
    const [minHeight, maxHeight] = gameConfig.world.buildingHeightRangeM;
    for (const index of [0, 1, 7]) {
      const heights = buildChunk(index).buildings.map((building) => building.halfExtents[1] * 2);
      expect(heights.length).toBeGreaterThan(1);
      expect(new Set(heights).size).toBeGreaterThan(1);
      for (const height of heights) {
        expect(height).toBeGreaterThanOrEqual(minHeight);
        expect(height).toBeLessThanOrEqual(maxHeight);
      }
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
