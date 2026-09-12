import { gameConfig } from '@shared/config';
import type { BuildingSpec, Vec3 } from './physics';
import type { Candidate } from './web';

export type PracticeWorld = {
  buildings: BuildingSpec[];
  candidates: Candidate[];
  startPosition: Vec3;
  roadWidth: number;
  roadLengthZ: number;
  roadCenterZ: number;
};

// 고정 연습 구간: 도로 양옆에 상자 건물 3쌍. 무한 생성·회수는 이번 범위에서 제외한다.
export function createPracticeWorld(): PracticeWorld {
  const { roadWidthM, buildingHeightM, buildingDepthM, startPositionZ } = gameConfig.practiceArena;
  const buildingHalfWidthX = 6;
  const innerFaceX = roadWidthM / 2;
  const buildingCenterX = innerFaceX + buildingHalfWidthX;
  const targetHeightY = buildingHeightM * 0.6;
  const pairZCenters = [-20, -50, -80];

  const buildings: BuildingSpec[] = [];
  const candidates: Candidate[] = [];

  for (const z of pairZCenters) {
    for (const side of [-1, 1] as const) {
      buildings.push({
        center: [side * buildingCenterX, buildingHeightM / 2, z],
        halfExtents: [buildingHalfWidthX, buildingHeightM / 2, buildingDepthM / 2],
      });
      candidates.push({ point: [side * innerFaceX, targetHeightY, z] });
    }
  }

  const roadLengthZ = 120;
  const roadCenterZ = -roadLengthZ / 2 + startPositionZ;

  return {
    buildings,
    candidates,
    startPosition: [0, gameConfig.physics.startHeight, startPositionZ],
    roadWidth: roadWidthM,
    roadLengthZ,
    roadCenterZ,
  };
}
