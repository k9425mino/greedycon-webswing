import { gameConfig } from '@shared/config';

export type Vec3 = [number, number, number];

export type TargetHit = { point: Vec3; distance: number };

export interface TargetQuery {
  raycastBuilding(origin: Vec3, direction: Vec3, maxDistance: number): TargetHit | null;
  isVisible(origin: Vec3, target: Vec3): boolean;
}

export type Candidate = { point: Vec3 };

export type SwingPhase = 'idle' | 'firing' | 'attached' | 'releasedRequired';

// 부착에 실패한 이유. 진단 표시용이며 상태 전이에는 쓰지 않는다.
export type FireFailure = 'noTarget' | 'releasedWhileFiring' | 'outOfRange' | 'occluded';

export type SwingOptions = {
  effectSec: number;
  minDistance: number;
  maxDistance: number;
  coneHalfAngleDeg: number;
};

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function normalize(v: Vec3): Vec3 {
  const len = length(v) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const clamped = Math.max(-1, Math.min(1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}

function distanceBetween(a: Vec3, b: Vec3): number {
  return length(subtract(a, b));
}

// 후보 부착점 중 조준 방향에 가장 가까운(동률이면 가까운) 가려지지 않은 점을 찾는다.
export function findCandidateTarget(
  origin: Vec3,
  aimDirection: Vec3,
  candidates: Candidate[],
  query: TargetQuery,
  options: SwingOptions,
): TargetHit | null {
  let best: { hit: TargetHit; angle: number } | null = null;
  for (const candidate of candidates) {
    const toCandidate = subtract(candidate.point, origin);
    const distance = length(toCandidate);
    if (distance < options.minDistance || distance > options.maxDistance) continue;
    const direction = normalize(toCandidate);
    const angle = angleBetweenDeg(aimDirection, direction);
    if (angle > options.coneHalfAngleDeg) continue;
    if (!query.isVisible(origin, candidate.point)) continue;
    if (!best || angle < best.angle || (angle === best.angle && distance < best.hit.distance)) {
      best = { hit: { point: candidate.point, distance }, angle };
    }
  }
  return best?.hit ?? null;
}

// 직접 맞힌 건물 표면을 우선하고, 없으면 보정 원뿔 안의 후보를 찾는다(ARCHITECTURE 5절).
export function selectTarget(
  origin: Vec3,
  aimDirection: Vec3,
  candidates: Candidate[],
  query: TargetQuery,
  options: SwingOptions,
): TargetHit | null {
  const direct = query.raycastBuilding(origin, aimDirection, options.maxDistance);
  if (direct && direct.distance >= options.minDistance) return direct;
  return findCandidateTarget(origin, aimDirection, candidates, query, options);
}

export type SwingCallbacks = {
  onFireStart?: (target: TargetHit) => void;
  // 표적을 찾지 못한 발사. 쏜 것 자체는 보여줘야 해서 조준 방향을 그대로 넘긴다.
  onFireMiss?: (aimDirection: Vec3) => void;
  onAttach: (target: TargetHit) => void;
  onRelease: () => void;
};

// idle -> firing -> attached -> idle, 실패 시 releasedRequired (ARCHITECTURE 4절).
export class WebSwing {
  phase: SwingPhase = 'idle';
  private pendingTarget: TargetHit | null = null;
  private fireStartedAt = 0;
  private lastPressed = false;
  private failure: FireFailure | null = null;

  constructor(
    private query: TargetQuery,
    private candidates: Candidate[],
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
      const target = selectTarget(origin, aimDirection, this.candidates, this.query, this.options);
      if (target) {
        this.phase = 'firing';
        this.pendingTarget = target;
        this.fireStartedAt = nowSec;
        callbacks.onFireStart?.(target);
      } else {
        callbacks.onFireMiss?.(aimDirection);
        this.failure = 'noTarget';
        this.phase = 'releasedRequired';
      }
      return;
    }

    if (this.phase === 'firing') {
      if (fallingEdge) {
        this.failure = 'releasedWhileFiring';
        this.phase = 'releasedRequired';
        this.pendingTarget = null;
        return;
      }
      if (nowSec - this.fireStartedAt < this.options.effectSec) return;
      const target = this.pendingTarget;
      this.pendingTarget = null;
      const distance = target ? distanceBetween(origin, target.point) : Infinity;
      const inRange = distance >= this.options.minDistance && distance <= this.options.maxDistance;
      const stillValid = target !== null && inRange && this.query.isVisible(origin, target.point);
      if (stillValid && target) {
        this.failure = null;
        callbacks.onAttach({ point: target.point, distance });
        this.phase = 'attached';
      } else {
        this.failure = !target ? 'noTarget' : inRange ? 'occluded' : 'outOfRange';
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
    this.pendingTarget = null;
    this.lastPressed = currentlyPressed;
    this.failure = null;
  }

  // 마지막 발사가 부착에 실패한 이유. 부착에 성공하면 null이 된다.
  get lastFailure(): FireFailure | null {
    return this.failure;
  }

  // 발사 진행 중 표적점(시각 효과용). firing 단계가 아니면 null이다.
  get pendingTargetPoint(): Vec3 | null {
    return this.phase === 'firing' ? (this.pendingTarget?.point ?? null) : null;
  }
}

export function defaultSwingOptions(): SwingOptions {
  return {
    effectSec: gameConfig.web.fireEffectSec,
    minDistance: gameConfig.web.minFireDistance,
    maxDistance: gameConfig.web.maxFireDistance,
    coneHalfAngleDeg: gameConfig.calibrationSearchHalfAngleDeg,
  };
}
