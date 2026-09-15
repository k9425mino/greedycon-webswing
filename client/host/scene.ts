import * as THREE from 'three';
import { gameConfig } from '@shared/config';
import type { Chunk } from './world';
import type { BoxSpec, Vec3 } from './physics';
import { createAejiheon } from './models/aejiheon';
import { createDaeyangAi } from './models/daeyangAi';

export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd8f5);

  const camera = new THREE.PerspectiveCamera(gameConfig.cameraVerticalFovDeg, 1, 0.1, 500);

  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff2cf, 0.7);
  sun.position.set(10, 30, 10);
  scene.add(sun);

  // 캔버스의 부모(#game-area)가 운영자 패널을 제외한 실제 게임 영역이다.
  const container = canvas.parentElement ?? canvas;
  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  window.addEventListener('resize', resize);
  resize();

  function render() {
    renderer.render(scene, camera);
  }

  return { renderer, scene, camera, render };
}

// 테스트 환경(Node/Vitest)에는 document가 없다. 브라우저에서만 캔버스 텍스처를 만들고,
// 그 외에는 null을 돌려줘 material이 단색으로 대체되게 한다(장식은 순수 시각 요소이므로 안전하다).
function tryCreateCanvas(width: number, height: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 창문 격자 텍스처. 흰 바탕(=재질 색 그대로) 위에 어두운 유리 칸을 찍어 모든 건물 재질이 함께 쓴다.
function createWindowTexture(): THREE.Texture | null {
  const ctx = tryCreateCanvas(128, 128);
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#33465e';
  const cols = 4;
  const rows = 6;
  const cellW = 128 / cols;
  const cellH = 128 / rows;
  const pad = cellW * 0.16;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillRect(c * cellW + pad, r * cellH + pad, cellW - pad * 2, cellH - pad * 2);
    }
  }
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 4);
  return texture;
}

// 차선 텍스처. 도로 구간 길이(chunkLengthM)에 맞춰 한 번만 만들고 모든 구간이 공유한다.
function createRoadTexture(chunkLengthM: number): THREE.Texture | null {
  const ctx = tryCreateCanvas(128, 512);
  if (!ctx) return null;
  ctx.fillStyle = '#4d4d57';
  ctx.fillRect(0, 0, 128, 512);
  ctx.strokeStyle = '#f5d547';
  ctx.lineWidth = 6;
  ctx.setLineDash([28, 20]);
  ctx.beginPath();
  ctx.moveTo(64, 0);
  ctx.lineTo(64, 512);
  ctx.stroke();
  ctx.strokeStyle = '#e8e8ec';
  ctx.lineWidth = 4;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(10, 512);
  ctx.moveTo(118, 0);
  ctx.lineTo(118, 512);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, chunkLengthM / 12);
  return texture;
}

const SIGN_WORDS = ['분식', '노래방', '문구점', 'PC방', '세탁소', '편의점', '떡볶이', '옷수선'];

function createSignTexture(text: string): THREE.Texture | null {
  const ctx = tryCreateCanvas(256, 96);
  if (!ctx) return null;
  ctx.fillStyle = '#1c2030';
  roundRectPath(ctx, 3, 3, 250, 90, 10);
  ctx.fill();
  ctx.strokeStyle = '#f5d547';
  ctx.lineWidth = 5;
  roundRectPath(ctx, 5, 5, 246, 86, 9);
  ctx.stroke();
  ctx.fillStyle = '#f5d547';
  ctx.font = 'bold 46px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 52);
  return new THREE.CanvasTexture(ctx.canvas);
}

// 밝은 한국풍 파스텔 팔레트. 재질은 모듈 상수로 두어 게임 내내 재사용하며 폐기하지 않는다.
// (테스트 환경엔 document가 없어 텍스처가 null일 수 있다. THREE.Material에 map:undefined를 그대로
// 넘기면 경고가 나므로, 텍스처가 있을 때만 map 속성을 넣는다.)
const BUILDING_COLORS = [0xffd7a8, 0xa7e8dc, 0xfff0b0, 0xffb9d6, 0xb9e0ff];
const windowTexture = createWindowTexture();
const buildingMaterials = BUILDING_COLORS.map(
  (color) =>
    new THREE.MeshStandardMaterial({ color, ...(windowTexture ? { map: windowTexture } : {}) }),
);
const roadTexture = createRoadTexture(gameConfig.world.chunkLengthM);
const roadMaterial = new THREE.MeshStandardMaterial({
  color: 0x4d4d57,
  ...(roadTexture ? { map: roadTexture } : {}),
});
const signMaterials = SIGN_WORDS.map((word) => {
  const texture = createSignTexture(word);
  return texture ? new THREE.MeshBasicMaterial({ map: texture }) : null;
}).filter((m): m is THREE.MeshBasicMaterial => m !== null);

