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
    // 버튼을 누르는 동안 줄 끝이 뻗어나가는 속도. 최대 사거리 70m까지 약 0.58초.
    travelSpeedMps: 120,
    // 날아가는 줄 끝이 받는 중력. 플레이어 중력과 별개이며, 휘어짐이 크지 않도록 작게 둔다
    // (70m 끝에서 약 3.4m 처짐, 10m에서 7cm). 체감 검증 전 제안 초기값.
    travelGravity: 20,
    minFireDistance: 3,
    maxFireDistance: 70,
    // 조준 보정: 조준 방향으로 이 반지름의 구체를 쓸어 벽면 접촉점을 찾는다(후보점 배열 대체).
    aimAssistRadiusM: 2.5,
  },

  // 시각 효과의 기존 초기값. 실기기 체감 검증 전이다.
  effects: {
    attachFlashDurationMs: 220,
    // 부착 지점에 남는 원형 거미줄 자국의 반지름(월드 고정 크기).
    attachSplatRadiusM: 1.2,
    missBeamDurationMs: 260,
    // 거미줄 선(발사·빗나감·부착)의 시작점 오프셋. 카메라 원점에서 시작하면 한 점으로 투영된다.
    beamOriginOffsetM: [0.25, -0.2, -0.5] as [number, number, number],
    // 섬유 묶음의 화면 두께와 부착 줄의 처짐을 조절한다.
    strand: {
      // 단면 반지름은 카메라까지의 거리에 비례해 먼 줄의 가독성을 유지한다.
      widthRatio: 0.005,
      minWidthM: 0.004,
      maxWidthM: 0.4,
      // 섬유 모델을 비행·처짐 경로에 맞춰 변형하는 분할 수.
      pathSegments: 48,
      // 부착 줄이 아래로 처지는 정도(거리 비례, 상한 있음).
      sagRatio: 0.04,
      maxSagM: 1.2,
    },
  },

  // 무한 도로 구간 (ARCHITECTURE 5절 제안 초기값, 측정 전 시작점)
  world: {
    roadWidthM: 24,
    // 차도 가장자리와 건물 사이에 확보하는 한쪽 인도 폭.
    buildingSetbackM: 4,
    // 도로 양옆을 채우는 보도 바닥의 한쪽 폭. 건물 사이 틈과 먼 지평선까지 공허가 보이지 않을
    // 만큼 넓게 둔다(카메라 far=500). 충돌에는 쓰지 않는 순수 시각 요소다.
    sidewalkWidthM: 300,
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
    // 광개토관도 도로를 따라가는 폭이 48m라 상한이 1.25다. 높이 62m가 이미 주변 건물보다
    // 높아 배율은 1.2로 둔다.
    landmarkScale: { aejiheon: 1.6, 'daeyang-ai': 1.25, gwanggaeto: 1.2 },
  },

  // 점수·정체 (PRD 5절 제안 초기값)
  progress: {
    scorePerSecond: 10,
    stallResetDistanceM: 5,
    stallWarnSec: 5,
    stallEndSec: 8,
  },
} as const;
