import * as THREE from 'three';
import { gameConfig } from '@shared/config';

// 이번 범위엔 건물·스윙이 없다. 전방을 확인할 수 있는 단순 배경만 둔다.
export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 20, 120);

  const camera = new THREE.PerspectiveCamera(
    gameConfig.cameraVerticalFovDeg,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, -1);

  const grid = new THREE.GridHelper(200, 40, 0x555577, 0x33334d);
  scene.add(grid);

  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambient);

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);
  resize();

  function render() {
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  return { renderer, scene, camera };
}
