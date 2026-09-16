import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type OfficeKind = 'azure' | 'silver' | 'graphite';
export const OFFICE_KINDS: OfficeKind[] = ['azure', 'silver', 'graphite'];

// 사진의 유리 입면을 참고한 창작 3종. 12×60×18 외곽 안에 만들어 게임의 상자 충돌체와 맞춘다.
export function createOffice(kind: OfficeKind): THREE.Group {
  const model = new THREE.Group();
  model.name = `Office ${kind}`;
  const palette = {
    azure: { hue: 207, light: 43, frame: 0x678b9b, stone: 0xb9c7cb },
    silver: { hue: 193, light: 57, frame: 0xb9c9cc, stone: 0xd6d9d4 },
    graphite: { hue: 211, light: 27, frame: 0x7f817c, stone: 0x424d56 },
  }[kind];
  let texture: THREE.CanvasTexture | undefined;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1536;
    const ctx = canvas.getContext('2d')!;
    // 구름 같은 넓은 명암과 인접 건물의 반사 실루엣을 절차적으로 그린다.
    // 외부 사진을 텍스처로 쓰지 않아 워터마크나 촬영 원근이 외벽에 들어가지 않는다.
    for (let row = 0; row < 48; row++) {
      for (let col = 0; col < 16; col++) {
        const cloud = Math.sin(row * 0.23 + col * 0.32) * Math.cos(col * 0.4 - row * 0.17);
        const reflection = row > 26 + Math.sin(col * 0.7) * 7 ? -12 : 0;
        const light = palette.light + cloud * 13 + reflection + ((row * 7 + col * 11) % 5);
        ctx.fillStyle = `hsl(${palette.hue} ${kind === 'silver' ? 26 : 48}% ${light}%)`;
        ctx.fillRect(col * 32, row * 32, 32, 32);
        ctx.fillStyle = kind === 'silver' ? '#b9d4dc' : '#233f53';
        ctx.fillRect(col * 32, row * 32, 1.5, 32);
        ctx.fillRect(col * 32, row * 32, 32, 1.5);
        ctx.fillStyle = '#d1ecf033';
        ctx.fillRect(col * 32 + 2, row * 32 + 2, 28, 1);
      }
    }
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  }
  const glass = new THREE.MeshStandardMaterial({
    ...(texture
      ? { map: texture }
      : { color: new THREE.Color().setHSL(palette.hue / 360, 0.4, palette.light / 100) }),
    roughness: 0.28,
    metalness: 0.22,
  });
  const frame = new THREE.MeshStandardMaterial({
    color: palette.frame,
    metalness: 0.55,
    roughness: 0.4,
  });
  const stone = new THREE.MeshStandardMaterial({ color: palette.stone, roughness: 0.8 });
  const lobby = new THREE.MeshStandardMaterial({ color: 0x163b50, metalness: 0.2, roughness: 0.3 });
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  function box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
  ) {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(x, y, z);
    const list = parts.get(material) ?? [];
    list.push(geometry);
    parts.set(material, list);
  }
  box(12, 0.35, 18, 0, 0.175, 0, stone);
  box(11.9, 4.2, 17.9, 0, 2.45, 0, lobby);
  box(11.8, 54.3, 17.8, 0, 31.65, 0, glass);
  box(12, 1.2, 18, 0, 59.4, 0, frame);
  // 양쪽 길가 입면에 로비 기둥과 문·캐노피를 넣는다.
  for (const x of [-5.95, 5.95]) {
    for (let z = -8; z <= 8; z += 4) box(0.1, 4.1, 0.22, x, 2.4, z, stone);
    box(0.1, 0.2, 7, x, 3.8, 0, frame);
    for (const z of [-2, 0, 2]) box(0.1, 3.2, 0.08, x, 1.95, z, frame);
  }
  if (kind === 'azure') {
    // 파란 커튼월: 가는 층 띠와 은색 모서리로 단정한 격자를 강조한다.
    for (let y = 4.6; y < 59; y += 3) box(12, 0.085, 18, 0, y, 0, frame);
    for (const x of [-5.94, 5.94]) {
      for (const z of [-8.94, 8.94]) box(0.12, 54.4, 0.12, x, 31.7, z, frame);
    }
  } else if (kind === 'silver') {
    // 은빛 타워: 외벽 전면의 깊이 있는 수직 핀과 두꺼운 상단 테두리.
    for (const x of [-5.95, 5.95]) {
      for (let z = -8.8; z <= 8.8; z += 1.1) box(0.1, 54.3, 0.12, x, 31.65, z, frame);
    }
    for (const z of [-8.95, 8.95]) {
      for (let x = -5.8; x <= 5.8; x += 1.16) box(0.12, 54.3, 0.1, x, 31.65, z, frame);
    }
    box(12, 0.45, 18, 0, 4.5, 0, stone);
    box(12, 0.6, 18, 0, 58.7, 0, stone);
  } else {
    // 흑연색 타워: 수평 벨트와 엇갈린 밝은 수직 프레임의 큰 구획.
    for (const y of [4.6, 18, 31.5, 45, 58.6]) box(12, 0.65, 18, 0, y, 0, frame);
    for (const x of [-5.95, 5.95]) {
      for (let floor = 0; floor < 4; floor++) {
        for (const z of [-6 + (floor % 2) * 3, 3 + (floor % 2) * 3]) {
          box(0.1, 12.7, 0.28, x, 11.2 + floor * 13.5, z, frame);
        }
      }
    }
    for (const z of [-8.95, 8.95]) {
      for (const x of [-3, 3]) box(0.2, 54.3, 0.1, x, 31.65, z, frame);
    }
  }
  // 반복 건물이므로 부재 수와 관계없이 건물당 재질 4개의 draw call만 사용한다.
  for (const [material, geometries] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.castShadow = mesh.receiveShadow = true;
    model.add(mesh);
    geometries.forEach((geometry) => geometry.dispose());
  }
  return model;
}
