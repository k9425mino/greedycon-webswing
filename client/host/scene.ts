import * as THREE from 'three';
import { gameConfig } from '@shared/config';
import type { PracticeWorld } from './world';
import type { Vec3 } from './physics';

export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 20, 150);

  const camera = new THREE.PerspectiveCamera(gameConfig.cameraVerticalFovDeg, 1, 0.1, 500);

  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
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

const playerGeometry = new THREE.SphereGeometry(gameConfig.physics.playerRadius, 16, 12);
const playerMaterial = new THREE.MeshStandardMaterial({ color: 0xf92672 });
const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3a55 });
const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x22222e });
const ropeMaterial = new THREE.LineBasicMaterial({ color: 0x66d9ef });

export function addPracticeWorldMeshes(scene: THREE.Scene, world: PracticeWorld): void {
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(world.roadWidth, 1, world.roadLengthZ),
    roadMaterial,
  );
  road.position.set(0, -0.5, world.roadCenterZ);
  scene.add(road);

  for (const building of world.buildings) {
    const [w, h, d] = building.halfExtents;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * 2, h * 2, d * 2), buildingMaterial);
    mesh.position.set(...building.center);
    scene.add(mesh);
  }
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

export function updateRopeLine(line: THREE.Line, from: Vec3, to: Vec3 | null): void {
  if (!to) {
    line.visible = false;
    return;
  }
  line.visible = true;
  const positions = line.geometry.attributes.position as THREE.BufferAttribute;
  positions.setXYZ(0, from[0], from[1], from[2]);
  positions.setXYZ(1, to[0], to[1], to[2]);
  positions.needsUpdate = true;
}

// 카메라는 플레이어 위치를 따라가되 회전은 물려받지 않는다(ARCHITECTURE 5절: 항상 도로 전방).
export function updateCameraPosition(camera: THREE.PerspectiveCamera, playerPosition: Vec3): void {
  camera.position.set(playerPosition[0], playerPosition[1], playerPosition[2]);
  camera.lookAt(playerPosition[0], playerPosition[1], playerPosition[2] - 1);
}
