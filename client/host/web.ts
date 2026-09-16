import { gameConfig } from '@shared/config';

export type Vec3 = [number, number, number];

export type TargetHit = { point: Vec3; distance: number; normal?: Vec3 };

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
  travelGravity: number;
  minDistance: number;
  maxDistance: number;
  assistRadius: number;
};

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

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
  // 그때까지의 비행 경로와 마지막 진행 방향을 넘긴다.
  onFireMiss?: (path: Vec3[], direction: Vec3) => void;
  onAttach: (target: TargetHit) => void;
  onRelease: () => void;
};

// idle -> firing -> attached -> idle, 실패 시 releasedRequired (ARCHITECTURE 4절).
export class WebSwing {
  phase: SwingPhase = 'idle';
  // 발사 순간 고정한 줄의 출발점·방향. 줄 끝은 여기서 출발해 중력을 받는 탄도를 그린다.
  private fireOrigin: Vec3 = [0, 0, 0];
  private fireDirection: Vec3 = [0, 0, -1];
  private fireStartedAt = 0;
  private elapsed = 0;
  // 줄 끝이 지금까지 날아간 경로 길이. 최대 사거리는 직선 거리가 아니라 이 길이로 잰다.
  private travelled = 0;
  private tip: Vec3 = [0, 0, 0];
  private lastPressed = false;
  private failure: FireFailure | null = null;

  constructor(
    private query: TargetQuery,
    private options: SwingOptions,
  ) {}

  // 발사 후 t초일 때의 줄 끝. 수평은 등속, 수직은 중력으로 처진다.
  private tipAt(t: number): Vec3 {
    const drop = 0.5 * this.options.travelGravity * t * t;
    const forward = this.options.travelSpeedMps * t;
    return [
      this.fireOrigin[0] + this.fireDirection[0] * forward,
      this.fireOrigin[1] + this.fireDirection[1] * forward - drop,
      this.fireOrigin[2] + this.fireDirection[2] * forward,
    ];
  }

  // 직전 줄 끝에서 지금 줄 끝까지의 구간만 검사한다. 이미 지나간 곳은 다시 보지 않는다.
  private hitAlong(from: Vec3, to: Vec3, travelledAtStart: number): TargetHit | null {
    const delta = subtract(to, from);
    const segmentLength = length(delta);
    if (segmentLength < 1e-6) return null;
    const direction: Vec3 = [
      delta[0] / segmentLength,
      delta[1] / segmentLength,
      delta[2] / segmentLength,
    ];
    // 최소 사거리 전까지는 걸리지 않는다. 구간 중간부터 검사해야 하면 시작점을 앞으로 당긴다.
    const skip = Math.max(0, this.options.minDistance - travelledAtStart);
    if (skip >= segmentLength) return null;
    const origin: Vec3 = [
      from[0] + direction[0] * skip,
      from[1] + direction[1] * skip,
      from[2] + direction[2] * skip,
    ];
    const reach = segmentLength - skip;

    const direct = this.query.raycastBuilding(origin, direction, reach);
    if (direct) return direct;
    // 조준 보정: 줄 끝 주변을 구체로 쓸어 살짝 빗나간 벽면도 잡는다(ARCHITECTURE 5절).
    const swept = this.query.sweepBuilding(origin, direction, reach, this.options.assistRadius);
    if (!swept || !this.query.isVisible(origin, swept.point)) return null;
    return swept;
  }

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
      // 누른 순간에는 표적을 정하지 않는다. 날아가는 줄 끝이 처음 걸리는 건물에 부착한다.
      this.phase = 'firing';
      this.fireOrigin = origin;
      this.fireDirection = normalize(aimDirection);
      this.fireStartedAt = nowSec;
      this.elapsed = 0;
      this.travelled = 0;
      this.tip = origin;
      callbacks.onFireStart?.();
      return;
    }

    if (this.phase === 'firing') {
      if (fallingEdge) {
        this.failure = 'releasedWhileFiring';
        // 이미 손을 뗐으므로 추가 해제를 기다리면 바로 이어진 다음 누름을 놓친다.
        this.phase = 'idle';
        return;
      }
      this.elapsed = nowSec - this.fireStartedAt;
      const previousTip = this.tip;
      const previousTravelled = this.travelled;
      const nextTip = this.tipAt(this.elapsed);
      this.travelled += length(subtract(nextTip, previousTip));
      this.tip = nextTip;

      const hit = this.hitAlong(previousTip, nextTip, previousTravelled);
      if (hit) {
        this.failure = null;
        // 부착 거리는 표시·진단용이며, 실제 부착점은 줄 끝이 닿은 그 지점이다.
        callbacks.onAttach({ ...hit, distance: this.travelled });
        this.phase = 'attached';
        return;
      }
      if (this.travelled >= this.options.maxDistance) {
        callbacks.onFireMiss?.(this.pathPoints(), this.fireDirection);
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
    this.elapsed = 0;
    this.travelled = 0;
    this.lastPressed = currentlyPressed;
    this.failure = null;
  }

  // 마지막 발사가 부착에 실패한 이유. 부착에 성공하면 null이 된다.
  get lastFailure(): FireFailure | null {
    return this.failure;
  }

  // 날아가는 중인 줄 끝. firing 단계가 아니면 null이다.
  get tipPoint(): Vec3 | null {
    return this.phase === 'firing' ? this.tip : null;
  }

  // 발사점부터 현재 줄 끝까지의 비행 경로. 휘어진 줄을 그리는 데 쓴다.
  pathPoints(samples = 12): Vec3[] {
    const points: Vec3[] = [];
    for (let i = 0; i <= samples; i++) {
      points.push(this.tipAt((this.elapsed * i) / samples));
    }
    return points;
  }
}

export function defaultSwingOptions(): SwingOptions {
  return {
    travelSpeedMps: gameConfig.web.travelSpeedMps,
    travelGravity: gameConfig.web.travelGravity,
    minDistance: gameConfig.web.minFireDistance,
    maxDistance: gameConfig.web.maxFireDistance,
    assistRadius: gameConfig.web.aimAssistRadiusM,
  };
}
