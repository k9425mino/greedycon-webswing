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
    // 부착 중 보조 (체감 미검증 제안 초기값). 부착점 중심의 진자가 아니라 도로 전방(-Z) 추진과
    // 부착점 방향의 약한 당김을 매 step 가속도로 더한다.
    // 18/8/24(2026-09-15 자동 테스트 측정값)로는 부착 직후 가속이 밋밋하고 높은 곳에 걸어도
    // 낙하가 느려지기만 했다. 전진 목표·가속과 상하 당김을 올려 실제로 솟아오르게 한다.
    // 아래 값은 2026-09-16 자동 테스트로 고른 제안값이고 실기기 체감 검증은 아직이다.
    assistForwardTargetSpeed: 30,
    assistForwardAccel: 24,
    assistLateralAccel: 4,
    assistVerticalAccel: 48,
    // 부착점까지 남은 전방 거리가 이 값 아래면 보조를 선형으로 줄인다.
    assistFadeDistanceM: 5,
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
    // 랜드마크 배치 제안값: 첫 120m 이후 약 240m 간격으로 좌우 교대.
    landmarkEveryChunks: 4,
    landmarkFirstChunk: 2,
    // 종류별 확대 배율. 애지헌 탑이 주변 건물(45~70m)에 묻혀 작아 보여 더 키웠다.
    // 대양AI센터는 바닥 폭이 48m라 구간 길이 60m를 넘지 않는 1.25가 상한이다.
    landmarkScale: { aejiheon: 1.6, 'daeyang-ai': 1.25 },
  },

  // 점수·정체 (PRD 5절 제안 초기값)
  progress: {
    scorePerSecond: 10,
    stallResetDistanceM: 5,
    stallWarnSec: 5,
    stallEndSec: 8,
  },
} as const;
