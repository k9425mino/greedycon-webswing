import { expect, it } from 'vitest';
import * as THREE from 'three';
import { createChunkMeshes, createRopeLine, updateRopeLine } from '../../client/host/scene';
import { buildChunk } from '../../client/host/world';

it('이동한 거미줄이 카메라 안에 있으면 이전 위치의 경계 때문에 숨겨지지 않는다', () => {
  const line = createRopeLine(new THREE.Scene());
  updateRopeLine(line, [100, 0, -10], [110, 0, -10]);
  line.geometry.computeBoundingSphere();
  updateRopeLine(line, [0, 0, -10], [0, 5, -10]);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(camera.projectionMatrix);
  expect(frustum.intersectsObject(line)).toBe(true);
  line.geometry.dispose();
});

it('구간을 생성·회수해도 scene 객체 수가 누적되지 않는다', () => {
  const scene = new THREE.Scene();
  const chunkMeshes = createChunkMeshes(scene);

  for (let index = 0; index < 20; index++) {
    chunkMeshes.add(buildChunk(index));
    if (index >= 3) chunkMeshes.remove(index - 3);
  }
  expect(scene.children.length).toBe(3);

  for (let index = 17; index < 20; index++) chunkMeshes.remove(index);
  expect(scene.children.length).toBe(0);
});
