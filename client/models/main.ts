import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createAejiheon } from '../host/models/aejiheon';
import { createDaeyangAi } from '../host/models/daeyangAi';

const isAiCenter = new URLSearchParams(location.search).get('model') === 'daeyang-ai';
if (isAiCenter) {
  document.title = '대양AI센터 · 건물 미리보기';
  document.querySelector('h1')!.textContent = '대양AI센터';
  document.querySelector('header p')!.textContent = '청록빛 유리와 석재 기둥, 열린 옥상 테라스.';
  document.querySelector('.eyebrow')!.textContent = 'SEJONG UNIVERSITY / LANDMARK 02';
  document.querySelector('#chapel')!.textContent = '옥상';
  document.querySelector('canvas')!.setAttribute('aria-label', '대양AI센터의 회전 가능한 3D 모델');
}

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
controls.maxDistance = 180;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.autoRotateSpeed = 0.5;
scene.add(new THREE.HemisphereLight(0xe7f1ff, 0x8d826b, 2));
const sun = new THREE.DirectionalLight(0xffefcf, 3);
sun.position.set(-30, 70, 35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 65, bottom: -50, far: 160 });
sun.shadow.normalBias = 0.04;
scene.add(sun);
const model = isAiCenter ? createDaeyangAi() : createAejiheon();
scene.add(model);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshStandardMaterial({ color: 0xdedfd4, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.03;
ground.receiveShadow = true;
scene.add(ground);

function view(position: [number, number, number], target: [number, number, number]) {
  camera.position.set(...position);
  controls.target.set(...target);
  controls.update();
}
const overview = () =>
  isAiCenter ? view([82, 63, 100], [0, 24, 0]) : view([65, 42, 85], [2, 25, -4]);
overview();
document.querySelector('#overview')!.addEventListener('click', overview);
document
  .querySelector('#front')!
  .addEventListener('click', () =>
    isAiCenter ? view([0, 28, 125], [0, 26, 0]) : view([3, 29, 115], [3, 27, -3]),
  );
document
  .querySelector('#chapel')!
  .addEventListener('click', () =>
    isAiCenter ? view([65, 92, 65], [0, 33, 0]) : view([38, 19, 23], [7, 6, -12]),
  );
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
  camera.fov = camera.aspect < 0.7 ? (isAiCenter ? 65 : 52) : 40;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
