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
  cameraVerticalFovDeg: 90,

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
    attachSwingBoostSpeed: 2,
    // 줄 구속 (rope joint 대체). 부착 순간 거리를 고정 길이로 잡고 양방향으로 구속한다.
    // 길이 오차를 되돌릴 때 쓰는 반경 방향 속도의 상한이다.
    ropeCorrectionSpeed: 8,
    // 부착 직후 짧은 당김. 줄의 목표 길이를 부착 거리보다 이만큼 짧게 잡고 아래 속도로 감는다.
    // 감기가 끝나면 그 길이로 고정된다(부착당 한 번).
    attachPullDistanceM: 0.6,
    attachPullSpeed: 3,
    buildingRestitution: 0.2,
    buildingFriction: 0.1,
  },

  // 발사·표적 (ARCHITECTURE 5절 제안 초기값)
  web: {
    fireEffectSec: 0.1,
    minFireDistance: 3,
    maxFireDistance: 70,
    // 조준 보정: 조준 방향으로 이 반지름의 구체를 쓸어 벽면 접촉점을 찾는다(후보점 배열 대체).
    aimAssistRadiusM: 2.5,
  },

  // 시각 효과의 기존 초기값. 실기기 체감 검증 전이다.
  effects: {
    attachFlashDurationMs: 220,
    firePulsePerMs: 0.05,
    missBeamDurationMs: 260,
    // 거미줄 선(발사·빗나감·부착)의 시작점 오프셋. 카메라 원점에서 시작하면 한 점으로 투영된다.
    beamOriginOffsetM: [0.25, -0.2, -0.5] as [number, number, number],
  },

  // 무한 도로 구간 (ARCHITECTURE 5절 제안 초기값, 측정 전 시작점)
  world: {
    roadWidthM: 24,
    chunkLengthM: 60,
    chunksAhead: 4,
    chunksBehind: 2,
    buildingHeightRangeM: [45, 70],
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
