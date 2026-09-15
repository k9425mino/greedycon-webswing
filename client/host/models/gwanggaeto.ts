import * as THREE from 'three';

// 제공 사진(코너 뷰)의 입면을 기준으로 한 추정 비례다. 실측이 아니라 사진에서 센 층수와 창
// 간격으로 잡았다. 원점은 정면동 바닥 중심, +Z는 도로를 향하는 정면이다.
// 평면은 정면동(A, x -22~16)과 뒤로 뻗는 측면동(B, x 10~24)이 ㄱ자로 만나고, 두 동 사이의
// 바깥 모서리를 45°로 이어 사진의 잘린 코너를 만든다.
const BAY = 3.4; // 창 한 칸 폭
const FLOOR = 3.72; // 기준층 높이
const PODIUM_TOP = 9.2; // 저층부(1~2층) 윗면
const TOWER_TOP = 57.6; // 기준층 윗면
const CORNICE_TOP = 58.9;
const TOWER_MID = (PODIUM_TOP + TOWER_TOP) / 2;
const TOWER_HEIGHT = TOWER_TOP - PODIUM_TOP;

export function createGwanggaeto(): THREE.Group {
  const model = new THREE.Group();
  model.name = 'Gwanggaeto Hall';

  const stone = new THREE.MeshStandardMaterial({ color: 0xcdc5b6, roughness: 0.92 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xded7c9, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x8e8a80, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x33474b,
    roughness: 0.3,
    metalness: 0.35,
  });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8b9294, metalness: 0.5, roughness: 0.5 });
  const paving = new THREE.MeshStandardMaterial({ color: 0xa9b1b2, roughness: 0.95 });
  const grass = new THREE.MeshStandardMaterial({ color: 0x718449, roughness: 1 });

  // 창 한 칸 타일. 석재 바탕에 어두운 창과 밝은 틀, 아래쪽 스팬드럴 띠를 그려 면마다 반복시킨다.
  // 테스트 환경(Node)에는 document가 없어 null을 돌려주고 단색 석재로 대체한다.
  function windowTile(): THREE.Texture | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 72;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#cdc5b6';
    ctx.fillRect(0, 0, 64, 72);
    ctx.fillStyle = '#c2b9a9';
    ctx.fillRect(0, 56, 64, 4);
    ctx.fillStyle = '#e0dacd';
    ctx.fillRect(6, 8, 52, 46);
    ctx.fillStyle = '#35484b';
    ctx.fillRect(9, 11, 46, 40);
    ctx.fillStyle = '#5e7275';
    ctx.fillRect(31, 11, 2, 40);
    ctx.fillRect(9, 29, 46, 1.5);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }
  const tile = windowTile();
  const facadeCache = new Map<string, THREE.Material>();
  function facade(width: number, floors: number): THREE.Material {
    if (!tile) return stone;
    const cols = Math.max(1, Math.round(width / BAY));
    const key = `${cols}x${floors}`;
    const cached = facadeCache.get(key);
    if (cached) return cached;
    const map = tile.clone();
    map.needsUpdate = true;
    map.repeat.set(cols, floors);
    const material = new THREE.MeshStandardMaterial({ map, roughness: 0.75 });
    facadeCache.set(key, material);
    return material;
  }

  function box(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material | THREE.Material[] = stone,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  // 창이 붙는 덩어리. BoxGeometry의 면 순서(+X,-X,+Y,-Y,+Z,-Z)에 맞춰 폭이 다른 면마다
  // 반복 횟수가 다른 창 재질을 준다. 윗면·아랫면은 창이 없으므로 석재다.
  function glazedBox(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) {
    const floors = Math.max(1, Math.round(h / FLOOR));
    const side = facade(d, floors);
    const front = facade(w, floors);
    return box(parent, w, h, d, x, y, z, [side, side, dark, dark, front, front]);
  }

  // 바닥: 정면 광장과 잔디 띠.
  box(model, 48, 0.5, 4, 1, 0.25, 12, paving);
  box(model, 18, 0.12, 3.4, -12, 0.52, 12.2, grass);

  // 저층부(1~2층)는 층고가 높아 창이 크다. 기준층보다 조금 내밀어 기단처럼 보이게 한다.
  glazedBox(model, 39.8, PODIUM_TOP, 21.8, -3, PODIUM_TOP / 2, 0);
  glazedBox(model, 15.8, PODIUM_TOP, 37.8, 17, PODIUM_TOP / 2, -16);
  glazedBox(model, 38, TOWER_HEIGHT, 20, -3, TOWER_MID, 0);
  glazedBox(model, 14, TOWER_HEIGHT, 36, 17, TOWER_MID, -16);

  // 두 동 사이를 잇는 45° 잘린 코너. 정면동 끝(16, 10)과 측면동 앞(24, 2)을 잇는다.
  const corner = new THREE.Group();
  corner.position.set(20, 0, 6);
  corner.rotation.y = Math.PI / 4;
  model.add(corner);
  glazedBox(corner, 11.3, PODIUM_TOP, 10, 0, PODIUM_TOP / 2, 0);
  glazedBox(corner, 11.3, TOWER_HEIGHT, 10, 0, TOWER_MID, 0);
  box(corner, 11.9, 1.3, 10.6, 0, (TOWER_TOP + CORNICE_TOP) / 2, 0, trim);
  box(corner, 11.9, 0.9, 10.6, 0, PODIUM_TOP - 0.45, 0, trim);

  // 저층부와 기준층 사이의 두꺼운 석재 띠.
  box(model, 40.2, 0.9, 22.2, -3, PODIUM_TOP - 0.45, 0, trim);
  box(model, 16.2, 0.9, 38.2, 17, PODIUM_TOP - 0.45, -16, trim);
  // 기준층의 수직 기둥선. 창보다 살짝 내밀어 사진처럼 입면에 세로 줄을 만든다.
  for (let x = -20.5; x <= 14.5; x += BAY) {
    box(model, 0.5, TOWER_HEIGHT, 0.3, x, TOWER_MID, 10.05, trim);
  }
  for (let z = -33; z <= 0; z += BAY) {
    box(model, 0.3, TOWER_HEIGHT, 0.5, 24.05, TOWER_MID, z, trim);
  }

  // 옥상: 처마 띠와 한 단 물러선 옥탑.
  box(model, 39.4, 1.3, 21.4, -3, (TOWER_TOP + CORNICE_TOP) / 2, 0, trim);
  box(model, 15.4, 1.3, 37.4, 17, (TOWER_TOP + CORNICE_TOP) / 2, -16, trim);
  box(model, 38, 0.18, 20, -3, CORNICE_TOP + 0.09, 0, dark);
  box(model, 14, 0.18, 36, 17, CORNICE_TOP + 0.09, -16, dark);
  box(model, 24, 3.5, 14, -3, CORNICE_TOP + 1.75, -2, stone);
  box(model, 24.8, 0.3, 14.8, -3, CORNICE_TOP + 3.65, -2, trim);
  for (const z of [-24, -20.5]) box(model, 4, 1.2, 2.4, 17, CORNICE_TOP + 0.7, z, metal);

  // 정면 중앙 현관: 벽에 붙은 얇은 캐노피와 유리 출입구.
  box(model, 14, 4.8, 0.3, -6, 2.6, 10.15, glass);
  for (const x of [-11, -7.5, -4.5, -1]) box(model, 0.35, 4.8, 0.4, x, 2.6, 10.3, trim);
  box(model, 15, 0.5, 3.6, -6, 5.4, 11.6, trim);
  for (const x of [-12, 0]) box(model, 0.25, 5.15, 0.25, x, 2.58, 13.1, metal);
  for (let i = 0; i < 3; i++) box(model, 17, 0.14, 2.6 - i * 0.5, -6, 0.57 + i * 0.14, 12.6, trim);

  // 상단 석재 띠에 붙는 교명. 사진처럼 정면 왼쪽 위에 둔다.
  if (typeof document !== 'undefined') {
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 512;
    signCanvas.height = 128;
    const ctx = signCanvas.getContext('2d')!;
    ctx.fillStyle = '#2b3646';
    ctx.font = 'bold 104px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('세종대학교', 256, 68);
    const map = new THREE.CanvasTexture(signCanvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 3.25),
      new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.8 }),
    );
    sign.position.set(-13, TOWER_TOP - 3.6, 10.22);
    model.add(sign);
    // 글자가 창 격자에 묻히지 않도록 뒤에 석재판을 깐다.
    box(model, 15, 4.4, 0.25, -13, TOWER_TOP - 3.6, 10.08, trim);
  }
  return model;
}
