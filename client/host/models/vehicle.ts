import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type VehicleKind = 'sedan' | 'suv' | 'hatchback' | 'taxi' | 'van' | 'truck' | 'bus';
export const VEHICLE_KINDS: VehicleKind[] = [
  'sedan',
  'suv',
  'hatchback',
  'taxi',
  'van',
  'truck',
  'bus',
];

// 차체 색 후보. 택시·트럭·버스는 고유 도색을 쓰므로 이 색을 무시한다.
export const VEHICLE_BODY_COLORS = [
  0xdfe3e7, 0x2e3237, 0x8b9199, 0x2b4f7d, 0x7d2f2c, 0x276049, 0xc9a227,
];

// 자동차는 순수 시각 요소다(충돌체 없음). 빠르게 스쳐 지나가고 대부분 위에서 내려다보므로
// 형태는 상자 몇 개로 단순하게 잡고, 종류별 실루엣(높이·캐빈 위치·길이)만 확실히 구분한다.
type Builder = ReturnType<typeof createBuilder>;

function createBuilder(materials: Record<string, THREE.Material>) {
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  function push(geometry: THREE.BufferGeometry, material: THREE.Material) {
    const list = parts.get(material) ?? [];
    list.push(geometry);
    parts.set(material, list);
  }
  return {
    // 바닥은 y=0, 앞은 -Z(주행 방향과 같다). 좌우는 x로 대칭이다.
    box(w: number, h: number, d: number, x: number, y: number, z: number, material: string) {
      const geometry = new THREE.BoxGeometry(w, h, d);
      geometry.translate(x, y, z);
      push(geometry, materials[material]!);
    },
    // 바퀴는 축이 x를 향하는 원기둥이다. 림은 조금 작은 밝은 원기둥을 겹쳐 둔다.
    wheels(halfTrack: number, radius: number, width: number, axlesZ: number[]) {
      for (const z of axlesZ) {
        for (const side of [-1, 1]) {
          const tire = new THREE.CylinderGeometry(radius, radius, width, 10);
          tire.rotateZ(Math.PI / 2);
          tire.translate(side * halfTrack, radius, z);
          push(tire, materials.dark!);
          const hub = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width * 1.06, 8);
          hub.rotateZ(Math.PI / 2);
          hub.translate(side * halfTrack, radius, z);
          push(hub, materials.trim!);
        }
      }
    },
    // 앞뒤 등. 크기는 종류와 무관하게 같고 위치만 받는다.
    lamps(halfWidth: number, y: number, frontZ: number, rearZ: number) {
      for (const side of [-1, 1]) {
        this.box(0.34, 0.16, 0.1, side * (halfWidth - 0.28), y, frontZ, 'lampFront');
        this.box(0.34, 0.18, 0.1, side * (halfWidth - 0.28), y, rearZ, 'lampRear');
      }
    },
    build(name: string): THREE.Group {
      const model = new THREE.Group();
      model.name = name;
      for (const [material, geometries] of parts) {
        const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
        mesh.castShadow = mesh.receiveShadow = true;
        model.add(mesh);
        geometries.forEach((geometry) => geometry.dispose());
      }
      return model;
    },
  };
}

// 승용차 세 종류는 하부 차체 + 캐빈 + 지붕의 같은 구성을 쓰고 치수만 다르다.
function buildCar(
  b: Builder,
  size: { length: number; width: number; wheelRadius: number; bodyTop: number; roofTop: number },
  cabin: { front: number; rear: number },
) {
  const { length, width, wheelRadius, bodyTop, roofTop } = size;
  const half = width / 2;
  const bottom = wheelRadius * 0.62;
  const cabinWidth = width - 0.16;
  b.box(width, bodyTop - bottom, length, 0, (bottom + bodyTop) / 2, 0, 'body');
  // 캐빈은 유리 상자 하나로 두고 그 위에 차체 색 지붕을 덮어 창과 지붕을 구분한다.
  b.box(
    cabinWidth,
    roofTop - bodyTop,
    cabin.rear - cabin.front,
    0,
    (bodyTop + roofTop) / 2,
    (cabin.front + cabin.rear) / 2,
    'glass',
  );
  b.box(
    cabinWidth + 0.02,
    0.09,
    cabin.rear - cabin.front - 0.3,
    0,
    roofTop,
    (cabin.front + cabin.rear) / 2,
    'body',
  );
  // 문 손잡이 높이의 캐릭터 라인과 앞뒤 범퍼.
  b.box(width + 0.03, 0.07, length * 0.78, 0, bodyTop - 0.22, 0, 'trim');
  for (const z of [-length / 2, length / 2]) {
    b.box(width + 0.02, 0.24, 0.16, 0, bottom + 0.18, z, 'dark');
  }
  b.wheels(half - 0.06, wheelRadius, 0.22, [
    -length / 2 + wheelRadius + 0.5,
    length / 2 - wheelRadius - 0.5,
  ]);
  b.lamps(half, bodyTop - 0.28, -length / 2 + 0.02, length / 2 - 0.02);
}

// 승합·트럭·버스의 옆면에 붙이는 긴 띠(창 또는 도색선).
function addSideBand(
  b: Builder,
  width: number,
  yRange: [number, number],
  zRange: [number, number],
  material: string,
) {
  for (const side of [-1, 1]) {
    b.box(
      0.06,
      yRange[1] - yRange[0],
      zRange[1] - zRange[0],
      (side * width) / 2,
      (yRange[0] + yRange[1]) / 2,
      (zRange[0] + zRange[1]) / 2,
      material,
    );
  }
}

