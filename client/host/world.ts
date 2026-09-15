import { gameConfig } from '@shared/config';
import type { BoxSpec, Vec3 } from './physics';
import {
  AEJIHEON_BOUNDS,
  DAEYANG_AI_BOUNDS,
  GWANGGAETO_BOUNDS,
  landmarkColliders,
  type LandmarkPlacement,
} from './models/landmarkPlacement';

export type Chunk = {
  index: number;
  road: BoxSpec;
  buildings: BoxSpec[];
  landmark?: LandmarkPlacement;
};

export type ChunkCallbacks = {
  onAdd: (chunk: Chunk) => void;
  onRemove: (chunkIndex: number) => void;
};

export function chunkBuildingColliders(chunk: Chunk): BoxSpec[] {
  return [...chunk.buildings, ...(chunk.landmark ? landmarkColliders(chunk.landmark) : [])];
}

const ROAD_THICKNESS = 1;

const LANDMARK_ORDER = ['aejiheon', 'daeyang-ai', 'gwanggaeto'] as const;
const LANDMARK_BOUNDS = {
  aejiheon: AEJIHEON_BOUNDS,
  'daeyang-ai': DAEYANG_AI_BOUNDS,
  gwanggaeto: GWANGGAETO_BOUNDS,
};

// 고정 seed 난수. 구간 index만으로 배치가 정해져 생성 순서와 무관하게 재현된다(ARCHITECTURE 5절).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chunkRandom(index: number): () => number {
  return mulberry32((gameConfig.world.seed ^ Math.imul(index, 0x9e3779b9)) >>> 0);
}

export function chunkIndexForZ(z: number): number {
  return Math.floor(-z / gameConfig.world.chunkLengthM);
}

// 구간 index의 z 범위는 [-(index+1)*L, -index*L]이다. 전방은 -Z(ARCHITECTURE 5절).
export function buildChunk(index: number): Chunk {
  const {
    roadWidthM,
    chunkLengthM,
    buildingHeightRangeM,
    buildingHalfWidthXM,
    buildingDepthM,
    buildingGapRangeM,
  } = gameConfig.world;

  const random = chunkRandom(index);
  const startZ = -index * chunkLengthM;
  const endZ = -(index + 1) * chunkLengthM;
  const buildingCenterX = roadWidthM / 2 + buildingHalfWidthXM;

  const buildings: BoxSpec[] = [];

  for (const side of [-1, 1] as const) {
    let cursorZ = startZ - random() * buildingGapRangeM[1];
    while (cursorZ - buildingDepthM >= endZ) {
      const centerZ = cursorZ - buildingDepthM / 2;
      const height =
        buildingHeightRangeM[0] + random() * (buildingHeightRangeM[1] - buildingHeightRangeM[0]);
      buildings.push({
        center: [side * buildingCenterX, height / 2, centerZ],
        halfExtents: [buildingHalfWidthXM, height / 2, buildingDepthM / 2],
      });
      const gap = buildingGapRangeM[0] + random() * (buildingGapRangeM[1] - buildingGapRangeM[0]);
      cursorZ = centerZ - buildingDepthM / 2 - gap;
    }
  }

  let landmark: LandmarkPlacement | undefined;
  const occurrence =
    (index - gameConfig.world.landmarkFirstChunk) / gameConfig.world.landmarkEveryChunks;
  if (Number.isInteger(occurrence) && occurrence >= 0) {
    const kind = LANDMARK_ORDER[occurrence % LANDMARK_ORDER.length]!;
    // 매번 좌우를 바꾼다. 종류가 3개(홀수)라 한 바퀴 돌 때마다 같은 종류가 반대편에 선다.
    const side = occurrence % 2 === 0 ? 1 : -1;
    const bounds = LANDMARK_BOUNDS[kind];
    const scale = gameConfig.world.landmarkScale[kind];
    const centerZ = (startZ + endZ) / 2 - (side * (bounds.minX + bounds.maxX) * scale) / 2;
    landmark = {
      position: [side * (roadWidthM / 2 + bounds.maxZ * scale), 0, centerZ],
      side,
      kind,
      scale,
    };
    const halfDepth = ((bounds.maxX - bounds.minX) * scale) / 2;
    const minZ = (startZ + endZ) / 2 - halfDepth - buildingGapRangeM[0];
    const maxZ = (startZ + endZ) / 2 + halfDepth + buildingGapRangeM[0];
    for (let i = buildings.length - 1; i >= 0; i--) {
      const building = buildings[i]!;
      if (
        Math.sign(building.center[0]) === side &&
        building.center[2] + building.halfExtents[2] > minZ &&
        building.center[2] - building.halfExtents[2] < maxZ
      )
        buildings.splice(i, 1);
    }
  }

  return {
    index,
    road: {
      center: [0, -ROAD_THICKNESS / 2, (startZ + endZ) / 2],
      halfExtents: [roadWidthM / 2, ROAD_THICKNESS / 2, chunkLengthM / 2],
    },
    buildings,
    ...(landmark ? { landmark } : {}),
  };
}

// 플레이어 주변 구간만 유지하는 무한 도로. 생성·회수를 콜백으로 알려 물리·렌더가 같은 단위로 따라간다.
export class ChunkedWorld {
  private active = new Map<number, Chunk>();

  constructor(private callbacks: ChunkCallbacks) {}

  get startPosition(): Vec3 {
    return [0, gameConfig.physics.startHeight, gameConfig.world.startPositionZ];
  }

  get activeChunkIndices(): number[] {
    return [...this.active.keys()].sort((a, b) => a - b);
  }

  // attachedChunkIndex의 구간은 부착 중인 앵커가 있으므로 회수하지 않는다(ARCHITECTURE 5절).
  update(playerZ: number, attachedChunkIndex: number | null): void {
    const { chunksAhead, chunksBehind } = gameConfig.world;
    const center = chunkIndexForZ(playerZ);
    const first = center - chunksBehind;
    const last = center + chunksAhead;
    for (const index of this.active.keys()) {
      if (index >= first && index <= last) continue;
      if (index === attachedChunkIndex) continue;
      this.active.delete(index);
      this.callbacks.onRemove(index);
    }

    for (let index = first; index <= last; index++) {
      if (this.active.has(index)) continue;
      const chunk = buildChunk(index);
      this.active.set(index, chunk);
      this.callbacks.onAdd(chunk);
    }
  }

  reset(): void {
    for (const index of this.active.keys()) {
      this.callbacks.onRemove(index);
    }
    this.active.clear();
    this.update(this.startPosition[2], null);
  }
}
