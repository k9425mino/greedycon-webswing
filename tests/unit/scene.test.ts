import { expect, it } from 'vitest';
import * as THREE from 'three';
import { createRopeLine, updateRopeLine } from '../../client/host/scene';

it('이동한 거미줄이 카메라 안에 있으면 이전 위치의 경계 때문에 숨겨지지 않는다', () => {
  const line = createRopeLine(new THREE.Scene());
  updateRopeLine(line, [100, 0, -10], [110, 0, -10]);
  line.geometry.computeBoundingSphere();
  updateRopeLine(line, [0, 0, -10], [0, 5, -10]);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(camera.projectionMatrix);
  expect(frustum.intersectsObject(line)).toBe(true);
  line.geometry.dispose();
});
