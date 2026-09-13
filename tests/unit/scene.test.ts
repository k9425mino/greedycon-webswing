import { expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createChunkMeshes,
  createFireBeamLine,
  createRopeLine,
  updateFireBeamLine,
  updateRopeLine,
} from '../../client/host/scene';
import { buildChunk } from '../../client/host/world';

it('정면으로 빗나간 발사도 화면에서 길이를 가진 선으로 보인다', () => {
  const line = createFireBeamLine(new THREE.Scene());
  updateFireBeamLine(line, [0, 0, 0], [0, 0, -70], 1);
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500);
  const positions = line.geometry.getAttribute('position');
  const start = new THREE.Vector3().fromBufferAttribute(positions, 0).project(camera);
  const end = new THREE.Vector3().fromBufferAttribute(positions, 1).project(camera);

  expect([start.x, start.y, start.z].every(Number.isFinite)).toBe(true);
  expect(Math.abs(start.x)).toBeLessThan(1);
  expect(Math.abs(start.y)).toBeLessThan(1);
  expect(start.z).toBeGreaterThan(-1);
  expect(start.z).toBeLessThan(1);
  expect(Math.hypot(start.x - end.x, start.y - end.y)).toBeGreaterThan(0.1);
  expect(end.x).toBeCloseTo(0);
  expect(end.y).toBeCloseTo(0);
  updateFireBeamLine(line, [0, 0, 0], null, 0);
  expect(line.visible).toBe(false);
  line.geometry.dispose();
});

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

it('같은 위치의 건물은 재생성해도 항상 같은 색을 받는다(결정적 장식 배치)', () => {
  const scene = new THREE.Scene();
  const chunkMeshes = createChunkMeshes(scene);
  const chunk = buildChunk(2);

  chunkMeshes.add(chunk);
  const group = scene.children[0] as THREE.Group;
  const colorsBefore = group.children
    .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
    .map((mesh) => (mesh.material as THREE.MeshStandardMaterial).color?.getHex());
  chunkMeshes.remove(chunk.index);

  chunkMeshes.add(chunk);
  const groupAfter = scene.children[0] as THREE.Group;
  const colorsAfter = groupAfter.children
    .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
    .map((mesh) => (mesh.material as THREE.MeshStandardMaterial).color?.getHex());

  expect(colorsAfter).toEqual(colorsBefore);
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