const playerGeometry = new THREE.SphereGeometry(gameConfig.physics.playerRadius, 16, 12);
const playerMaterial = new THREE.MeshStandardMaterial({ color: 0xf92672 });
// 밝은 하늘·건물 배경에서도 뚜렷하게 보이도록 채도 높은 진한 색을 쓴다.
const ropeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
const fireBeamMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true });
const attachFlashGeometry = new THREE.RingGeometry(0.3, 0.6, 24);
const attachFlashMaterial = new THREE.MeshBasicMaterial({
  color: 0xa6e22e,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

function boxMesh(spec: BoxSpec, material: THREE.Material): THREE.Mesh {
  const [w, h, d] = spec.halfExtents;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * 2, h * 2, d * 2), material);
  mesh.position.set(...spec.center);
  return mesh;
}

// 건물 위치로 결정하는 안정적인 해시. 같은 건물은 항상 같은 색·간판을 받는다(재생성돼도 동일).
function hashFor(spec: BoxSpec): number {
  const [x, , z] = spec.center;
  return Math.abs(Math.round(x * 131 + z * 17));
}

// 도로 안쪽(플레이어 쪽) 면에 한글 간판 하나를 붙인다. 구간 회수 시 지오메트리를 함께 폐기한다.
function signMesh(building: BoxSpec, hash: number): THREE.Mesh | null {
  if (signMaterials.length === 0) return null;
  if (hash % 3 !== 0) return null;
  // 길이 확인을 위에서 이미 했으므로 모듈로 인덱스는 항상 유효하다.
  const material = signMaterials[hash % signMaterials.length]!;
  const side = Math.sign(building.center[0]) || 1;
  const innerFaceX = building.center[0] - side * building.halfExtents[0];
  const signWidth = 3.2;
  const signHeight = 1.2;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(signWidth, signHeight), material);
  mesh.position.set(
    innerFaceX - side * 0.03,
    building.center[1] - building.halfExtents[1] + 3,
    building.center[2],
  );
  // 평면 기본 법선(+Z)이 도로(건물 안쪽) 방향을 보도록 Y축으로 회전한다.
  mesh.rotation.y = -side * (Math.PI / 2);
  return mesh;
}

// 구간 mesh는 Group 하나로 묶어 회수 시 통째로 제거한다.
// 건물·간판 재질은 모듈 상수로 공유하고 폐기하지 않는다. geometry만 구간마다 폐기한다.
export function createChunkMeshes(scene: THREE.Scene) {
  const groups = new Map<number, THREE.Group>();
  // 랜드마크의 geometry·material·texture는 한 번 만들고 구간 간 공유한다.
  // clone한 Group만 회수하며 공유 자원은 일반 건물 재질처럼 게임 수명 동안 유지한다.
  const landmarkTemplates = new Map<string, THREE.Group>();

  return {
    add(chunk: Chunk): void {
      if (groups.has(chunk.index)) return;
      const group = new THREE.Group();
      group.add(boxMesh(chunk.road, roadMaterial));
      if (chunk.landmark) {
        const kind = chunk.landmark.kind;
        let landmarkTemplate = landmarkTemplates.get(kind);
        if (!landmarkTemplate) {
          landmarkTemplate = kind === 'aejiheon' ? createAejiheon() : createDaeyangAi();
          landmarkTemplates.set(kind, landmarkTemplate);
        }
        const landmark = landmarkTemplate.clone();
        landmark.scale.setScalar(chunk.landmark.scale);
        landmark.position.set(...chunk.landmark.position);
        landmark.rotation.y = (-chunk.landmark.side * Math.PI) / 2;
        group.add(landmark);
      }
      for (const building of chunk.buildings) {
        const hash = hashFor(building);
        // buildingMaterials는 고정 팔레트에서 만든 비어 있지 않은 배열이라 모듈로 인덱스는 항상 유효하다.
        const material = buildingMaterials[hash % buildingMaterials.length]!;
        group.add(boxMesh(building, material));
        const sign = signMesh(building, hash);
        if (sign) group.add(sign);
      }
      groups.set(chunk.index, group);
      scene.add(group);
    },
    remove(chunkIndex: number): void {
      const group = groups.get(chunkIndex);
      if (!group) return;
      for (const child of group.children) {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      }
      scene.remove(group);
      groups.delete(chunkIndex);
    },
  };
}

