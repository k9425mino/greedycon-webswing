import { gameConfig } from '@shared/config';

// 카메라가 완전히 고정되어 있어 속도가 올라도 화면이 그대로였다. 시야각·기울기·흔들림으로
// 속도와 스윙 방향을 화면에 남긴다. 조준은 폰이 하므로 바라보는 방향(-Z)은 건드리지 않는다.
export type CameraFeelState = {
  fovDeg: number;
  rollRad: number;
  shakeM: [number, number];
};

export type CameraFeelInput = {
  speedMs: number;
  // 줄이 걸린 지점의 좌우 오프셋. 부착 중이 아니면 null이고 기울기가 풀린다.
  anchorOffsetM: number | null;
  altitudeM: number;
  // 부착 순간부터의 경과 시간. 짧은 충격을 한 번 준다.
  attachElapsedMs: number | null;
  nowMs: number;
  dtSec: number;
};

// 속도를 0~1로 옮긴다. 시야각·속도선·흔들림이 같은 기준을 쓴다.
export function speedRatioFor(speedMs: number): number {
  const [slowMs, fastMs] = gameConfig.camera.fovSpeedRangeMs;
  return Math.max(0, Math.min(1, (speedMs - slowMs) / (fastMs - slowMs)));
}

// 지면에 얼마나 가까운지를 0~1로 옮긴다. 지면 근접 흔들림의 세기 기준이다.
function groundNearness(altitudeM: number): number {
  const { groundShakeStartM } = gameConfig.camera;
  return Math.max(0, Math.min(1, (groundShakeStartM - altitudeM) / groundShakeStartM));
}

// 지수 감쇠 보간. dt가 흔들려도 같은 속도로 수렴한다.
function approach(current: number, target: number, perSec: number, dtSec: number): number {
  return current + (target - current) * Math.min(1, perSec * dtSec);
}

export function initialCameraFeel(): CameraFeelState {
  return { fovDeg: gameConfig.cameraVerticalFovDeg, rollRad: 0, shakeM: [0, 0] };
}

// 흔들림은 주기가 다른 사인 두 개를 겹쳐 만든다. 난수를 쓰지 않아 프레임마다 재현된다.
function shakeOffset(nowMs: number, amplitudeM: number): [number, number] {
  const t = nowMs / 1000;
  return [
    amplitudeM * (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 19.7) * 0.4),
    amplitudeM * (Math.sin(t * 43.3) * 0.6 + Math.sin(t * 23.9) * 0.4),
  ];
}

export function updateCameraFeel(state: CameraFeelState, input: CameraFeelInput): CameraFeelState {
  const camera = gameConfig.camera;
  const speedRatio = speedRatioFor(input.speedMs);
  const targetFov =
    gameConfig.cameraVerticalFovDeg +
    (camera.maxFovDeg - gameConfig.cameraVerticalFovDeg) * speedRatio;

  // 줄이 걸린 쪽으로 기운다. 줄 구속이 좌우를 거의 만들지 않으므로 속도가 아니라 앵커의
  // 방향을 쓴다. 놓으면 오프셋이 사라져 기울기가 천천히 풀린다.
  const rollRatio = Math.max(
    -1,
    Math.min(1, (input.anchorOffsetM ?? 0) / camera.rollAnchorOffsetM),
  );
  const targetRoll = (rollRatio * camera.maxRollDeg * Math.PI) / 180;

  // 빠를수록, 지면에 가까울수록 크게 흔들린다. 지면 근접은 아슬아슬함을 몸으로 알려 준다.
  const speedShake = camera.maxSpeedShakeM * speedRatio;
  const groundShake = camera.maxGroundShakeM * groundNearness(input.altitudeM);
  const kick =
    input.attachElapsedMs === null || input.attachElapsedMs > camera.attachKickDurationMs
      ? 0
      : camera.attachKickM * (1 - input.attachElapsedMs / camera.attachKickDurationMs);

  return {
    fovDeg: approach(state.fovDeg, targetFov, camera.fovSmoothingPerSec, input.dtSec),
    rollRad: approach(state.rollRad, targetRoll, camera.rollSmoothingPerSec, input.dtSec),
    shakeM: shakeOffset(input.nowMs, speedShake + groundShake + kick),
  };
}
