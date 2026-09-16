import * as THREE from 'three';
import { gameConfig } from '@shared/config';
import type { Chunk } from './world';
import type { BoxSpec, Vec3 } from './physics';
import { createAejiheon } from './models/aejiheon';
import { createDaeyangAi } from './models/daeyangAi';
import { createGwanggaeto } from './models/gwanggaeto';
import { createNaver } from './models/naver';
import { createOffice, OFFICE_KINDS } from './models/office';
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
const playerGeometry = new THREE.SphereGeometry(gameConfig.physics.playerRadius, 16, 12);
const playerMaterial = new THREE.MeshStandardMaterial({ color: 0xf92672 });
// 끝 뭉치도 거리에 따라 키우므로 반지름 1의 기본 구를 두고 scale로 조절한다.
const strandTipGeometry = new THREE.SphereGeometry(1, 8, 6);
// 부착 지점에 남기는 원형 거미줄 자국. 방사실과 고리를 캔버스에 한 번만 그려 평면에 입힌다.
function createWebSplatTexture(): THREE.Texture | null {
  const size = 256;
  const ctx = tryCreateCanvas(size, size);
  if (!ctx) return null;
  const center = size / 2;
  const radius = center - 8;
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  const spokes = 12;
  const tips = Array.from({ length: spokes }, (_, spoke) => {
    const angle = (spoke / spokes) * Math.PI * 2 + Math.sin(spoke * 7.3) * 0.1;
    const reach = radius * (0.78 + 0.22 * (0.5 + 0.5 * Math.sin(spoke * 8.31)));
    return new THREE.Vector2(Math.cos(angle) * reach, Math.sin(angle) * reach);
  });
  ctx.lineWidth = 3;
  for (let spoke = 0; spoke < spokes; spoke++) {
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.lineTo(center + tips[spoke]!.x, center + tips[spoke]!.y);
    ctx.stroke();
  }
  // 고리는 방사실 사이를 안쪽으로 살짝 파인 곡선으로 잇는다.
  ctx.lineWidth = 2.5;
  for (let ring = 1; ring <= 4; ring++) {
    const fraction = ring / 4;
    ctx.beginPath();
    for (let spoke = 0; spoke <= spokes; spoke++) {
      const tip = tips[spoke % spokes]!;
      const x = center + tip.x * fraction;
      const y = center + tip.y * fraction;
      if (spoke === 0) ctx.moveTo(x, y);
      else {
        const previous = tips[spoke - 1]!;
        ctx.quadraticCurveTo(
          center + (previous.x + tip.x) * 0.43 * fraction,
          center + (previous.y + tip.y) * 0.43 * fraction,
          x,
          y,
        );
      }
    }
    ctx.stroke();
  }
  return new THREE.CanvasTexture(ctx.canvas);
}

const webSplatGeometry = new THREE.PlaneGeometry(2, 2);
const webSplatTexture = createWebSplatTexture();
const webSplatMaterial = new THREE.MeshBasicMaterial({
  color: 0xf2f5f8,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  ...(webSplatTexture ? { map: webSplatTexture, alphaMap: webSplatTexture } : {}),
});

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
  naver: createNaver,
};

function boxMesh(spec: BoxSpec, material: THREE.Material): THREE.Mesh {
  const [w, h, d] = spec.halfExtents;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * 2, h * 2, d * 2), material);
  mesh.position.set(...spec.center);
  return mesh;
}

// 충돌에 쓰지 않는 넓은 보도로 도로 밖 바닥을 채운다.
function sidewalkSpecs(road: BoxSpec): BoxSpec[] {
  const halfWidth = gameConfig.world.sidewalkWidthM / 2;
  return [-1, 1].map((side) => ({
    center: [side * (road.halfExtents[0] + halfWidth), road.center[1], road.center[2]] as Vec3,
    halfExtents: [halfWidth, road.halfExtents[1], road.halfExtents[2]] as Vec3,
  }));
}

// 구간 mesh는 Group 하나로 묶어 회수 시 통째로 제거한다.
// 도로·보도 geometry는 구간마다 폐기하고 건물 모델 자원은 템플릿으로 공유한다.
export function createChunkMeshes(scene: THREE.Scene) {
  const groups = new Map<number, THREE.Group>();
  // 랜드마크의 geometry·material·texture는 한 번 만들고 구간 간 공유한다.
  // clone한 Group만 회수하며 공유 자원은 일반 건물 재질처럼 게임 수명 동안 유지한다.
  const landmarkTemplates = new Map<string, THREE.Group>();
  const officeTemplates = OFFICE_KINDS.map(createOffice);

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
        const office = officeTemplates[OFFICE_KINDS.indexOf(building.style)]!.clone();
        const [w, h, d] = building.halfExtents;
        office.scale.set(w / 6, h / 30, d / 9);
        office.position.set(building.center[0], building.center[1] - h, building.center[2]);
        group.add(office);
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
  strand.silk.update(sampled, radii, opacity);

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

// 부착 중 건물 표면에 남는 거미줄 자국.
export function createWebSplat(scene: THREE.Scene): THREE.Mesh {
  const mesh = new THREE.Mesh(webSplatGeometry, webSplatMaterial);
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

// 벽면 법선을 따라 밀착시켜 플레이어가 이동해도 자국이 벽에서 떠돌지 않게 한다.
export function updateWebSplat(mesh: THREE.Mesh, point: Vec3 | null, normal: Vec3): void {
  if (!point) {
    mesh.visible = false;
    return;
  }
  const surfaceNormal = new THREE.Vector3(...normal).normalize();
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceNormal);
  mesh.position.set(...point).addScaledVector(surfaceNormal, 0.015);
  mesh.scale.setScalar(gameConfig.effects.attachSplatRadiusM);
  mesh.visible = true;
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
