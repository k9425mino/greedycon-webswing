import { gameConfig } from '@shared/config';

export type Vec3 = [number, number, number];

export type TargetHit = { point: Vec3; distance: number };

export interface TargetQuery {
  raycastBuilding(origin: Vec3, direction: Vec3, maxDistance: number): TargetHit | null;
  sweepBuilding(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    radius: number,
  ): TargetHit | null;
  isVisible(origin: Vec3, target: Vec3): boolean;
}

export type SwingPhase = 'idle' | 'firing' | 'attached' | 'releasedRequired';

// 부착에 실패한 이유. 진단 표시용이며 상태 전이에는 쓰지 않는다.
export type FireFailure = 'noTarget' | 'releasedWhileFiring';

export type SwingOptions = {
  travelSpeedMps: number;
  minDistance: number;
  maxDistance: number;
  assistRadius: number;
};

function length(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len < 1e-6) return [0, 0, -1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

// 직접 맞힌 건물 표면을 우선하고, 없으면 조준 방향으로 구체를 쓸어 벽면 접촉점을 찾는다
// (ARCHITECTURE 5절). 벽면의 높이는 보지 않는다 — 조준한 지점 그대로 부착한다.
export function selectTarget(
  origin: Vec3,
  aimDirection: Vec3,
  query: TargetQuery,
  options: SwingOptions,
): TargetHit | null {
  // 직접 조준 우선(PRD IN-05). 스윕은 구체 반지름만큼 앞에서 맞아 조준한 지점과 미묘하게 다르다.
  const direct = query.raycastBuilding(origin, aimDirection, options.maxDistance);
  if (direct && direct.distance >= options.minDistance) return direct;
  const swept = query.sweepBuilding(
    origin,
    aimDirection,
    options.maxDistance,
    options.assistRadius,
  );
  // 스윕 이동 거리와 벽면 접촉점까지 거리는 다르다. 미리보기도 부착 시점과 같은 조건으로 거른다.
  if (
    !swept ||
    swept.distance < options.minDistance ||
    swept.distance > options.maxDistance ||
    !query.isVisible(origin, swept.point)
  )
    return null;
  return swept;
}

export type SwingCallbacks = {
  // 발사 시작. 이 시점에는 아직 표적이 없다(줄 끝이 뻗어나가며 찾는다).
  onFireStart?: () => void;
  // 최대 사거리까지 아무것도 걸지 못한 발사. 걸리지 못한 줄이 계속 날아가는 연출을 위해
  // 줄 끝 위치와 진행 방향을 넘긴다.
  onFireMiss?: (tip: Vec3, direction: Vec3) => void;
  onAttach: (target: TargetHit) => void;
  onRelease: () => void;
};

// idle -> firing -> attached -> idle, 실패 시 releasedRequired (ARCHITECTURE 4절).
export class WebSwing {
  phase: SwingPhase = 'idle';
  // 발사 순간 고정한 줄의 출발점·방향. 줄 끝은 이 반직선을 따라 일정 속도로 뻗어나간다.
  private fireOrigin: Vec3 = [0, 0, 0];
  private fireDirection: Vec3 = [0, 0, -1];
  private fireStartedAt = 0;
  private reach = 0;
  private lastPressed = false;
  private failure: FireFailure | null = null;

  constructor(
    private query: TargetQuery,
    private options: SwingOptions,
  ) {}

  update(
    pressed: boolean,
    nowSec: number,
    origin: Vec3,
    aimDirection: Vec3,
    callbacks: SwingCallbacks,
  ): void {
    const risingEdge = pressed && !this.lastPressed;
    const fallingEdge = !pressed && this.lastPressed;
    this.lastPressed = pressed;

    if (this.phase === 'idle') {
      if (!risingEdge) return;
      // 누른 순간에는 표적을 정하지 않는다. 줄 끝이 뻗어나가다 처음 걸리는 건물에 부착한다.
      this.phase = 'firing';
      this.fireOrigin = origin;
      this.fireDirection = normalize(aimDirection);
      this.fireStartedAt = nowSec;
      this.reach = 0;
      callbacks.onFireStart?.();
      return;
    }

    if (this.phase === 'firing') {
      if (fallingEdge) {
        this.failure = 'releasedWhileFiring';
        // 이미 손을 뗐으므로 추가 해제를 기다리면 바로 이어진 다음 누름을 놓친다.
        this.phase = 'idle';
        this.reach = 0;
        return;
      }
      this.reach = Math.min(
        (nowSec - this.fireStartedAt) * this.options.travelSpeedMps,
        this.options.maxDistance,
      );
      // 지금까지 뻗은 길이 안에서만 표적을 찾는다. 줄 끝이 아직 닿지 않은 건물은 걸리지 않는다.
      const target = selectTarget(this.fireOrigin, this.fireDirection, this.query, {
        ...this.options,
        maxDistance: this.reach,
      });
      if (target) {
        this.failure = null;
        callbacks.onAttach(target);
        this.phase = 'attached';
        return;
      }
      if (this.reach >= this.options.maxDistance) {
        callbacks.onFireMiss?.(this.tipPoint ?? origin, this.fireDirection);
        this.failure = 'noTarget';
        this.phase = 'releasedRequired';
      }
      return;
    }

    if (this.phase === 'attached') {
      if (fallingEdge) {
        callbacks.onRelease();
        this.phase = 'idle';
      }
      return;
    }

    // releasedRequired
    if (!pressed) {
      this.phase = 'idle';
    }
  }

  // currentlyPressed: 재개·재시작 순간 이미 눌려있어도 자동 발사로 취급하지 않기 위해 기준값으로 사용한다.
  reset(currentlyPressed = false): void {
    this.phase = 'idle';
    this.reach = 0;
    this.lastPressed = currentlyPressed;
    this.failure = null;
  }

  // 마지막 발사가 부착에 실패한 이유. 부착에 성공하면 null이 된다.
  get lastFailure(): FireFailure | null {
    return this.failure;
  }

  // 뻗어나가는 중인 줄 끝(시각 효과용). firing 단계가 아니면 null이다.
  get tipPoint(): Vec3 | null {
    if (this.phase !== 'firing') return null;
    return [
      this.fireOrigin[0] + this.fireDirection[0] * this.reach,
      this.fireOrigin[1] + this.fireDirection[1] * this.reach,
      this.fireOrigin[2] + this.fireDirection[2] * this.reach,
    ];
  }
}

export function defaultSwingOptions(): SwingOptions {
  return {
    travelSpeedMps: gameConfig.web.travelSpeedMps,
    minDistance: gameConfig.web.minFireDistance,
    maxDistance: gameConfig.web.maxFireDistance,
    assistRadius: gameConfig.web.aimAssistRadiusM,
  };
}
