import * as THREE from 'three';

// 사용자 제공 사진 2장을 기준으로 잡은 시각적 비례이며 실측 치수가 아니다.
// 원점은 탑 바닥 중심, +Z는 정면이다. 가려진 면은 보이는 면을 바탕으로 단순화했다.
export function createAejiheon(): THREE.Group {
  const model = new THREE.Group();
  model.name = 'Aejiheon and Daeyang Tower';

  function surface(roof: boolean, golden = false): THREE.Texture {
    if (typeof document === 'undefined') return new THREE.Texture();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    let seed = 1940;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    ctx.fillStyle = roof ? '#594336' : '#a49e8c';
    ctx.fillRect(0, 0, 512, 512);
    const rows = roof ? 24 : 16;
    const height = 512 / rows;
    const width = roof ? 16 : 85.333;
    for (let row = 0; row < rows; row++) {
      for (let col = -1; col < 33; col++) {
        const x = col * width + ((row % 2) * width) / 2;
        const y = row * height;
        const light = (golden ? 48 : roof ? 30 : 65) + random() * 15;
        ctx.fillStyle = `hsl(${golden ? 42 : roof ? 24 : 42} ${roof ? 29 : 12}% ${light}%)`;
        ctx.fillRect(x + 1, y + 1, width - 2, height - 2);
        ctx.strokeStyle = roof ? '#b08860' : '#ded8c5';
        ctx.beginPath();
        ctx.moveTo(x + 2, y + height - 2);
        ctx.lineTo(x + width - 2, y + height - 2);
        ctx.stroke();
        if (!roof) {
          for (let j = 0; j < 9; j++) {
            ctx.strokeStyle = `rgba(${j % 2 ? '255,250,230' : '65,62,50'},0.12)`;
            const sx = x + random() * width;
            const sy = y + random() * height;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + random() * 13, sy + random() * 8);
            ctx.stroke();
          }
        }
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  const stoneTexture = surface(false);
  const shaftTexture = stoneTexture.clone();
  shaftTexture.repeat.set(1, 5);
  const roofTexture = surface(true);
  const stone = new THREE.MeshStandardMaterial({ map: stoneTexture, roughness: 0.95 });
  const shaft = new THREE.MeshStandardMaterial({ map: shaftTexture, roughness: 0.95 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xc6bfa7, roughness: 0.85 });
  const roof = new THREE.MeshStandardMaterial({
    map: roofTexture,
    color: 0xb99576,
    roughness: 0.9,
  });
  const towerRoof = new THREE.MeshStandardMaterial({ map: surface(true, true), roughness: 0.9 });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xa98b4d,
    metalness: 0.35,
    roughness: 0.65,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x272c29, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x29464b,
    metalness: 0.25,
    roughness: 0.3,
  });

  function mesh(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    const item = new THREE.Mesh(geometry, material);
    item.position.set(x, y, z);
    item.castShadow = item.receiveShadow = true;
    parent.add(item);
    return item;
  }
  function box(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material = trim,
  ) {
    return mesh(parent, new THREE.BoxGeometry(w, h, d), material, x, y, z);
  }
  function arch(w: number, h: number): THREE.Shape {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(w / 2, h - w / 2);
    shape.absarc(0, h - w / 2, w / 2, 0, Math.PI, false);
    shape.lineTo(-w / 2, 0);
    return shape;
  }
  function extrude(shape: THREE.Shape, depth: number) {
    return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
  }
  function archFrame(
    parent: THREE.Object3D,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
  ) {
    const frame = arch(w + 0.3, h + 0.15);
    const hole = new THREE.Path(arch(w, h).getPoints());
    frame.holes.push(hole);
    mesh(parent, extrude(frame, 0.16), trim, x, y, z);
  }

  const tower = new THREE.Group();
  tower.name = 'Daeyang Tower';
  model.add(tower);
  box(tower, 9.6, 0.4, 9.6, 0, 0.2, 0);
  box(tower, 8.8, 2, 8.8, 0, 1.4, 0, stone);
  box(tower, 9.1, 0.25, 9.1, 0, 2.5, 0);
  box(tower, 8.5, 0.45, 8.5, 0, 2.85, 0);
  box(tower, 8, 36, 8, 0, 21, 0, shaft);
  for (const y of [3.2, 37.8, 39, 40.2]) {
    box(tower, 8.35, 0.22, 8.35, 0, y, 0);
  }
  box(tower, 8.5, 2, 8.5, 0, 40, 0, stone);
  for (const [y, w] of [
    [41, 8.7],
    [41.3, 9],
    [41.65, 9.4],
  ] as const) {
    box(tower, w, 0.25, w, 0, y, 0);
  }
  // 네 면을 실제로 뚫어 비스듬히 볼 때도 아치 너머가 보이게 한다.
  for (let side = 0; side < 4; side++) {
    const face = new THREE.Group();
    face.rotation.y = (side * Math.PI) / 2;
    tower.add(face);
    const wall = new THREE.Shape();
    wall.moveTo(-4.2, 0);
    wall.lineTo(4.2, 0);
    wall.lineTo(4.2, 4.4);
    wall.lineTo(-4.2, 4.4);
    wall.closePath();
    for (const x of [-2.45, 0, 2.45]) {
      const hole = new THREE.Path(
        arch(1.35, 2.65)
          .getPoints()
          .map((p) => new THREE.Vector2(p.x + x, p.y + 0.55)),
      );
      wall.holes.push(hole);
      archFrame(face, 1.35, 2.65, x, 42.45, 4.22);
      box(face, 1.5, 0.14, 0.18, x, 42.6, 4.43);
      for (const dx of [-0.5, -0.25, 0, 0.25, 0.5]) {
        box(face, 0.07, 0.38, 0.1, x + dx, 42.35, 4.43);
      }
    }
    mesh(face, extrude(wall, 0.35), stone, 0, 41.9, 3.85);
    box(face, 8, 0.15, 0.25, 0, 45.9, 4.2);
  }
  box(tower, 8, 0.2, 8, 0, 42, 0, dark);
  for (const [y, w] of [
    [46.35, 8.8],
    [46.6, 9.2],
  ] as const) {
    box(tower, w, 0.22, w, 0, y, 0);
  }
  box(tower, 8.25, 3.3, 8.25, 0, 48.35, 0, stone);
  for (let side = 0; side < 4; side++) {
    const face = new THREE.Group();
    face.rotation.y = (side * Math.PI) / 2;
    tower.add(face);
    for (const x of [-3.7, 3.7]) box(face, 0.22, 2.9, 0.15, x, 48.4, 4.15);
    mesh(face, new THREE.CircleGeometry(0.92, 40), dark, 0, 48.45, 4.14);
    mesh(face, new THREE.TorusGeometry(0.93, 0.08, 6, 40), gold, 0, 48.45, 4.18);
    mesh(face, new THREE.TorusGeometry(0.68, 0.035, 4, 32), gold, 0, 48.45, 4.2);
    // 사진의 원형 문양은 판독 가능한 해상도가 없어 기하학적 장식으로 대체한다.
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      mesh(
        face,
        new THREE.CircleGeometry(0.12, 8),
        gold,
        Math.sin(angle) * 0.46,
        48.45 + Math.cos(angle) * 0.46,
        4.21,
      );
    }
    box(face, 0.16, 0.6, 0.05, 0, 48.45, 4.22, gold);
  }
  box(tower, 8.7, 0.2, 8.7, 0, 50.1, 0);
  box(tower, 9, 0.18, 9, 0, 50.35, 0);
  const cap = mesh(tower, new THREE.ConeGeometry(5.75, 3.6, 4), towerRoof, 0, 52.2, 0);
  cap.rotation.y = Math.PI / 4;
  box(tower, 0.06, 1.25, 0.06, 0, 54.45, 0, gold);

  const chapel = new THREE.Group();
  chapel.name = 'Aejiheon Chapel';
  chapel.position.set(7.3, 0, -13);
  model.add(chapel);
  box(chapel, 16, 0.45, 23, 0, 0.225, 0);
  box(chapel, 14, 8, 21, 0, 4.45, 0, stone);
  box(chapel, 14.5, 0.28, 21.5, 0, 8.5, 0);
  function gable(
    parent: THREE.Object3D,
    w: number,
    rise: number,
    depth: number,
    x: number,
    y: number,
    z: number,
  ) {
    const triangle = new THREE.Shape();
    triangle.moveTo(-w / 2, 0);
    triangle.lineTo(w / 2, 0);
    triangle.lineTo(0, rise);
    triangle.closePath();
    mesh(parent, extrude(triangle, depth), stone, x, y, z - depth / 2);
    const slope = Math.atan2(rise, w / 2);
    for (const side of [-1, 1]) {
      const panel = box(
        parent,
        Math.hypot(w / 2, rise) + 0.55,
        0.24,
        depth + 0.9,
        x + (side * w) / 4,
        y + rise / 2 + 0.12,
        z,
        roof,
      );
      panel.rotation.z = -side * slope;
      const fascia = box(
        parent,
        Math.hypot(w / 2, rise) + 0.7,
        0.2,
        0.18,
        x + (side * w) / 4,
        y + rise / 2,
        z + depth / 2 + 0.5,
      );
      fascia.rotation.z = -side * slope;
    }
  }
  gable(chapel, 14.5, 4.6, 21.5, 0, 8.65, 0);
  for (const side of [-1, 1]) {
    box(chapel, 1.7, 1.5, 1.8, side * 4.5, 11.1, -1, stone);
    box(chapel, 1.85, 0.16, 1.95, side * 4.5, 11.9, -1);
    box(chapel, 1.4, 0.45, 1.5, side * 4.5, 12.15, -1, dark);
    box(chapel, 1.85, 0.17, 1.95, side * 4.5, 12.45, -1, roof);
  }
  box(chapel, 6, 8.8, 1.8, 0, 4.85, 11, stone);
  gable(chapel, 6.2, 2.8, 2, 0, 9.25, 11);
  function window(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number) {
    mesh(parent, new THREE.ShapeGeometry(arch(w, h), 16), glass, x, y, z);
    archFrame(parent, w, h, x, y, z + 0.02);
    box(parent, 0.08, h - 0.15, 0.1, x, y + h / 2, z + 0.2);
    box(parent, w, 0.08, 0.1, x, y + h * 0.45, z + 0.2);
    const colors = [0x56808a, 0x955b4d, 0xb09a58];
    for (let i = 0; i < 3; i++) {
      const pane = new THREE.MeshStandardMaterial({ color: colors[i]!, roughness: 0.4 });
      const detail = mesh(
        parent,
        new THREE.PlaneGeometry(w * 0.2, h * 0.18),
        pane,
        x + (i % 2 ? 0.2 : -0.2) * w,
        y + 0.55 + i * h * 0.2,
        z + 0.02,
      );
      detail.rotation.z = Math.PI / 6;
    }
  }
  window(chapel, 0, 4.3, 12.02, 2, 4);
  for (const x of [-5, 5]) window(chapel, x, 3.5, 10.52, 0.9, 2.8);
  for (const side of [-1, 1]) {
    const wall = new THREE.Group();
    wall.position.x = side * 7.02;
    wall.rotation.y = (side * Math.PI) / 2;
    chapel.add(wall);
    for (const x of [-8, -4, 0, 4, 8]) window(wall, x, 3, 0, 1.1, 3.6);
  }
  box(chapel, 2, 2.8, 0.15, 0, 1.85, 12.03, dark);
  box(chapel, 0.09, 2.8, 0.12, 0, 1.85, 12.15, gold);
  for (let i = 0; i < 3; i++) box(chapel, 3.3, 0.15, 1.6 - i * 0.4, 0, 0.075 + i * 0.15, 12.7);
  return model;
}