export function createVehicle(kind: VehicleKind, bodyColor: number): THREE.Group {
  // 택시·트럭·버스는 도색이 정해져 있어 넘겨받은 색을 쓰지 않는다.
  const paint =
    kind === 'taxi'
      ? 0xf0a52a
      : kind === 'truck'
        ? 0xe8eaec
        : kind === 'bus'
          ? 0x2f6fb5
          : bodyColor;
  const b = createBuilder({
    body: new THREE.MeshStandardMaterial({ color: paint, metalness: 0.45, roughness: 0.38 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1c2b38, metalness: 0.6, roughness: 0.12 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x191b1e, roughness: 0.92 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xb4bbc2, metalness: 0.8, roughness: 0.3 }),
    lampFront: new THREE.MeshStandardMaterial({ color: 0xfff3cf, emissive: 0x6b5a2a }),
    lampRear: new THREE.MeshStandardMaterial({ color: 0xc02a20, emissive: 0x501008 }),
  });

  if (kind === 'sedan' || kind === 'taxi') {
    buildCar(
      b,
      { length: 4.6, width: 1.82, wheelRadius: 0.33, bodyTop: 1.0, roofTop: 1.46 },
      { front: -0.75, rear: 1.35 },
    );
    if (kind === 'taxi') {
      // 지붕 표시등과 옆면 띠. 멀리서도 택시인 것을 알아보게 하는 요소다.
      b.box(0.5, 0.2, 0.34, 0, 1.56, 0.1, 'trim');
      addSideBand(b, 1.84, [0.62, 0.74], [-1.6, 1.6], 'trim');
    }
  } else if (kind === 'suv') {
    buildCar(
      b,
      { length: 4.9, width: 1.96, wheelRadius: 0.39, bodyTop: 1.25, roofTop: 1.86 },
      { front: -0.9, rear: 1.7 },
    );
    // 루프랙과 검은 휠하우스 띠가 SUV 실루엣을 만든다.
    for (const side of [-1, 1]) b.box(0.08, 0.08, 2.6, side * 0.7, 1.92, 0.3, 'dark');
    b.box(1.99, 0.3, 4.9, 0, 0.5, 0, 'dark');
  } else if (kind === 'hatchback') {
    buildCar(
      b,
      { length: 3.94, width: 1.72, wheelRadius: 0.31, bodyTop: 0.98, roofTop: 1.5 },
      { front: -0.6, rear: 1.72 },
    );
  } else if (kind === 'van') {
    const length = 5.3;
    const width = 1.96;
    b.box(width, 1.72, length, 0, 1.06, 0, 'body');
    // 코가 짧은 원박스형이라 앞면 위쪽 전체가 앞유리다.
    b.box(width - 0.1, 0.72, 0.12, 0, 1.5, -length / 2 + 0.06, 'glass');
    addSideBand(b, width + 0.01, [1.28, 1.72], [-1.9, 2.0], 'glass');
    for (const z of [-length / 2, length / 2]) b.box(width + 0.02, 0.26, 0.18, 0, 0.42, z, 'dark');
    b.wheels(width / 2 - 0.05, 0.36, 0.24, [-length / 2 + 1.0, length / 2 - 0.9]);
    b.lamps(width / 2, 0.72, -length / 2 + 0.02, length / 2 - 0.02);
  } else if (kind === 'truck') {
    const width = 2.34;
    // 캐빈(앞 2.5m) + 화물 박스(뒤 4.6m). 박스는 밝은 회색이라 캐빈 도색과 구분된다.
    b.box(width, 1.9, 2.5, 0, 1.15, -2.3, 'body');
    b.box(width - 0.1, 0.78, 0.12, 0, 1.78, -3.5, 'glass');
    addSideBand(b, width + 0.01, [1.5, 2.04], [-3.3, -1.3], 'glass');
    b.box(width + 0.04, 2.5, 4.6, 0, 1.95, 1.4, 'trim');
    b.box(width + 0.06, 0.12, 4.6, 0, 0.72, 1.4, 'dark');
    b.box(width + 0.04, 0.34, 0.2, 0, 0.5, -3.55, 'dark');
    b.wheels(width / 2 - 0.06, 0.46, 0.3, [-2.6, 1.0, 2.2]);
    b.lamps(width / 2, 0.78, -3.56, 3.68);
  } else {
    const length = 11;
    const width = 2.5;
    b.box(width, 2.5, length, 0, 1.65, 0, 'body');
    b.box(width - 0.08, 1.0, 0.12, 0, 2.5, -length / 2 + 0.06, 'glass');
    b.box(width - 0.08, 0.9, 0.12, 0, 2.45, length / 2 - 0.06, 'glass');
    // 옆면 창 띠와 아래쪽 도색 띠. 시내버스 특유의 긴 가로줄이다.
    addSideBand(b, width + 0.01, [2.0, 2.78], [-4.9, 4.9], 'glass');
    addSideBand(b, width + 0.02, [1.12, 1.32], [-5.4, 5.4], 'trim');
    // 앞뒤 문은 오른쪽(+x) 면에만 둔다. 한국 시내버스의 승하차 면이다.
    for (const z of [-3.4, 2.2]) b.box(0.08, 1.7, 1.1, width / 2, 1.7, z, 'glass');
    for (const z of [-length / 2, length / 2]) b.box(width + 0.02, 0.3, 0.2, 0, 0.62, z, 'dark');
    b.wheels(width / 2 - 0.08, 0.5, 0.32, [-3.9, 3.2]);
    b.lamps(width / 2, 0.9, -length / 2 + 0.02, length / 2 - 0.02);
  }

  return b.build(`Vehicle ${kind}`);
}
