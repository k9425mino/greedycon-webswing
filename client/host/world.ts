import { gameConfig } from '@shared/config';
import type { BoxSpec, Vec3 } from './physics';
import type { Candidate } from './web';

export type Chunk = {
  index: number;
  road: BoxSpec;
  buildings: BoxSpec[];
  candidates: Candidate[];
};

export type ChunkCallbacks = {
  onAdd: (chunk: Chunk) => void;
  onRemove: (chunkIndex: number) => void;
};

const ROAD_THICKNESS = 1;

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
  const innerFaceX = roadWidthM / 2;
  const buildingCenterX = innerFaceX + buildingHalfWidthXM;

  const buildings: BoxSpec[] = [];
  const candidates: Candidate[] = [];

  for (const side of [-1, 1] as const) {
    // 구간 0은 시작 직후 양쪽에 바로 걸 수 있는 표적을 보장한다(ARCHITECTURE 5절).
    let cursorZ = index === 0 ? startZ - 14 : startZ - random() * buildingGapRangeM[1];
    while (cursorZ - buildingDepthM >= endZ) {
      const centerZ = cursorZ - buildingDepthM / 2;
      const height =
        index === 0
          ? buildingHeightRangeM[0]
          : buildingHeightRangeM[0] +
            random() * (buildingHeightRangeM[1] - buildingHeightRangeM[0]);
      buildings.push({
        center: [side * buildingCenterX, height / 2, centerZ],
        halfExtents: [buildingHalfWidthXM, height / 2, buildingDepthM / 2],
      });
      candidates.push({ point: [side * innerFaceX, height * 0.6, centerZ] });
      const gap =
        buildingGapRangeM[0] + random() * (buildingGapRangeM[1] - buildingGapRangeM[0]);
      cursorZ = centerZ - buildingDepthM / 2 - gap;
    }
  }

  return {
    index,
    road: {
      center: [0, -ROAD_THICKNESS / 2, (startZ + endZ) / 2],
      halfExtents: [roadWidthM / 2, ROAD_THICKNESS / 2, chunkLengthM / 2],
    },
    buildings,
    candidates,
  };
}

// 플레이어 주변 구간만 유지하는 무한 도로. 생성·회수를 콜백으로 알려 물리·렌더가 같은 단위로 따라간다.
export class ChunkedWorld {
  // WebSwing이 생성자에서 이 배열 참조를 들고 있으므로 항상 같은 인스턴스를 제자리 변경한다.
  readonly candidates: Candidate[] = [];
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
    let changed = false;

    for (const index of this.active.keys()) {
      if (index >= first && index <= last) continue;
      if (index === attachedChunkIndex) continue;
      this.active.delete(index);
      this.callbacks.onRemove(index);
      changed = true;
    }

    for (let index = first; index <= last; index++) {
      if (this.active.has(index)) continue;
      const chunk = buildChunk(index);
      this.active.set(index, chunk);
      this.callbacks.onAdd(chunk);
      changed = true;
    }

    if (changed) this.rebuildCandidates();
  }

  reset(): void {
    for (const index of this.active.keys()) {
      this.callbacks.onRemove(index);
    }
    this.active.clear();
    this.update(this.startPosition[2], null);
  }

  private rebuildCandidates(): void {
    this.candidates.length = 0;
    for (const chunk of this.active.values()) {
      this.candidates.push(...chunk.candidates);
    }
  }
}
