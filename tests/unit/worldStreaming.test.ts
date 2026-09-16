import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { gameConfig } from '../../shared/config';
import { ChunkedWorld, chunkBuildingColliders } from '../../client/host/world';
import { PhysicsWorld } from '../../client/host/physics';
import { createChunkMeshes } from '../../client/host/scene';
import { defaultSwingOptions, selectTarget } from '../../client/host/web';

// 수평 기준 yaw(좌우)·pitch(상하) 각도를 발사 방향 단위벡터로 바꾼다. 전방은 -Z다.
function aimDirection(yawDeg: number, pitchDeg: number): [number, number, number] {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

// main.ts와 같은 방식으로 월드·물리·렌더를 묶어, 멀리 전진해도 도로와 표적이 이어지는지 확인한다.
describe('무한 도로 스트리밍', () => {
  it('500m 전진해도 앞 구간의 건물과 바닥이 존재하고 객체 수가 누적되지 않는다', async () => {
    const physics = await PhysicsWorld.create();
    const scene = new THREE.Scene();
    const chunkMeshes = createChunkMeshes(scene);
    const world = new ChunkedWorld({
      onAdd: (chunk) => {
        chunkMeshes.add(chunk);
        physics.addChunk(chunk.index, chunk.road, chunkBuildingColliders(chunk));
      },
      onRemove: (chunkIndex) => {
        chunkMeshes.remove(chunkIndex);
        physics.removeChunk(chunkIndex);
      },
    });

    physics.createPlayer(world.startPosition);
    world.reset();

    const swingOptions = defaultSwingOptions();
    const y = gameConfig.physics.startHeight;
    const counts: number[] = [];
    for (let z = 0; z >= -500; z -= 10) {
      world.update(z, null);
      physics.setPlayerPosition([0, y, z]);
      physics.step();

      // 후보점 배열이 사라졌으므로 "걸 곳이 이어진다"를 실제 발사 경로로 확인한다. 건물 사이
      // 간격(2~6m) 때문에 특정 각도가 비는 것은 정상이라, 몇 가지 조준 중 하나만 걸리면 된다.
      for (const side of [-1, 1]) {
        // 인도로 건물이 멀어졌으므로 허용 조준 범위 안에서 더 넓게 훑는다.
        const found = [15, 25, 35, 45, 55, 65].some(
          (yawDeg) =>
            selectTarget([0, y, z], aimDirection(side * yawDeg, 30), physics, swingOptions) !==
            null,
        );
        expect(found, `z=${z}, side=${side}에 걸 곳 없음`).toBe(true);
      }

      counts.push(scene.children.length);
    }

    // 도로도 끝까지 이어진다.
    physics.setPlayerPosition([0, 2, -500]);
    let touched = false;
    for (let i = 0; i < 300 && !touched; i++) {
      physics.step();
      touched = physics.didTouchGroundThisStep();
    }
    expect(touched).toBe(true);

    const maxChunks = gameConfig.world.chunksAhead + gameConfig.world.chunksBehind + 1;
    expect(Math.max(...counts)).toBeLessThanOrEqual(maxChunks);
    expect(world.activeChunkIndices.length).toBe(maxChunks);
    physics.dispose();
  });
});
