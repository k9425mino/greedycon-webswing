import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { gameConfig } from '../../shared/config';
import { ChunkedWorld } from '../../client/host/world';
import { PhysicsWorld } from '../../client/host/physics';
import { createChunkMeshes } from '../../client/host/scene';
import { defaultSwingOptions, selectTarget } from '../../client/host/web';

// main.ts와 같은 방식으로 월드·물리·렌더를 묶어, 멀리 전진해도 도로와 표적이 이어지는지 확인한다.
describe('무한 도로 스트리밍', () => {
  it('500m 전진해도 앞 구간의 건물과 바닥이 존재하고 객체 수가 누적되지 않는다', async () => {
    const physics = await PhysicsWorld.create();
    const scene = new THREE.Scene();
    const chunkMeshes = createChunkMeshes(scene);
    const world = new ChunkedWorld({
      onAdd: (chunk) => {
        chunkMeshes.add(chunk);
        physics.addChunk(chunk.index, chunk.road, chunk.buildings);
      },
      onRemove: (chunkIndex) => {
        chunkMeshes.remove(chunkIndex);
        physics.removeChunk(chunkIndex);
      },
    });

    physics.createPlayer(world.startPosition);
    world.reset();

    const y = gameConfig.physics.startHeight;
    const counts: number[] = [];
    for (let z = 0; z >= -500; z -= 10) {
      world.update(z, null);
      physics.setPlayerPosition([0, y, z]);
      physics.step();

      // 전방 좌우에 사거리 안의 부착 후보가 항상 남아 있다.
      for (const side of [-1, 1]) {
        const ahead = world.candidates.filter((candidate) => {
          if (Math.sign(candidate.point[0]) !== side) return false;
          if (candidate.point[2] > z) return false;
          const dx = candidate.point[0];
          const dy = candidate.point[1] - y;
          const dz = candidate.point[2] - z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          return distance >= gameConfig.web.minFireDistance && distance <= gameConfig.web.maxFireDistance;
        });
        expect(ahead.length, `z=${z}, side=${side}에 도달 가능한 후보 없음`).toBeGreaterThan(0);
      }

      // 후보를 실제로 겨누면 selectTarget이 부착점을 돌려준다.
      const candidate = world.candidates.find((c) => c.point[2] < z - 20 && c.point[0] < 0);
      if (candidate) {
        const dx = candidate.point[0];
        const dy = candidate.point[1] - y;
        const dz = candidate.point[2] - z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const target = selectTarget(
          [0, y, z],
          [dx / len, dy / len, dz / len],
          world.candidates,
          physics,
          defaultSwingOptions(),
        );
        expect(target, `z=${z}에서 표적 선택 실패`).not.toBeNull();
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
