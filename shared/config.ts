// 튜닝 가능한 수치는 모두 여기 모은다. PRD 5절·ARCHITECTURE 5절의 제안 초기값(측정 전 시작점)이다.

export const AVAILABLE_INPUT_RATES_HZ = [30, 60, 120] as const;
export type InputRateHz = (typeof AVAILABLE_INPUT_RATES_HZ)[number];

export const gameConfig = {
  // 입력 전송 (ARCHITECTURE 3절: 방향·누름 상태는 최대 30Hz, 이번 검증 화면에서는 30/60/120 비교용으로 노출)
  defaultInputRateHz: 60 as InputRateHz,

  // 입력 중단 판정 (PRD 5절)
  inputLostTimeoutMs: 500,

  // 조준 (ARCHITECTURE 5절 제안 초기값, 실기기 검증 전)
  aimLimitsDeg: {
    yawLeft: 70,
    yawRight: 70,
    pitchUp: 75,
    pitchDown: 35,
  },
  calibrationSearchHalfAngleDeg: 12,
  cameraVerticalFovDeg: 75,

  // 세션 정리 (ARCHITECTURE 3절)
  emptySessionTtlMs: 10 * 60 * 1000,

  // 물리 (ARCHITECTURE 5절 제안 초기값, 실기기 검증 전)
  physics: {
    fixedTimestepSec: 1 / 60,
    maxStepsPerFrame: 5,
    gravity: 9.81,
    playerRadius: 0.4,
    startHeight: 18,
    forwardSpeed: 14,
    attachPullSpeed: 2,
    buildingRestitution: 0.2,
    buildingFriction: 0.1,
  },

  // 발사·표적 (ARCHITECTURE 5절 제안 초기값)
  web: {
    fireEffectSec: 0.1,
    minFireDistance: 3,
    maxFireDistance: 70,
  },

  // 무한 도로 구간 (ARCHITECTURE 5절 제안 초기값, 측정 전 시작점)
  world: {
    roadWidthM: 24,
    chunkLengthM: 60,
    chunksAhead: 4,
    chunksBehind: 2,
    buildingHeightRangeM: [30, 50],
    buildingHalfWidthXM: 6,
    buildingDepthM: 18,
    buildingGapRangeM: [2, 6],
    startPositionZ: 0,
    seed: 20260917,
  },

  // 점수·정체 (PRD 5절 제안 초기값)
  progress: {
    scorePerSecond: 10,
    stallResetDistanceM: 5,
    stallWarnSec: 5,
    stallEndSec: 8,
  },
} as const;
