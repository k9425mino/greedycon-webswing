import * as THREE from 'three';

// 실물 사진의 입면을 우선하고 조감도의 옥상 형태를 참고한 추정 비례다.
// 원점은 건물 바닥 중심, +Z는 정면이다.
export function createDaeyangAi(): THREE.Group {
  const model = new THREE.Group();
  model.name = 'Daeyang AI Center';
  const stone = new THREE.MeshStandardMaterial({ color: 0xd6c6b6, roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xe3d8c5, roughness: 0.8 });
  const paving = new THREE.MeshStandardMaterial({ color: 0xaab4b5, roughness: 0.95 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x778c88, metalness: 0.5, roughness: 0.5 });
  const grass = new THREE.MeshStandardMaterial({ color: 0x718449, roughness: 1 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xa7a79c, roughness: 1 });

  function glazing(rows: number): THREE.MeshStandardMaterial {
    if (typeof document === 'undefined') return new THREE.MeshStandardMaterial({ color: 0x32675f });
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = rows * 64;
    const ctx = canvas.getContext('2d')!;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < 4; col++) {
        const value = (row * 13 + col * 7) % 9;
        ctx.fillStyle = `hsl(${176 + value} 29% ${23 + value * 2}%)`;
        ctx.fillRect(col * 32, row * 64, 32, 64);
        ctx.strokeStyle = '#83a59d';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(col * 32, row * 64, 32, 64);
      }
      ctx.fillStyle = '#698c84';
      ctx.fillRect(0, row * 64 + 45, 128, 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.35, metalness: 0.2 });
  }
  const lowerGlass = glazing(5);
  const upperGlass = glazing(10);
  function box(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material = stone,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(model, 48, 0.5, 42, 0, 0.25, 2, paving);
  box(model, 42, 17, 34, 0, 9, 0);
  // 유리보다 기둥을 조금 돌출시켜 입면의 깊이를 표현한다.
  function facades(
    width: number,
    depth: number,
    height: number,
    bottom: number,
    centerX: number,
    centerZ: number,
    upper: boolean,
  ) {
    for (let side = 0; side < 4; side++) {
      const face = new THREE.Group();
      face.position.set(centerX, 0, centerZ);
      face.rotation.y = (side * Math.PI) / 2;
      model.add(face);
      const span = side % 2 ? depth : width;
      const offset = (side % 2 ? width : depth) / 2;
      const bays = 7;
      const step = (span - 2) / bays;
      for (let i = 0; i < bays; i++) {
        const x = -span / 2 + 1 + step * (i + 0.5);
        const paneWidth = upper ? step * 0.48 : step - 1.05;
        box(
          face,
          paneWidth,
          height - 0.7,
          0.08,
          x,
          bottom + height / 2,
          offset + 0.06,
          upper ? upperGlass : lowerGlass,
        );
        if (!upper) {
          box(face, 1.05, height, 0.55, x - step / 2, bottom + height / 2, offset + 0.25, trim);
          box(face, 1.55, 0.45, 0.85, x - step / 2, bottom + height - 0.1, offset + 0.3, trim);
          box(face, 1.35, 0.5, 0.8, x - step / 2, bottom + 0.25, offset + 0.3, trim);
        }
      }
      // 패널 줄눈은 유리 면을 가로지르지 않고 석재 띠에만 넣는다.
      for (let i = 0; i <= bays; i++) {
        const x = -span / 2 + 1 + step * i;
        for (let y = bottom + 1; y < bottom + height; y += 1.65) {
          box(
            face,
            upper ? step * 0.49 : 0.9,
            0.025,
            0.025,
            x,
            y,
            offset + (upper ? 0.025 : 0.54),
            roof,
          );
        }
      }
    }
  }
  facades(42, 34, 16.3, 0.85, 0, 0, false);
  box(model, 43, 0.45, 35, 0, 17.5, 0, trim);
  box(model, 43.5, 2.1, 35.5, 0, 18.75, 0);
  box(model, 44, 0.3, 36, 0, 19.95, 0, trim);
  box(model, 42.5, 0.18, 34.5, 0, 20.2, 0, roof);
  box(model, 32, 29.5, 26, -2, 35.05, 2);
  facades(32, 26, 29, 20.55, -2, 2, true);
  box(model, 32.8, 2.2, 26.8, -2, 50.9, 2);
  box(model, 33.5, 0.35, 27.5, -2, 52.15, 2, trim);
  box(model, 31.8, 0.15, 25.8, -2, 52.4, 2, roof);
  for (const x of [-18.25, 14.25]) box(model, 0.35, 0.8, 26.5, x, 52.7, 2, trim);
  for (const z of [-11.25, 15.25]) box(model, 32.8, 0.8, 0.35, -2, 52.7, z, trim);
  box(model, 12, 2.2, 9, -3, 53.55, -0.5, trim);
  box(model, 12.6, 0.22, 9.6, -3, 54.75, -0.5, roof);
  for (const x of [6, 9]) {
    box(model, 2, 1.1, 3.5, x, 53.1, -5, metal);
    for (let z = -6.4; z < -3.3; z += 0.35) box(model, 1.8, 0.035, 0.08, x, 53.67, z, roof);
  }
  // 조감도에서 보이는 측면·후면 테라스와 낮은 난간.
  box(model, 5, 0.15, 30, 17.5, 20.35, 0, grass);
  box(model, 36, 0.15, 3.8, -1, 20.35, -14.6, grass);
  for (const x of [-21, 21]) {
    box(model, 0.16, 0.12, 34, x, 21.55, 0, metal);
    for (let z = -17; z <= 17; z += 2) box(model, 0.08, 1.2, 0.08, x, 20.95, z, metal);
  }
  for (const z of [-17, 17]) {
    box(model, 42, 0.12, 0.16, 0, 21.55, z, metal);
    for (let x = -21; x <= 21; x += 2) box(model, 0.08, 1.2, 0.08, x, 20.95, z, metal);
  }

  if (typeof document !== 'undefined') {
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 1024;
    signCanvas.height = 160;
    const ctx = signCanvas.getContext('2d')!;
    ctx.fillStyle = '#934b48';
    ctx.beginPath();
    ctx.arc(120, 80, 49, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e4d4bd';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(120, 80, 38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#eadfcd';
    ctx.font = '56px Georgia';
    ctx.fillText('S', 102, 100);
    ctx.fillStyle = '#4e5552';
    ctx.font = '100px Georgia';
    ctx.fillText('SEJONG', 198, 116);
    const signTexture = new THREE.CanvasTexture(signCanvas);
    signTexture.colorSpace = THREE.SRGBColorSpace;
    const signMaterial = new THREE.MeshStandardMaterial({
      map: signTexture,
      transparent: true,
      roughness: 0.8,
    });
    for (let side = 0; side < 4; side++) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 1.8), signMaterial);
      sign.rotation.y = (side * Math.PI) / 2;
      sign.position.set(
        -2 + Math.sin(sign.rotation.y) * 16.42,
        50.85,
        2 + Math.cos(sign.rotation.y) * 13.42,
      );
      model.add(sign);
    }
  }
  // 정면 중앙 출입구와 얇은 유리 캐노피는 사진에 맞춰 간략하게 표현한다.
  box(model, 6, 3.5, 0.2, 0, 2.25, 17.38, lowerGlass);
  for (const x of [-3, -1, 1, 3]) box(model, 0.09, 3.5, 0.25, x, 2.25, 17.55, metal);
  box(model, 8, 0.16, 3, 0, 4.2, 18.4, lowerGlass);
  for (const x of [-3.6, 3.6]) box(model, 0.12, 3.7, 0.12, x, 2.15, 19.5, metal);
  for (let i = 0; i < 4; i++) box(model, 10, 0.13, 3 - i * 0.5, 0, 0.065 + i * 0.13, 19.9, trim);
  return model;
}
