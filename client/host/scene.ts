import * as THREE from 'three';
import { gameConfig } from '@shared/config';
import type { Chunk } from './world';
import type { BoxSpec, Vec3 } from './physics';
import { createAejiheon } from './models/aejiheon';
import { createDaeyangAi } from './models/daeyangAi';
import { createGwanggaeto } from './models/gwanggaeto';
import { createDeformableWebSilk } from './models/webSilk';

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

// 보도 바닥 텍스처. 도로 밖 공허를 채우는 판 하나에 2m 보도블록 격자가 반복되도록 쓴다.
function createPavementTexture(): THREE.Texture | null {
  const ctx = tryCreateCanvas(64, 64);
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = '#cfcabf';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, 61, 61);
  ctx.beginPath();
  ctx.moveTo(32, 0);
  ctx.lineTo(32, 64);
  ctx.moveTo(0, 32);
  ctx.lineTo(64, 32);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
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
// 보도 판은 구간 하나를 통째로 덮는 넓은 박스라 텍스처 반복도 구간 크기에 맞춰 한 번만 정한다.
const pavementTexture = createPavementTexture();
pavementTexture?.repeat.set(gameConfig.world.sidewalkWidthM / 2, gameConfig.world.chunkLengthM / 2);
const pavementMaterial = new THREE.MeshStandardMaterial({
  color: 0xd8d3c8,
  ...(pavementTexture ? { map: pavementTexture } : {}),
});
const signMaterials = SIGN_WORDS.map((word) => {
  const texture = createSignTexture(word);
  return texture ? new THREE.MeshBasicMaterial({ map: texture }) : null;
}).filter((m): m is THREE.MeshBasicMaterial => m !== null);

