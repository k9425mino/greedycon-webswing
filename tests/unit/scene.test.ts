import { expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createChunkMeshes,
  createWebSplat,
  createWebStrand,
  saggedPath,
  updateWebSplat,
  updateWebStrand,
} from '../../client/host/scene';
import { buildChunk } from '../../client/host/world';
import { gameConfig } from '../../shared/config';

it('카메라 위치에서 시작한 거미줄도 화면에서 길이를 가진다', () => {
  const strand = createWebStrand(new THREE.Scene());
  // 가닥의 시작점은 매 프레임 카메라(=플레이어) 위치다. 오프셋이 없으면 한 점으로 투영된다.
  updateWebStrand(
    strand,
    [
      [0, 0, 0],
      [0, 0, -70],
    ],
    [0, 0, 0],
    1,
    true,
  );
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500);
  const positions = strand.core.geometry.getAttribute('position');
  const start = new THREE.Vector3().fromBufferAttribute(positions, 0).project(camera);
  const end = strand.tip.position.clone().project(camera);

  expect(strand.group.visible).toBe(true);
  expect([start.x, start.y, start.z].every(Number.isFinite)).toBe(true);
  expect(Math.abs(start.x)).toBeLessThan(1);
  expect(Math.abs(start.y)).toBeLessThan(1);
  expect(Math.hypot(start.x - end.x, start.y - end.y)).toBeGreaterThan(0.1);
  // 끝점(물리 앵커·부착 판정 지점)은 옮기지 않는다.
  expect(strand.tip.position.toArray()).toEqual([0, 0, -70]);
});

it('거미줄이 없거나 다 흐려지면 그리지 않는다', () => {
  const strand = createWebStrand(new THREE.Scene());
  updateWebStrand(
    strand,
    [
      [0, 0, 0],
      [0, 6, -20],
    ],
    [0, 0, 0],
    1,
  );
  expect(strand.group.visible).toBe(true);
  expect(strand.tip.visible).toBe(false);

  updateWebStrand(strand, null, [0, 0, 0], 1);
  expect(strand.group.visible).toBe(false);
  updateWebStrand(
    strand,
    [
      [0, 0, 0],
      [0, 6, -20],
    ],
    [0, 0, 0],
    0,
  );
  expect(strand.group.visible).toBe(false);
});

it('섬유 모델은 경로 변경 시 메시를 재사용하고 방사형 접착망은 쓰지 않는다', () => {
  const strand = createWebStrand(new THREE.Scene());
  updateWebStrand(
    strand,
    [
      [0, 0, 0],
      [0, 0, -20],
    ],
    [0, 0, 0],
    1,
  );
  const geometry = strand.core.geometry;
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
  for (let i = 0; i < normals.count; i += 31) {
    expect(new THREE.Vector3().fromBufferAttribute(normals, i).length()).toBeCloseTo(1);
  }
  expect(strand.core.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  expect(strand.silk.attachment.visible).toBe(false);
  updateWebStrand(
    strand,
    [
      [0, 0, 0],
      [2, 6, -30],
    ],
    [0, 0, 0],
    0.4,
    true,
  );
  expect(strand.core.geometry).toBe(geometry);
  expect(strand.silk.attachment.visible).toBe(false);
  expect((strand.core.material as THREE.MeshPhysicalMaterial).opacity).toBe(0.4);
});

it('이동한 거미줄이 카메라 안에 있으면 이전 위치의 경계 때문에 숨겨지지 않는다', () => {
  const strand = createWebStrand(new THREE.Scene());
  updateWebStrand(
    strand,
    [
      [100, 0, -10],
      [110, 0, -10],
    ],
    [0, 0, 0],
    1,
  );
  updateWebStrand(
    strand,
    [
      [0, 0, -10],
      [0, 5, -10],
    ],
    [0, 0, 0],
    1,
  );

  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(camera.projectionMatrix);
  expect(frustum.intersectsObject(strand.core)).toBe(true);
});

it('부착 줄은 양 끝을 그대로 두고 가운데만 늘어뜨린다', () => {
  const path = saggedPath([0, 10, 0], [0, 10, -30], 4);
  expect(path[0]).toEqual([0, 10, 0]);
  expect(path[4]).toEqual([0, 10, -30]);
  // 가운데는 직선보다 아래에 있고, 처짐은 상한(1.2m) 안이다.
  expect(path[2]![1]).toBeLessThan(10);
  expect(path[2]![1]).toBeGreaterThan(10 - 1.3);
});

it('모든 일반 건물을 오피스로 대체하고 회수 후에도 모델 자원을 재사용한다', () => {
  const scene = new THREE.Scene();
  const chunkMeshes = createChunkMeshes(scene);
  const chunk = buildChunk(2);

  chunkMeshes.add(chunk);
  const group = scene.children[0] as THREE.Group;
  const offices = group.children.filter((child) => child.name.startsWith('Office '));
  expect(offices).toHaveLength(chunk.buildings.length);
  offices.forEach((office, index) => {
    const spec = chunk.buildings[index]!;
    expect(office.name).toBe(`Office ${spec.style}`);
    const bounds = new THREE.Box3().setFromObject(office);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    spec.halfExtents.forEach((half, axis) => expect(size.getComponent(axis)).toBeCloseTo(half * 2));
    spec.center.forEach((value, axis) => expect(center.getComponent(axis)).toBeCloseTo(value));
  });
  const first = offices[0]!.children[0] as THREE.Mesh;
  chunkMeshes.remove(chunk.index);

  chunkMeshes.add(chunk);
  const groupAfter = scene.children[0] as THREE.Group;
  const recreated = groupAfter.children.filter((child) => child.name.startsWith('Office '));
  expect(recreated.map((office) => office.name)).toEqual(offices.map((office) => office.name));
  const second = recreated[0]!.children[0] as THREE.Mesh;
  expect(second.geometry).toBe(first.geometry);
  expect(second.material).toBe(first.material);
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

it('부착 자국은 옆벽·정면·옥상의 표면 방향에 맞춰 밀착한다', () => {
  const splat = createWebSplat(new THREE.Scene());
  expect(splat.visible).toBe(false);

  updateWebSplat(splat, [0, 0, -20], [0, 0, 1]);
  expect(splat.visible).toBe(true);
  expect(splat.scale.x).toBe(gameConfig.effects.attachSplatRadiusM);
  expect(splat.position.z).toBeCloseTo(-19.985);
  expect(splat.position.x).toBeCloseTo(0);

  for (const normal of [
    [-1, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ] as [number, number, number][]) {
    const point: [number, number, number] = [16, 20, -30];
    updateWebSplat(splat, point, normal);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(splat.quaternion);
    expect(facing.distanceTo(new THREE.Vector3(...normal))).toBeLessThan(1e-6);
    expect(
      splat.position
        .clone()
        .sub(new THREE.Vector3(...point))
        .dot(facing),
    ).toBeCloseTo(0.015);
  }

  updateWebSplat(splat, null, [0, 0, 0]);
  expect(splat.visible).toBe(false);
});
