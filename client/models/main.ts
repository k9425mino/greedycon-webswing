import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createAejiheon } from '../host/models/aejiheon';
import { createDaeyangAi } from '../host/models/daeyangAi';
import { createGwanggaeto } from '../host/models/gwanggaeto';

type View = { position: [number, number, number]; target: [number, number, number] };
type Preset = {
  title: string;
  eyebrow: string;
  description: string;
  detailLabel: string;
  narrowFov: number;
  create: () => THREE.Group;
  overview: View;
  front: View;
  detail: View;
};

const presets: Record<string, Preset> = {
  aejiheon: {
    title: '애지헌과 대양타워',
    eyebrow: 'SEJONG UNIVERSITY / LANDMARK 01',
    description: '석재의 수직선, 아치와 붉은 지붕.',
    detailLabel: '예배당',
    narrowFov: 52,
    create: createAejiheon,
    overview: { position: [65, 42, 85], target: [2, 25, -4] },
    front: { position: [3, 29, 115], target: [3, 27, -3] },
    detail: { position: [38, 19, 23], target: [7, 6, -12] },
  },
  'daeyang-ai': {
    title: '대양AI센터',
    eyebrow: 'SEJONG UNIVERSITY / LANDMARK 02',
    description: '청록빛 유리와 석재 기둥, 열린 옥상 테라스.',
    detailLabel: '옥상',
    narrowFov: 65,
    create: createDaeyangAi,
    overview: { position: [82, 63, 100], target: [0, 24, 0] },
    front: { position: [0, 28, 125], target: [0, 26, 0] },
    detail: { position: [65, 92, 65], target: [0, 33, 0] },
  },
  gwanggaeto: {
    title: '광개토관',
    eyebrow: 'SEJONG UNIVERSITY / LANDMARK 03',
    description: '두 동이 만나는 잘린 코너, 촘촘한 창 격자의 석재 입면.',
    detailLabel: '코너',
    narrowFov: 62,
    create: createGwanggaeto,
    overview: { position: [95, 62, 105], target: [4, 30, -6] },
    front: { position: [0, 34, 140], target: [0, 31, 0] },
    detail: { position: [62, 22, 58], target: [19, 16, 7] },
  },
};

const preset =
  presets[new URLSearchParams(location.search).get('model') ?? ''] ?? presets.aejiheon!;
document.title = `${preset.title} · 건물 미리보기`;
document.querySelector('h1')!.textContent = preset.title;
document.querySelector('header p')!.textContent = preset.description;
document.querySelector('.eyebrow')!.textContent = preset.eyebrow;
document.querySelector('#detail')!.textContent = preset.detailLabel;
document
  .querySelector('canvas')!
  .setAttribute('aria-label', `${preset.title}의 회전 가능한 3D 모델`);

const canvas = document.querySelector('canvas')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9e8e2);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 8;
controls.maxDistance = 220;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.autoRotateSpeed = 0.5;
scene.add(new THREE.HemisphereLight(0xe7f1ff, 0x8d826b, 2));
const sun = new THREE.DirectionalLight(0xffefcf, 3);
sun.position.set(-30, 70, 35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 75, bottom: -60, far: 200 });
sun.shadow.normalBias = 0.04;
scene.add(sun);
scene.add(preset.create());
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshStandardMaterial({ color: 0xdedfd4, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.03;
ground.receiveShadow = true;
scene.add(ground);

function view({ position, target }: View) {
  camera.position.set(...position);
  controls.target.set(...target);
  controls.update();
}
view(preset.overview);
document.querySelector('#overview')!.addEventListener('click', () => view(preset.overview));
document.querySelector('#front')!.addEventListener('click', () => view(preset.front));
document.querySelector('#detail')!.addEventListener('click', () => view(preset.detail));
document.querySelector('#rotate')!.addEventListener('click', (event) => {
  controls.autoRotate = !controls.autoRotate;
  (event.currentTarget as HTMLButtonElement).setAttribute(
    'aria-pressed',
    String(controls.autoRotate),
  );
});
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = camera.aspect < 0.7 ? preset.narrowFov : 40;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
