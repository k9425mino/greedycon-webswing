import * as THREE from 'three';
import { gameConfig } from '@shared/config';
import { mulberry32 } from './world';
import { createVehicle, VEHICLE_BODY_COLORS, VEHICLE_KINDS } from './models/vehicle';

// 도로를 달리는 자동차. 충돌체를 만들지 않는 순수 시각 요소라 배경 건물과 같은 취급이다
// (물리·점수 규칙은 그대로다). 구간(chunk)에 매달지 않고 플레이어 기준 앞뒤 창 안에서만
// 유지하며, 창을 벗어난 차는 반대쪽 끝으로 되돌려 같은 대수를 계속 쓴다.
export type TrafficCar = {
  laneIndex: number;
  z: number;
  speedMps: number;
};

// 차로는 노면 텍스처의 차선과 같은 6m 폭 4개다. 중앙 황색 복선을 기준으로 x<0은 마주 오는
// 차선(+Z), x>0은 플레이어와 같은 방향(-Z)이다(우측통행).
export function laneCenterX(laneIndex: number): number {
  const { roadWidthM } = gameConfig.world;
  const laneWidth = roadWidthM / gameConfig.world.traffic.laneCount;
  return -roadWidthM / 2 + (laneIndex + 0.5) * laneWidth;
}

export function laneDirection(laneIndex: number): 1 | -1 {
  return laneCenterX(laneIndex) < 0 ? 1 : -1;
}

// 나간 반대쪽 끝에서 다시 들여보낸다. 같은 쪽으로 되돌리면 바로 다시 나가 매 프레임 재활용된다.
// 위치는 항상 창 안쪽으로 잡고, 같은 차로의 다른 차와 겹치면 더 안쪽으로 밀어 준다.
function entryZ(
  cars: TrafficCar[],
  laneIndex: number,
  playerZ: number,
  fromAhead: boolean,
  random: () => number,
) {
  const { spawnAheadM, spawnBehindM, minGapM } = gameConfig.world.traffic;
  // inward는 창 안쪽(플레이어 쪽) 방향이다.
  const inward = fromAhead ? 1 : -1;
  const edge = fromAhead ? playerZ - spawnAheadM : playerZ + spawnBehindM;
  let z = edge + inward * random() * 60;
  for (let attempt = 0; attempt < 8; attempt++) {
    const tooClose = cars.some(
      (car) => car.laneIndex === laneIndex && Math.abs(car.z - z) < minGapM,
    );
    if (!tooClose) break;
    z += inward * minGapM;
  }
  return z;
}

function randomSpeed(random: () => number): number {
  const [min, max] = gameConfig.world.traffic.speedRangeMps;
  return min + random() * (max - min);
}

// 처음에는 창 전체에 흩어 둔다. 재활용과 달리 앞뒤 어디에서든 시작할 수 있다.
export function createTrafficCars(playerZ: number, random: () => number): TrafficCar[] {
  const { carCount, laneCount, spawnAheadM, spawnBehindM } = gameConfig.world.traffic;
  const cars: TrafficCar[] = [];
  for (let i = 0; i < carCount; i++) {
    const laneIndex = Math.floor(random() * laneCount);
    cars.push({
      laneIndex,
      z: playerZ + spawnBehindM - random() * (spawnAheadM + spawnBehindM),
      speedMps: randomSpeed(random),
    });
  }
  return cars;
}

// 차를 진행 방향으로 옮기고, 창을 벗어난 차는 새 차로·속도로 반대쪽 끝에 되돌린다.
export function advanceTrafficCars(
  cars: TrafficCar[],
  playerZ: number,
  dtSec: number,
  random: () => number,
): void {
  const { laneCount, spawnAheadM, spawnBehindM } = gameConfig.world.traffic;
  for (const car of cars) {
    car.z += laneDirection(car.laneIndex) * car.speedMps * dtSec;
    const exitedAhead = car.z < playerZ - spawnAheadM;
    if (exitedAhead || car.z > playerZ + spawnBehindM) {
      car.laneIndex = Math.floor(random() * laneCount);
      car.speedMps = randomSpeed(random);
      car.z = entryZ(cars, car.laneIndex, playerZ, !exitedAhead, random);
    }
  }
}

// 차량 mesh는 시작할 때 대수만큼 만들고 게임 내내 재사용한다. 종류는 대수에 걸쳐 돌려 쓰고
// 차체 색만 대마다 다르게 둔다(색을 바꾸려면 재질이 개별이어야 해 clone 대신 각각 생성한다).
export function createTraffic(scene: THREE.Scene, seed = 20260917) {
  const random = mulberry32(seed);
  const cars = createTrafficCars(0, random);
  const meshes = cars.map((_, index) =>
    createVehicle(
      VEHICLE_KINDS[index % VEHICLE_KINDS.length]!,
      VEHICLE_BODY_COLORS[Math.floor(random() * VEHICLE_BODY_COLORS.length)]!,
    ),
  );
  meshes.forEach((mesh) => scene.add(mesh));

  function sync() {
    cars.forEach((car, index) => {
      const mesh = meshes[index]!;
      mesh.position.set(laneCenterX(car.laneIndex), 0, car.z);
      // 모델은 앞이 -Z다. 마주 오는 차로만 반 바퀴 돌린다.
      mesh.rotation.y = laneDirection(car.laneIndex) === 1 ? Math.PI : 0;
    });
  }
  sync();

  return {
    cars,
    update(playerZ: number, dtSec: number): void {
      advanceTrafficCars(cars, playerZ, dtSec, random);
      sync();
    },
    // 재시작하면 플레이어가 시작 지점으로 돌아가므로 차도 그 주변에 다시 흩어 놓는다.
    reset(playerZ: number): void {
      const fresh = createTrafficCars(playerZ, random);
      cars.forEach((car, index) => Object.assign(car, fresh[index]!));
      sync();
    },
  };
}
