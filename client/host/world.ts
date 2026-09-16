import { gameConfig } from '@shared/config';
import type { BoxSpec, Vec3 } from './physics';
import { OFFICE_KINDS, type OfficeKind } from './models/office';
import {
  AEJIHEON_BOUNDS,
  DAEYANG_AI_BOUNDS,
  GWANGGAETO_BOUNDS,
  NAVER_BOUNDS,
  landmarkColliders,
  type LandmarkPlacement,
} from './models/landmarkPlacement';

type Building = BoxSpec & { style: OfficeKind };

export type Chunk = {
  index: number;
  road: BoxSpec;
  buildings: Building[];
  // 도로변 줄 바깥을 채우는 배경 건물. 충돌체를 만들지 않는 순수 시각 요소다.
  backdrop: Building[];
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

const LANDMARK_ORDER = ['aejiheon', 'daeyang-ai', 'gwanggaeto', 'naver'] as const;
const LANDMARK_BOUNDS = {
  aejiheon: AEJIHEON_BOUNDS,
  'daeyang-ai': DAEYANG_AI_BOUNDS,
  gwanggaeto: GWANGGAETO_BOUNDS,
  naver: NAVER_BOUNDS,
};

// 게임 seed와 구간 index로 재현해 회수된 구간에 돌아와도 같은 배치를 유지한다.
// 노면 텍스처의 알갱이처럼 매번 같아야 하는 장식에도 쓴다.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chunkRandom(index: number, seed: number): () => number {
  return mulberry32((seed ^ Math.imul(index, 0x9e3779b9)) >>> 0);
}

export function chunkIndexForZ(z: number): number {
  return Math.floor(-z / gameConfig.world.chunkLengthM);
}

// 구간 index의 z 범위는 [-(index+1)*L, -index*L]이다. 전방은 -Z(ARCHITECTURE 5절).
export function buildChunk(index: number, seed: number = gameConfig.world.seed): Chunk {
  const {
    roadWidthM,
    buildingSetbackM,
    chunkLengthM,
    buildingHeightRangeM,
    buildingHalfWidthXM,
    buildingDepthM,
    buildingGapRangeM,
    backdropRows,
    backdropRowGapM,
    backdropHeightRangeM,
    backdropGapRangeM,
  } = gameConfig.world;

  const random = chunkRandom(index, seed);
  const startZ = -index * chunkLengthM;
  const endZ = -(index + 1) * chunkLengthM;
  const buildingCenterX = roadWidthM / 2 + buildingSetbackM + buildingHalfWidthXM;

  // 한 줄(고정 x)을 구간 길이만큼 건물로 채운다. 도로변 줄과 배경 줄이 같은 규칙을 쓴다.
  function fillRow(
    into: Building[],
    side: -1 | 1,
    centerX: number,
    heightRange: readonly [number, number] | number[],
    gapRange: readonly [number, number] | number[],
  ) {
    let cursorZ = startZ - random() * gapRange[1]!;
    while (cursorZ - buildingDepthM >= endZ) {
      const centerZ = cursorZ - buildingDepthM / 2;
      const height = heightRange[0]! + random() * (heightRange[1]! - heightRange[0]!);
      into.push({
        center: [side * centerX, height / 2, centerZ],
        halfExtents: [buildingHalfWidthXM, height / 2, buildingDepthM / 2],
        style: OFFICE_KINDS[Math.floor(random() * OFFICE_KINDS.length)]!,
      });
      const gap = gapRange[0]! + random() * (gapRange[1]! - gapRange[0]!);
      cursorZ = centerZ - buildingDepthM / 2 - gap;
    }
  }

  const buildings: Building[] = [];
  const backdrop: Building[] = [];
  const rowStepX = buildingHalfWidthXM * 2 + backdropRowGapM;

  for (const side of [-1, 1] as const) {
    fillRow(buildings, side, buildingCenterX, buildingHeightRangeM, buildingGapRangeM);
    for (let row = 1; row <= backdropRows; row++) {
      fillRow(
        backdrop,
        side,
        buildingCenterX + row * rowStepX,
        backdropHeightRangeM,
        backdropGapRangeM,
      );
    }
  }

  let landmark: LandmarkPlacement | undefined;
  const occurrence =
    (index - gameConfig.world.landmarkFirstChunk) / gameConfig.world.landmarkEveryChunks;
  if (Number.isInteger(occurrence) && occurrence >= 0) {
    const kind = LANDMARK_ORDER[Math.floor(random() * LANDMARK_ORDER.length)]!;
    const side = random() < 0.5 ? -1 : 1;
    const bounds = LANDMARK_BOUNDS[kind];
    const scale = gameConfig.world.landmarkScale[kind];
    const centerZ = (startZ + endZ) / 2 - (side * (bounds.minX + bounds.maxX) * scale) / 2;
    landmark = {
      position: [side * (roadWidthM / 2 + buildingSetbackM + bounds.maxZ * scale), 0, centerZ],
      side,
      kind,
      scale,
    };
    const halfDepth = ((bounds.maxX - bounds.minX) * scale) / 2;
    const minZ = (startZ + endZ) / 2 - halfDepth - buildingGapRangeM[0];
    const maxZ = (startZ + endZ) / 2 + halfDepth + buildingGapRangeM[0];
    // 모델은 도로 쪽으로 90° 돌아가므로 도로에서 멀어지는 방향의 길이는 지역 z 범위가 결정한다.
    const reachX =
      roadWidthM / 2 + buildingSetbackM + (bounds.maxZ - bounds.minZ) * scale + buildingHalfWidthXM;
    for (const row of [buildings, backdrop]) {
      for (let i = row.length - 1; i >= 0; i--) {
        const building = row[i]!;
        if (
          Math.sign(building.center[0]) === side &&
          Math.abs(building.center[0]) < reachX &&
          building.center[2] + building.halfExtents[2] > minZ &&
          building.center[2] - building.halfExtents[2] < maxZ
        )
          row.splice(i, 1);
      }
    }
  }

  return {
    index,
    road: {
      center: [0, -ROAD_THICKNESS / 2, (startZ + endZ) / 2],
      halfExtents: [roadWidthM / 2, ROAD_THICKNESS / 2, chunkLengthM / 2],
    },
    buildings,
    backdrop,
    ...(landmark ? { landmark } : {}),
  };
}

// 플레이어 주변 구간만 유지하는 무한 도로. 생성·회수를 콜백으로 알려 물리·렌더가 같은 단위로 따라간다.
export class ChunkedWorld {
  private active = new Map<number, Chunk>();
  private seed = Math.floor(Math.random() * 0x100000000);

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
      const chunk = buildChunk(index, this.seed);
      this.active.set(index, chunk);
      this.callbacks.onAdd(chunk);
    }
  }

  reset(): void {
    for (const index of this.active.keys()) {
      this.callbacks.onRemove(index);
    }
    this.active.clear();
    // 재개는 reset을 호출하지 않는다. 새 게임·재시작에서만 새 도시를 만든다.
    this.seed = (this.seed + 1 + Math.floor(Math.random() * 0xffffffff)) >>> 0;
    this.update(this.startPosition[2], null);
  }
}
