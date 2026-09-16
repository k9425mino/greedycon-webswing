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

  // 카메라 연출(2026-09-16 추가). 고정 시야·고정 수평이라 속도가 올라도 화면이 그대로였다.
  // 강도는 중간으로 맞춘 제안값이고 실기기·부스 관객 체감 검증은 아직이다.
  camera: {
    // 속도에 따라 시야각을 넓힌다. 아래 범위 밖에서는 양 끝값으로 고정된다.
    maxFovDeg: 106,
    fovSpeedRangeMs: [14, 42] as [number, number],
    fovSmoothingPerSec: 6,
    // 줄이 걸린 쪽으로 화면이 기운다(스윙 방향감). 기준은 앵커의 좌우 오프셋이다.
    maxRollDeg: 14,
    rollAnchorOffsetM: 16,
    rollSmoothingPerSec: 5,
    // 흔들림. 속도분과 지면 근접분을 더한다.
    maxSpeedShakeM: 0.12,
    groundShakeStartM: 14,
    maxGroundShakeM: 0.22,
    // 부착 순간의 짧은 충격.
    attachKickM: 0.45,
    attachKickDurationMs: 180,
    // 스쳐 지나가는 속도선. 숫자 말고 화면으로 속도를 알려 준다.
    speedLineCount: 90,
    speedLineRadiusRangeM: [3, 16] as [number, number],
    speedLineSpanM: 44,
    speedLineMaxOpacity: 0.5,
  },

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
    // 아래 값은 2026-09-16 반복 스윙 시뮬레이션으로 고른 제안값이고 실기기 체감 검증은 아직이다.
    // 줄 구속을 넣기 전에는 세로 당김이 48이었다. 중력의 5배라 궤적이 평탄해져(진폭 6m)
    // 스윙이 미끄러지는 느낌만 났다. 줄이 호를 만들게 하고 이 값은 낮게 날 때의 받침으로만 쓴다.
    assistForwardTargetSpeed: 30,
    assistForwardAccel: 24,
    assistLateralAccel: 4,
    assistVerticalAccel: 32,
    // 부착점까지 남은 전방 거리가 이 값 아래면 보조를 선형으로 줄인다.
    assistFadeDistanceM: 5,
    // 세로 당김은 낮게 날 때만 강하게 준다. 높이에 상관없이 주면 계속 붙잡고 있는 사람이
    // 건물 위로 솟아 플레이가 사라진다. 아래에서는 강하게 받쳐 지면 근접에서 회복할 수 있다.
    assistCeilingM: 52,
    assistCeilingFadeM: 22,
    // 앵커를 지난 뒤 전진 보조가 남는 시간. 0이면 진자가 뒤로 되말려 정점에서 전진이 음수가
    // 된다. 이 구간에는 전진 성분만 남기고 앵커 방향 당김은 끈다(당기면 뒤로 끌린다).
    assistTailSec: 1.2,
    // 줄 구속(2026-09-16 추가). 전방 보조만으로는 호를 그리지 않아 스윙 리듬이 없었다.
    // 부착 순간의 거리를 줄 길이로 잡고 누르는 동안 감아 들여, 줄이 팽팽해지면 바깥으로
    // 멀어지려는 속도를 잘라 앵커를 도는 호로 바꾼다. 아래 값은 자동 시뮬레이션으로 고른
    // 제안값이고 실기기 체감 검증은 아직이다.
    rope: {
      // 내려가는 동안 줄을 감아 들이는 속도. 줄이 빨리 팽팽해지고 호가 깊어진다(그네 구르기).
      reelSpeedMps: 16,
      // 건물에 처박히지 않도록 줄 길이의 하한을 둔다.
      minLengthM: 14,
      // 줄이 전진 속도를 이 아래로 깎지 못하게 한다. 진자는 전진을 높이로 바꾸므로(에너지
      // 보존) 이 바닥이 없으면 정점에서 전진이 음수가 되어 앵커를 감고 돈다.
      minForwardSpeedMps: 16,
      // 줄이 만들어 내는 상승 속도의 상한. 없으면 오래 붙잡은 사람이 고도 120m까지 솟아
      // 건물 위 빈 하늘에서 플레이가 끝난다. 22m/s면 놓는 지점에서 약 25m까지 더 오른다.
      maxRiseSpeedMps: 16,
      // 팽팽할 때 제거하는 바깥 방향 속도 비율(1이면 전혀 늘어나지 않는 줄).
      tautVelocityRemoval: 0.9,
      // 줄 길이를 넘어선 만큼 되돌리는 가속(m/s²/m)과 그 상한. 이 값이 크면 줄이 새총이 되어
      // 오래 붙잡은 사람을 건물 위로 쏘아 올린다(60에서 고도 176m를 봤다).
      restoringAccelPerM: 10,
      maxRestoringAccel: 20,
      // 폭 24m 협곡이라 진자를 그대로 두면 도로 밖으로 수백 m 밀려난다. 부착 중에는 좌우
      // 속도를 감쇠시키고 도로 중앙으로 되돌려, 호가 주로 위아래로 그려지게 한다.
      lateralDampingPerSec: 3,
      centeringAccelPerM: 2.5,
      maxCenteringAccel: 14,
    },
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
    // 줄이 저절로 풀렸을 때 '다시 누르세요' 안내를 띄우는 시간.
    rearmHintMs: 1600,
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
    // 도로변 줄 바깥을 채우는 배경 건물. 빈 보도 판이 지평선까지 보이던 것을 가린다.
    // 충돌체를 만들지 않으므로 거미줄은 통과한다(플레이 규칙은 도로변 줄까지 그대로다).
    backdropRows: 3,
    backdropRowGapM: 14,
    backdropHeightRangeM: [30, 85],
    backdropGapRangeM: [6, 16],
    startPositionZ: 0,
    // buildChunk 직접 호출 시 재현용 기본값. 실제 게임은 시작·재시작마다 새 seed를 사용한다.
    seed: 20260917,
    // 랜드마크 배치 제안값: 첫 120m 이후 약 240m 간격, 종류·좌우는 게임 seed로 결정.
    landmarkEveryChunks: 4,
    landmarkFirstChunk: 2,
    // 종류별 확대 배율. 애지헌 탑이 주변 건물(45~70m)에 묻혀 작아 보여 더 키웠다.
    // 대양AI센터는 바닥 폭이 48m라 구간 길이 60m를 넘지 않는 1.25가 상한이다.
    // 광개토관도 도로를 따라가는 폭이 48m라 상한이 1.25다. 높이 62m가 이미 주변 건물보다
    // 높아 배율은 1.2로 둔다.
    landmarkScale: { aejiheon: 1.6, 'daeyang-ai': 1.25, gwanggaeto: 1.2, naver: 1 },
  },

  // 점수·정체 (PRD 5절 제안 초기값)
  progress: {
    scorePerSecond: 10,
    // 지면 근접 보너스(2026-09-16 추가). 낮게 스치며 지나갈수록 점수가 빨리 오른다.
    // 위험을 감수할 이유를 만든다. 아래 값은 제안값이고 실기기 체감 검증은 아직이다.
    nearGroundHeightM: 12,
    nearGroundMinSpeedMs: 18,
    nearGroundBonusPerSecond: 40,
    stallResetDistanceM: 5,
    stallWarnSec: 5,
    stallEndSec: 8,
  },
} as const;
