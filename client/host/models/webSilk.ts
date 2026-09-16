import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 게임과 미리보기가 같은 섬유·감김·접착망 모델을 사용한다.
export function createWebSilk(): THREE.Group {
  const group = new THREE.Group();
  const fibers: THREE.BufferGeometry[] = [];
  const wraps: THREE.BufferGeometry[] = [];
  const attachment: THREE.BufferGeometry[] = [];
  const length = 32;
  const height = 5;
  const center = (t: number) =>
    new THREE.Vector3((t - 0.5) * length, height - Math.sin(t * Math.PI) * 0.38, 0);

  function thread(points: THREE.Vector3[], radius: number, target = fibers) {
    const curve = new THREE.CatmullRomCurve3(points);
    target.push(new THREE.TubeGeometry(curve, Math.max(24, points.length * 3), radius, 5, false));
  }

  // 중심도 가는 섬유로 구성해 틈과 세로 결이 남도록 한다.
  for (let strand = 0; strand < 38; strand++) {
    const phase = strand * 2.399963;
    const shell = Math.sqrt((strand + 0.5) / 38);
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const angle = phase + t * Math.PI * 2.2;
      const radius = shell * (0.17 + 0.05 * Math.sin(t * 17 + phase));
      const point = center(t);
      point.y += Math.cos(angle) * radius;
      point.z += Math.sin(angle) * radius;
      points.push(point);
    }
    thread(points, 0.013 + (strand % 4) * 0.003);
  }

  // 감긴 실의 간격과 반지름을 달리해 규칙적인 스프링처럼 보이지 않게 한다.
  for (let strand = 0; strand < 5; strand++) {
    const points: THREE.Vector3[] = [];
    const phase = strand * 1.73;
    for (let i = 0; i <= 260; i++) {
      const t = i / 260;
      const angle = t * Math.PI * (18 + strand * 0.8) + 0.65 * Math.sin(t * 25) + phase;
      const loose = Math.pow(0.5 + 0.5 * Math.sin(t * 33 + phase), 3);
      const radius = 0.22 + loose * (strand === 0 ? 0.55 : 0.34);
      const point = center(t);
      point.y += Math.cos(angle) * radius;
      point.z += Math.sin(angle) * radius;
      points.push(point);
    }
    thread(points, strand === 0 ? 0.027 : 0.013, wraps);
  }

  // 벽에 퍼지는 방사형 실 사이를 불규칙한 가로 실로 연결한다.
  const spokes: THREE.Vector3[][] = [];
  for (let spoke = 0; spoke < 22; spoke++) {
    const angle = (spoke / 22) * Math.PI * 2;
    const reach = 1.2 + 0.64 * (0.5 + 0.5 * Math.sin(spoke * 8.31));
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const spread = 0.14 + Math.pow(t, 2.3) * reach;
      points.push(
        new THREE.Vector3(12 + t * 4, height + Math.cos(angle) * spread, Math.sin(angle) * spread),
      );
    }
    spokes.push(points);
    thread(points, 0.01 + (spoke % 3) * 0.003, attachment);
  }
  for (let ring = 0; ring < 4; ring++) {
    for (let spoke = 0; spoke < spokes.length; spoke++) {
      if ((spoke + ring * 3) % 7 === 0) continue;
      const index = 9 + ring * 2;
      const a = spokes[spoke]![index]!;
      const b = spokes[(spoke + 1) % spokes.length]![index - (spoke % 2)]!;
      const middle = a.clone().lerp(b, 0.5);
      middle.x -= 0.12;
      middle.y -= 0.05;
      thread([a, middle, b], 0.008, attachment);
    }
  }

  const material = new THREE.MeshPhysicalMaterial({
    color: 0xe5e9ed,
    roughness: 0.32,
    metalness: 0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
  });
  for (const geometries of [fibers, wraps, attachment]) {
    const geometry = mergeGeometries(geometries);
    for (const part of geometries) part.dispose();
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
  }
  return group;
}

