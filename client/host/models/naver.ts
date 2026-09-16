import * as THREE from 'three';

// 제공 사진의 비례를 따른 게임용 모델. 치수·옥상·가려진 면은 추정이며 +Z가 정면이다.
export function createNaver(): THREE.Group {
  const model = new THREE.Group();
  model.name = 'NAVER Green Factory';
  const frame = new THREE.MeshStandardMaterial({
    color: 0x295e50,
    roughness: 0.55,
    metalness: 0.3,
  });
  const stone = new THREE.MeshStandardMaterial({ color: 0xd4d6cb, roughness: 0.85 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x53665d, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x367c65,
    roughness: 0.3,
    metalness: 0.25,
  });

  function box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    model.add(mesh);
    return mesh;
  }

  function facadeMaterial(columns: number): THREE.MeshStandardMaterial {
    if (typeof document === 'undefined') return glass;
    const canvas = document.createElement('canvas');
    canvas.width = columns * 32;
    canvas.height = 26 * 48;
    const ctx = canvas.getContext('2d')!;
    for (let row = 0; row < 26; row++) {
      for (let col = 0; col < columns; col++) {
        const value = (row * 17 + col * 11 + col * row * 3) % 19;
        const x = col * 32;
        const y = row * 48;
        ctx.fillStyle = `hsl(${145 + value} ${27 + (value % 7)}% ${24 + value}%)`;
        ctx.fillRect(x, y, 32, 48);
        // 서로 다른 블라인드 높이와 유리 반사로 사진의 불규칙한 녹색 입면을 만든다.
        ctx.fillStyle = value % 3 === 0 ? '#9bae7966' : '#194e4a44';
        ctx.fillRect(x + 3, y + 3, 26, 8 + value);
        ctx.fillStyle = '#193f37';
        ctx.fillRect(x, y, 2, 48);
        ctx.fillRect(x, y + 35, 32, 2);
        ctx.fillRect(x, y + 45, 32, 3);
        ctx.fillStyle = '#74a18a';
        ctx.fillRect(x + 3, y + 2, 1, 43);
        ctx.fillStyle = '#2f6250';
        ctx.fillRect(x + 15, y, 1, 48);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.4, metalness: 0.18 });
  }

  box(40, 0.4, 28, 0, 0.2, 1, stone);
  box(36, 5.6, 23, 0, 3.2, 0, stone);
  const frontGlass = facadeMaterial(28);
  const sideGlass = facadeMaterial(16);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(36, 73, 22), [
    sideGlass,
    sideGlass,
    roof,
    roof,
    frontGlass,
    frontGlass,
  ]);
  tower.position.set(0, 42.5, 0);
  tower.castShadow = tower.receiveShadow = true;
  model.add(tower);

  // 얇은 수직 차양은 실제 깊이를 주고, 촘촘한 창살은 텍스처로 묶는다.
  for (const z of [-11.12, 11.12]) {
    for (let col = 0; col <= 28; col += 2) {
      box(0.1, 73.3, 0.38, -18 + (col * 36) / 28, 42.55, z, frame);
    }
    for (let row = 0; row <= 26; row++) {
      box(36.25, 0.11, 0.3, 0, 6 + (row * 73) / 26, z, frame);
    }
  }
  for (const x of [-18.12, 18.12]) {
    for (let col = 0; col <= 16; col += 2) {
      box(0.38, 73.3, 0.1, x, 42.55, -11 + (col * 22) / 16, frame);
    }
    for (let row = 0; row <= 26; row++) {
      box(0.3, 0.11, 22.25, x, 6 + (row * 73) / 26, 0, frame);
    }
  }
  box(36.5, 0.25, 22.5, 0, 79.25, 0, frame);
  box(12, 1.8, 7, 2, 80.25, -3, roof);
  for (const x of [-8, -4]) box(2.6, 1.1, 4, x, 79.9, -3, roof);

  // 사진 하단의 밝은 석재와 후퇴한 유리 출입구를 단순화한다.
  box(26, 4.2, 0.12, -2, 2.7, 11.57, glass);
  for (let x = -15; x <= 11; x += 2) box(0.12, 4.2, 0.2, x, 2.7, 11.68, frame);
  box(10, 0.2, 3, -3, 4.9, 12.1, stone);
  for (const x of [-7.5, 1.5]) box(0.15, 4.3, 0.15, x, 2.55, 13.3, frame);
  for (let row = 0; row < 5; row++) {
    box(36, 0.035, 0.04, 0, 0.9 + row, 11.53, roof);
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 210px Arial Black, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NAVER', 512, 136, 990);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.1,
      roughness: 0.65,
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(13, 3.25), material);
    sign.position.set(-9.3, 75.8, 11.36);
    model.add(sign);
  }
  return model;
}