export function createPlayerMesh(scene: THREE.Scene): THREE.Mesh {
  const mesh = new THREE.Mesh(playerGeometry, playerMaterial);
  scene.add(mesh);
  return mesh;
}

export function createRopeLine(scene: THREE.Scene): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);
  const line = new THREE.Line(geometry, ropeMaterial);
  line.visible = false;
  scene.add(line);
  return line;
}

// 카메라 원점에서 시작하면 선 전체가 한 점으로 투영된다. 전방 고정 카메라의 오른쪽 아래에서
// 보이게 옮기되, 실제 발사 판정과 물리 앵커(끝점)는 그대로 둔다.
function withBeamOrigin(from: Vec3): Vec3 {
  const offset = gameConfig.effects.beamOriginOffsetM;
  return [from[0] + offset[0], from[1] + offset[1], from[2] + offset[2]];
}

export function updateRopeLine(line: THREE.Line, from: Vec3, to: Vec3 | null): void {
  if (!to) {
    line.visible = false;
    return;
  }
  line.visible = true;
  const start = withBeamOrigin(from);
  const positions = line.geometry.attributes.position as THREE.BufferAttribute;
  positions.setXYZ(0, start[0], start[1], start[2]);
  positions.setXYZ(1, to[0], to[1], to[2]);
  positions.needsUpdate = true;
  // 정점 이동만으로는 프러스텀 판정에 쓰는 경계가 갱신되지 않는다.
  line.geometry.computeBoundingSphere();
}

// 발사 진행·빗나감에 표시하는 임시 선. 거미줄과 다른 색으로 구분한다.
export function createFireBeamLine(scene: THREE.Scene): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);
  const line = new THREE.Line(geometry, fireBeamMaterial);
  line.visible = false;
  scene.add(line);
  return line;
}

export function updateFireBeamLine(
  line: THREE.Line,
  from: Vec3,
  to: Vec3 | null,
  opacity: number,
): void {
  updateRopeLine(line, from, to);
  (line.material as THREE.LineBasicMaterial).opacity = opacity;
}

// 부착 성공 순간 잠깐 나타나는 원형 플래시. 카메라가 항상 -Z를 보고 롤이 없으므로
// 기본 평면(법선 +Z)이 그대로 화면을 향해 별도 빌보드 계산이 필요 없다.
export function createAttachFlash(scene: THREE.Scene): THREE.Mesh {
  const mesh = new THREE.Mesh(attachFlashGeometry, attachFlashMaterial);
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

export function showAttachFlashAt(mesh: THREE.Mesh, point: Vec3): void {
  mesh.position.set(...point);
  mesh.scale.setScalar(1);
  (mesh.material as THREE.MeshBasicMaterial).opacity = 1;
  mesh.visible = true;
}

// progress: 0(시작)~1(끝). 끝나면 호출부에서 visible=false 처리.
export function updateAttachFlash(mesh: THREE.Mesh, progress: number): void {
  mesh.scale.setScalar(1 + progress * 1.8);
  (mesh.material as THREE.MeshBasicMaterial).opacity = 1 - progress;
}

// 카메라는 플레이어 위치를 따라가되 회전은 물려받지 않는다(ARCHITECTURE 5절: 항상 도로 전방).
export function updateCameraPosition(camera: THREE.PerspectiveCamera, playerPosition: Vec3): void {
  camera.position.set(playerPosition[0], playerPosition[1], playerPosition[2]);
  camera.lookAt(playerPosition[0], playerPosition[1], playerPosition[2] - 1);
}