export function createDeformableWebSilk() {
  const group = createWebSilk();
  const meshes = group.children.slice() as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshPhysicalMaterial
  >[];
  const source = meshes.map((mesh) => ({
    positions: new Float32Array(mesh.geometry.getAttribute('position').array),
    normals: new Float32Array(mesh.geometry.getAttribute('normal').array),
  }));
  for (const mesh of meshes) {
    mesh.material.transparent = true;
    (mesh.geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(
      THREE.DynamicDrawUsage,
    );
    (mesh.geometry.getAttribute('normal') as THREE.BufferAttribute).setUsage(
      THREE.DynamicDrawUsage,
    );
  }
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const reference = new THREE.Vector3(0, 1, 0);
  return {
    group,
    core: meshes[0]!,
    attachment: meshes[2]!,
    update(points: THREE.Vector3[], radii: number[], opacity: number, attached: boolean) {
      // 경로마다 좌표계를 한 번만 계산하고 모든 섬유 정점에 재사용한다.
      const frames = points.map((point, i) => {
        tangent.subVectors(
          points[Math.min(i + 1, points.length - 1)]!,
          points[Math.max(i - 1, 0)]!,
        );
        if (tangent.lengthSq() < 1e-12) tangent.set(1, 0, 0);
        tangent.normalize();
        reference.set(0, Math.abs(tangent.y) > 0.95 ? 0 : 1, Math.abs(tangent.y) > 0.95 ? 1 : 0);
        side.crossVectors(tangent, reference).normalize();
        up.crossVectors(side, tangent).normalize();
        return { point, tangent: tangent.clone(), side: side.clone(), up: up.clone() };
      });
      meshes[2]!.visible = attached;
      meshes[0]!.material.opacity = opacity;
      for (let part = 0; part < meshes.length; part++) {
        const mesh = meshes[part]!;
        if (!mesh.visible) continue;
        const positions = mesh.geometry.getAttribute('position');
        const normals = mesh.geometry.getAttribute('normal');
        const original = source[part]!;
        for (let vertex = 0; vertex < positions.count; vertex++) {
          const offset = vertex * 3;
          const t = THREE.MathUtils.clamp((original.positions[offset]! + 16) / 32, 0, 1);
          const sample = t * (points.length - 1);
          const index = Math.min(Math.floor(sample), points.length - 2);
          const blend = sample - index;
          const a = frames[index]!;
          const b = frames[index + 1]!;
          up.lerpVectors(a.up, b.up, blend).normalize();
          side.lerpVectors(a.side, b.side, blend).normalize();
          tangent.lerpVectors(a.tangent, b.tangent, blend).normalize();
          const scale = THREE.MathUtils.lerp(radii[index]!, radii[index + 1]!, blend) / 0.22;
          // 정적 모델의 중심선을 빼고 현재 비행·처짐 경로로 옮긴다.
          const y = (original.positions[offset + 1]! - 5 + Math.sin(t * Math.PI) * 0.38) * scale;
          const z = original.positions[offset + 2]! * scale;
          positions.setXYZ(
            vertex,
            THREE.MathUtils.lerp(a.point.x, b.point.x, blend) + up.x * y + side.x * z,
            THREE.MathUtils.lerp(a.point.y, b.point.y, blend) + up.y * y + side.y * z,
            THREE.MathUtils.lerp(a.point.z, b.point.z, blend) + up.z * y + side.z * z,
          );
          normal
            .copy(tangent)
            .multiplyScalar(original.normals[offset]!)
            .addScaledVector(up, original.normals[offset + 1]!)
            .addScaledVector(side, original.normals[offset + 2]!)
            .normalize();
          normals.setXYZ(vertex, normal.x, normal.y, normal.z);
        }
        positions.needsUpdate = true;
        normals.needsUpdate = true;
        mesh.geometry.computeBoundingSphere();
      }
    },
  };
}
