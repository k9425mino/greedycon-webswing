import { expect, it } from 'vitest';
import * as THREE from 'three';
import { gameConfig } from '../../shared/config';
import { buildChunk } from '../../client/host/world';
import { landmarkColliders } from '../../client/host/models/landmarkPlacement';
import { createChunkMeshes } from '../../client/host/scene';
import { PhysicsWorld } from '../../client/host/physics';

function landmarkChunk(kind: string, index: number) {
  for (let seed = 0; seed < 1000; seed++) {
    const chunk = buildChunk(index, seed);
    if (chunk.landmark?.kind === kind && chunk.landmark.side === 1) return chunk;
  }
  throw new Error(`랜드마크 테스트 배치 없음: ${kind}`);
}

it('탑 벽에는 거미줄이 맞고 예배당 위 빈 공간과 회수한 구간에는 맞지 않는다', async () => {
  const physics = await PhysicsWorld.create();
  try {
    const chunk = landmarkChunk('aejiheon', 2);
    const placement = chunk.landmark!;
    const z = placement.position[2];
    const colliders = landmarkColliders(placement);
    physics.addChunk(chunk.index, chunk.road, colliders);
    physics.createPlayer([0, 20, z]);
    physics.step();
    // 탑 몸통 충돌체의 도로 쪽 면. 배율을 바꿔도 같은 면을 가리킨다.
    const towerWallX = colliders[1]!.center[0] - colliders[1]!.halfExtents[0];
    expect(physics.raycastBuilding([0, 20, z], [1, 0, 0], 70)?.point[0]).toBeCloseTo(towerWallX);
    expect(physics.raycastBuilding([0, 20, z + 10], [1, 0, 0], 70)).toBeNull();
    expect(physics.raycastBuilding([0, 5, z + 10], [1, 0, 0], 70)).not.toBeNull();
    physics.removeChunk(chunk.index);
    expect(physics.raycastBuilding([0, 20, z], [1, 0, 0], 70)).toBeNull();
  } finally {
    physics.dispose();
  }
});

it('무작위 랜드마크도 도로를 향하고 구간 경계와 주변 건물을 침범하지 않는다', () => {
  const indices: number[] = [];
  for (let index = -2; index < 23; index++) {
    const chunk = buildChunk(index);
    if (!chunk.landmark) continue;
    indices.push(index);
    expect(chunk).toEqual(buildChunk(index));
    const { side, position } = chunk.landmark;
    const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      (-side * Math.PI) / 2,
    );
    expect(front.x * position[0]).toBeLessThan(0);
    const colliders = landmarkColliders(chunk.landmark);
    if (chunk.landmark.kind === 'aejiheon')
      expect(Math.abs(colliders[8]!.center[0])).toBeGreaterThan(Math.abs(position[0]));
    for (const collider of colliders) {
      expect(Math.abs(collider.center[0]) - collider.halfExtents[0]).toBeGreaterThanOrEqual(
        gameConfig.world.roadWidthM / 2 + gameConfig.world.buildingSetbackM - 1e-6,
      );
      expect(collider.center[2] + collider.halfExtents[2]).toBeLessThanOrEqual(-index * 60);
      expect(collider.center[2] - collider.halfExtents[2]).toBeGreaterThanOrEqual(
        -(index + 1) * 60,
      );
      for (const building of chunk.buildings) {
        const overlap = [0, 1, 2].every(
          (axis) =>
            Math.abs(collider.center[axis]! - building.center[axis]!) <
            collider.halfExtents[axis]! + building.halfExtents[axis]!,
        );
        expect(overlap).toBe(false);
      }
    }
  }
  expect(indices).toEqual([2, 6, 10, 14, 18, 22]);
});

it('랜드마크 구간을 회수·재생성해도 모델 자원을 재사용한다', () => {
  const scene = new THREE.Scene();
  const chunks = createChunkMeshes(scene);
  const chunk = landmarkChunk('aejiheon', 2);
  chunks.add(chunk);
  const first = scene.getObjectByName('Daeyang Tower')!.children[0] as THREE.Mesh;
  const geometry = first.geometry;
  const material = first.material;
  chunks.remove(2);
  expect(scene.children).toHaveLength(0);
  chunks.add(chunk);
  const second = scene.getObjectByName('Daeyang Tower')!.children[0] as THREE.Mesh;
  expect(second).not.toBe(first);
  expect(second.geometry).toBe(geometry);
  expect(second.material).toBe(material);
  chunks.remove(2);
});

it('네이버 사옥이 게임에 생성되고 유리 외벽에 거미줄이 맞으며 구간 회수 시 제거된다', async () => {
  const chunk = landmarkChunk('naver', 14);
  expect(chunk.landmark?.kind).toBe('naver');
  const scene = new THREE.Scene();
  const chunks = createChunkMeshes(scene);
  const physics = await PhysicsWorld.create();
  try {
    chunks.add(chunk);
    const model = scene.getObjectByName('NAVER Green Factory')!;
    expect(model).toBeDefined();
    const { position, side } = chunk.landmark!;
    expect(model.position.toArray()).toEqual(position);
    physics.addChunk(chunk.index, chunk.road, landmarkColliders(chunk.landmark!));
    physics.createPlayer([0, 35, position[2]]);
    physics.step();
    const hit = physics.raycastBuilding([0, 35, position[2]], [side, 0, 0], 70);
    expect(hit?.point[0]).toBeCloseTo(position[0] - side * 11);
    expect(physics.raycastBuilding([0, 90, position[2]], [side, 0, 0], 70)).toBeNull();
    chunks.remove(chunk.index);
    physics.removeChunk(chunk.index);
    expect(scene.getObjectByName('NAVER Green Factory')).toBeUndefined();
    expect(physics.raycastBuilding([0, 35, position[2]], [side, 0, 0], 70)).toBeNull();
  } finally {
    physics.dispose();
  }
});
