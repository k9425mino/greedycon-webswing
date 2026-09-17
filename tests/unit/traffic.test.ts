import { expect, it } from 'vitest';
import {
  advanceTrafficCars,
  createTrafficCars,
  laneCenterX,
  laneDirection,
} from '../../client/host/traffic';
import { mulberry32 } from '../../client/host/world';
import { gameConfig } from '../../shared/config';

const { carCount, laneCount, spawnAheadM, spawnBehindM, speedRangeMps } = gameConfig.world.traffic;

it('차로는 도로 폭 안에 있고 중앙선을 기준으로 방향이 갈린다', () => {
  const half = gameConfig.world.roadWidthM / 2;
  for (let lane = 0; lane < laneCount; lane++) {
    const x = laneCenterX(lane);
    expect(Math.abs(x)).toBeLessThan(half);
    // 우측통행: 플레이어와 같은 방향(-Z)으로 가는 차는 중앙선 오른쪽(x>0)에 있다.
    expect(laneDirection(lane)).toBe(x < 0 ? 1 : -1);
  }
});

it('자동차는 유지 범위 안에 흩어져 생성된다', () => {
  const cars = createTrafficCars(-500, mulberry32(1));
  expect(cars).toHaveLength(carCount);
  for (const car of cars) {
    expect(car.z).toBeLessThanOrEqual(-500 + spawnBehindM);
    expect(car.z).toBeGreaterThanOrEqual(-500 - spawnAheadM);
    expect(car.speedMps).toBeGreaterThanOrEqual(speedRangeMps[0]);
    expect(car.speedMps).toBeLessThanOrEqual(speedRangeMps[1]);
  }
});

it('차로 방향대로 움직인다', () => {
  const cars = [
    { laneIndex: 0, z: 0, speedMps: 10 },
    { laneIndex: laneCount - 1, z: 0, speedMps: 10 },
  ];
  advanceTrafficCars(cars, 0, 0.5, mulberry32(2));
  // 마주 오는 차로는 +Z, 같은 방향 차로는 -Z로 간다.
  expect(cars[0]!.z).toBeCloseTo(5);
  expect(cars[1]!.z).toBeCloseTo(-5);
});

it('플레이어가 전진해도 자동차는 계속 주변에 남는다', () => {
  const random = mulberry32(3);
  const cars = createTrafficCars(0, random);
  let playerZ = 0;
  for (let step = 0; step < 600; step++) {
    playerZ -= 25 * (1 / 60);
    advanceTrafficCars(cars, playerZ, 1 / 60, random);
  }
  for (const car of cars) {
    expect(car.z).toBeLessThanOrEqual(playerZ + spawnBehindM);
    expect(car.z).toBeGreaterThanOrEqual(playerZ - spawnAheadM);
  }
  // 플레이어 앞쪽 화면에 들어오는 거리(200m 이내)에 항상 몇 대는 있어야 도로가 비지 않는다.
  const visible = cars.filter((car) => car.z < playerZ && car.z > playerZ - 200);
  expect(visible.length).toBeGreaterThan(2);
});