const playerGeometry = new THREE.SphereGeometry(gameConfig.physics.playerRadius, 16, 12);
const playerMaterial = new THREE.MeshStandardMaterial({ color: 0xf92672 });
// 끝 뭉치도 거리에 따라 키우므로 반지름 1의 기본 구를 두고 scale로 조절한다.
const strandTipGeometry = new THREE.SphereGeometry(1, 8, 6);
const attachFlashGeometry = new THREE.RingGeometry(0.3, 0.6, 24);
const attachFlashMaterial = new THREE.MeshBasicMaterial({
  color: 0xa6e22e,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const LANDMARK_FACTORIES = {
  aejiheon: createAejiheon,
  'daeyang-ai': createDaeyangAi,
  gwanggaeto: createGwanggaeto,
};

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

// 도로 밖이 공허로 보이지 않도록 구간마다 좌우 보도 바닥을 깐다. 윗면 높이와 두께를 도로와
// 맞춰 도로 박스와 겹치지 않게 하고, 충돌체로는 쓰지 않는다(추락 판정은 기존 도로 폭 그대로다).
function sidewalkSpecs(road: BoxSpec): BoxSpec[] {
  const halfWidth = gameConfig.world.sidewalkWidthM / 2;
  return [-1, 1].map((side) => ({
    center: [side * (road.halfExtents[0] + halfWidth), road.center[1], road.center[2]] as Vec3,
    halfExtents: [halfWidth, road.halfExtents[1], road.halfExtents[2]] as Vec3,
  }));
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
      for (const sidewalk of sidewalkSpecs(chunk.road)) {
        group.add(boxMesh(sidewalk, pavementMaterial));
      }
      group.add(boxMesh(chunk.road, roadMaterial));
      if (chunk.landmark) {
        const kind = chunk.landmark.kind;
        let landmarkTemplate = landmarkTemplates.get(kind);
        if (!landmarkTemplate) {
          landmarkTemplate = LANDMARK_FACTORIES[kind]();
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

// 발사 중 줄과 부착 줄에 미리보기와 같은 섬유 모델을 사용한다.
export type WebStrand = {
  group: THREE.Group;
  core: THREE.Mesh;
  tip: THREE.Mesh;
  silk: ReturnType<typeof createDeformableWebSilk>;
};

// 카메라 원점에서 시작하면 가닥 전체가 한 점으로 투영된다. 전방 고정 카메라의 오른쪽 아래에서
// 보이게 시작점만 옮기되, 실제 발사 판정과 물리 앵커(끝점)는 그대로 둔다.
function withBeamOrigin(from: Vec3): Vec3 {
  const offset = gameConfig.effects.beamOriginOffsetM;
  return [from[0] + offset[0], from[1] + offset[1], from[2] + offset[2]];
}

export function createWebStrand(scene: THREE.Scene): WebStrand {
  const silk = createDeformableWebSilk();
  const { core, group } = silk;
  const tip = new THREE.Mesh(strandTipGeometry, core.material);
  group.add(tip);
  group.visible = false;
  scene.add(group);
  return { group, core, tip, silk };
}

// 입력 경로를 화면에서 고르게 보이도록 다시 뽑는다. 월드 길이로 나누면 줄이 카메라에서
// 출발하기 때문에 대부분의 점이 화면 한곳에 몰린다(시선 방향으로 뻗은 구간은 짧게 보인다).
// 그래서 간격을 길이가 아니라 시선에서 본 각도(길이/거리)로 잰다.
function resample(points: Vec3[], samples: number, camera: Vec3): THREE.Vector3[] {
  const eye = new THREE.Vector3(...camera);
  const source = points.map((p) => new THREE.Vector3(...p));
  const views = source.map((p) => new THREE.Vector3().subVectors(p, eye).normalize());
  const lengths = [0];
  for (let i = 1; i < source.length; i++) {
    // 두 점을 바라보는 시선이 벌어진 각도가 곧 화면에서 떨어진 거리다.
    const cos = Math.min(1, Math.max(-1, views[i]!.dot(views[i - 1]!)));
    lengths.push(lengths[i - 1]! + Math.acos(cos));
  }
  const total = lengths[lengths.length - 1]!;
  if (total < 1e-6) return [source[0]!.clone(), source[source.length - 1]!.clone()];

  const out: THREE.Vector3[] = [];
  let cursor = 1;
  for (let i = 0; i <= samples; i++) {
    const target = (total * i) / samples;
    while (cursor < lengths.length - 1 && lengths[cursor]! < target) cursor++;
    const segmentLength = lengths[cursor]! - lengths[cursor - 1]!;
    const t = segmentLength < 1e-6 ? 0 : (target - lengths[cursor - 1]!) / segmentLength;
    out.push(new THREE.Vector3().lerpVectors(source[cursor - 1]!, source[cursor]!, t));
  }
  return out;
}

// points: 손에서 끝점까지의 경로(2점 이상). 첫 점만 화면에 보이도록 옮긴다.
// camera: 굵기 기준이 되는 시점 위치. showTip: 아직 부착하지 않고 날아가는 중일 때 끝 뭉치를 보여준다.
export function updateWebStrand(
  strand: WebStrand,
  points: Vec3[] | null,
  camera: Vec3,
  opacity: number,
  showTip = false,
): void {
  if (!points || points.length < 2 || opacity <= 0) {
    strand.group.visible = false;
    return;
  }
  const { pathSegments, widthRatio, minWidthM, maxWidthM } = gameConfig.effects.strand;
  const shifted: Vec3[] = [withBeamOrigin(points[0]!), ...points.slice(1)];
  const sampled = resample(shifted, pathSegments, camera);

  const eye = new THREE.Vector3(...camera);
  const radii = sampled.map((point) =>
    Math.min(Math.max(point.distanceTo(eye) * widthRatio, minWidthM), maxWidthM),
  );
  strand.silk.update(sampled, radii, opacity, !showTip);

  const end = sampled[sampled.length - 1]!;
  const tipDistance = end.distanceTo(new THREE.Vector3(...camera)) || 1;
  strand.tip.position.copy(end);
  strand.tip.scale.setScalar(
    Math.min(Math.max(tipDistance * widthRatio, minWidthM), maxWidthM) * 2.2,
  );
  strand.tip.visible = showTip;
  strand.group.visible = true;
}

// 부착 줄이 팽팽한 직선으로 보이지 않도록 가운데를 조금 늘어뜨린 경로를 만든다.
export function saggedPath(from: Vec3, to: Vec3, samples = 8): Vec3[] {
  const { sagRatio, maxSagM } = gameConfig.effects.strand;
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const sag = Math.min(distance * sagRatio, maxSagM);
  const points: Vec3[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    points.push([
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t - Math.sin(Math.PI * t) * sag,
      from[2] + (to[2] - from[2]) * t,
    ]);
  }
  return points;
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
