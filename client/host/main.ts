import type {
  ControllerStatus,
  GamePhase,
  HostState,
  InputFrame,
  PauseReason,
  Quaternion,
} from '@shared/types';
import {
  acceptSeq,
  createSeqTracker,
  isValidInputFrameShape,
  normalizeQuaternion,
} from '@shared/inputValidation';
import { gameConfig } from '@shared/config';
import { HostSocket } from './socket';
import { buildControllerUrl, renderQr } from './qr';
import { Calibration } from './calibration';
import {
  aimAnglesFromOrientation,
  anglesToDirection,
  clampAimAngles,
  directionToScreenRatio,
} from './aim';
import { nextPendingResume } from './resumeState';
import { RateCounter } from './diagnostics';
import {
  createAttachFlash,
  createChunkMeshes,
  createFireBeamLine,
  createPlayerMesh,
  createRopeLine,
  createScene,
  showAttachFlashAt,
  updateAttachFlash,
  updateCameraPosition,
  updateFireBeamLine,
  updateRopeLine,
} from './scene';
import { isMouseInputEnabled, MouseAimInput } from './mouseInput';
import { PhysicsWorld, type Vec3 } from './physics';
import { ChunkedWorld, chunkIndexForZ, chunkBuildingColliders } from './world';
import { Progress } from './progress';
import {
  defaultSwingOptions,
  selectTarget,
  WebSwing,
  type FireFailure,
  type TargetHit,
} from './web';
import { SfxPlayer } from './audio';

const qrImage = document.getElementById('qr-image') as HTMLImageElement;
const inviteLink = document.getElementById('invite-link') as HTMLAnchorElement;
const statusConnection = document.getElementById('status-connection') as HTMLElement;
const statusSensor = document.getElementById('status-sensor') as HTMLElement;
const statusTouch = document.getElementById('status-touch') as HTMLElement;
const statusPhase = document.getElementById('status-phase') as HTMLElement;
const statusPhysics = document.getElementById('status-physics') as HTMLElement;
const crosshair = document.getElementById('crosshair') as HTMLElement;
const targetMarker = document.getElementById('target-marker') as HTMLElement;
const recoverySection = document.getElementById('recovery-section') as HTMLElement;
const recoveryMessage = document.getElementById('recovery-message') as HTMLElement;
const gameOverSection = document.getElementById('gameover-section') as HTMLElement;
const gameOverReason = document.getElementById('gameover-reason') as HTMLElement;
const gameOverScore = document.getElementById('gameover-score') as HTMLElement;
const hudScore = document.getElementById('hud-score') as HTMLElement;
const hudSpeed = document.getElementById('hud-speed') as HTMLElement;
const hudStall = document.getElementById('hud-stall') as HTMLElement;
const hudStallLeft = document.getElementById('hud-stall-left') as HTMLElement;
const hudWebStatus = document.getElementById('hud-web-status') as HTMLElement;
const diagAim = document.getElementById('diag-aim') as HTMLElement;
const diagTarget = document.getElementById('diag-target') as HTMLElement;
const diagWebPhase = document.getElementById('diag-web-phase') as HTMLElement;
const diagWebFailure = document.getElementById('diag-web-failure') as HTMLElement;
const diagAttach = document.getElementById('diag-attach') as HTMLElement;
const diagSensorHz = document.getElementById('diag-sensor-hz') as HTMLElement;
const diagSendHz = document.getElementById('diag-send-hz') as HTMLElement;
const diagRecvHz = document.getElementById('diag-recv-hz') as HTMLElement;
const btnCalibrate = document.getElementById('btn-calibrate') as HTMLButtonElement;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const btnMute = document.getElementById('btn-mute') as HTMLButtonElement;
const btnSwitchPhone = document.getElementById('btn-switch-phone') as HTMLButtonElement;
const btnRestart = document.getElementById('btn-restart') as HTMLButtonElement;
const guideMessage = document.getElementById('guide-message') as HTMLElement;
const canvas = document.getElementById('scene') as HTMLCanvasElement;

const mouseMode = isMouseInputEnabled();
const sceneHandle = createScene(canvas);
const mouseInput = mouseMode ? new MouseAimInput(canvas, sceneHandle.camera) : null;

const RECOVERY_MESSAGES: Record<PauseReason, string> = {
  inputLost: '입력이 끊겼습니다. 터치를 뗀 뒤 재보정하세요.',
  hidden: '폰 화면이 전환되었습니다. 폰으로 돌아와 재보정하세요.',
  sensorUnavailable: '센서 신호가 없습니다. 폰의 센서 권한과 연결을 확인하세요.',
  fall: '추락으로 종료되었습니다.',
  outOfBounds: '도로 밖으로 벗어나 종료했습니다.',
  stalled: '전진 정체로 종료되었습니다.',
  operator: '운영자가 중지했습니다.',
};

// 발사가 부착으로 이어지지 못한 이유. 실기기에서 어느 판정이 걸렀는지 구분하기 위한 진단 문구다.
const FIRE_FAILURE_MESSAGES: Record<FireFailure, string> = {
  noTarget: '표적 없음',
  releasedWhileFiring: '발사 도중 해제',
};

// 화면 단계별로 다음에 할 일을 안내한다(pairing/calibrating/ready/playing). paused·gameOver는
// recovery-section·gameover-section이 각각 안내하므로 guide-section은 숨긴다.
function guideMessageFor(currentPhase: GamePhase): string | null {
  switch (currentPhase) {
    case 'pairing':
      return '폰으로 QR을 스캔해 접속하세요.';
    case 'calibrating':
      return '정면을 보고 화면에서 손가락을 뗀 뒤 "정면 보정"을 눌러주세요.';
    case 'ready':
      return '손목에 폰을 고정했다면 "게임 시작"을 눌러주세요.';
    case 'playing':
      return mouseMode
        ? '건물 위쪽을 겨누고 마우스 왼쪽 버튼을 눌러 거미줄을 발사하세요.'
        : '건물 위쪽을 겨누고 화면을 눌러 거미줄을 발사하세요. 손을 떼면 날아갑니다.';
    default:
      return null;
  }
}

let phase: GamePhase = 'pairing';
let reason: PauseReason | undefined;
let controllerConnected = false;
let controllerStatus: ControllerStatus | null = null;
let latestOrientation: Quaternion | null = null;
let pressed = false;
let lastInputAt: number | null = null;
let pendingResume = false;
let physicsReady = false;

const calibration = new Calibration();
const seqTracker = createSeqTracker();
const recvRate = new RateCounter();

// --- 물리·월드·거미줄 (무한 도로, ARCHITECTURE 5절) ---
let physics: PhysicsWorld | null = null;
let swing: WebSwing | null = null;
let attachedPoint: Vec3 | null = null;
let currentAimDirection: Vec3 = [0, 0, -1];
let physicsAccumulatorSec = 0;
let lastFrameAt: number | null = null;

const playerMesh = createPlayerMesh(sceneHandle.scene);
const ropeLine = createRopeLine(sceneHandle.scene);
const fireBeamLine = createFireBeamLine(sceneHandle.scene);
const attachFlash = createAttachFlash(sceneHandle.scene);
const chunkMeshes = createChunkMeshes(sceneHandle.scene);
const progress = new Progress();
const sfx = new SfxPlayer();

// 표적 미리보기와 실제 발사가 같은 설정을 쓰도록 한 번만 만들어 공유한다.
const swingOptions = defaultSwingOptions();

// 부착 순간에만 한 번 재생하는 짧은 원형 플래시(중복 방지: attachFlashStartMs로 진행 중 여부 판단).
let attachFlashStartMs: number | null = null;

// 걸리지 못한 거미줄. 최대 사거리에서 끊긴 뒤에도 같은 방향으로 계속 날아가며 흐려진다.
let missBeam: { point: Vec3; direction: Vec3; startedAtMs: number } | null = null;

// 조준점 갱신에서 계산한 부착 예정점. 표시와 진단이 같은 값을 쓰도록 보관한다.
let previewTarget: TargetHit | null = null;

// 구간 생성·회수는 렌더 mesh와 물리 콜라이더를 같은 단위로 함께 붙였다 뗀다.
const world = new ChunkedWorld({
  onAdd: (chunk) => {
    chunkMeshes.add(chunk);
    physics?.addChunk(chunk.index, chunk.road, chunkBuildingColliders(chunk));
  },
  onRemove: (chunkIndex) => {
    chunkMeshes.remove(chunkIndex);
    physics?.removeChunk(chunkIndex);
  },
});

// TODO: ARCHITECTURE 5절의 1,000m 좌표 재기준화는 아직 구현하지 않았다. 부착 중인 앵커·줄 길이·보간
// 상태를 한 프레임에 함께 옮겨야 해 스윙 중 위험이 크고, 이 게임 길이(수 분)에서는 f32 해상도가 충분하다.
// 장시간 실행에서 좌표 정밀도 문제가 관측되면 구현한다.

PhysicsWorld.create()
  .then((created) => {
    physics = created;
    physics.createPlayer(world.startPosition);
    world.reset();
    progress.reset(world.startPosition[2]);
    swing = new WebSwing(physics, swingOptions);
    physicsReady = true;
    statusPhysics.textContent = '준비됨';
    refreshStatusText();
  })
  .catch((error) => {
    statusPhysics.textContent = '초기화 실패';
    console.error('Rapier 초기화 실패', error);
  });

function setPhase(next: GamePhase, nextReason?: PauseReason) {
  if (next !== 'playing') {
    sfx.stopAll();
    fireBeamLine.visible = false;
    attachFlash.visible = false;
    attachFlashStartMs = null;
    missBeam = null;
  }
  phase = next;
  reason = nextReason;
  statusPhase.textContent = phase;
  refreshStatusText();
  recoverySection.hidden = phase !== 'paused';
  gameOverSection.hidden = phase !== 'gameOver';
  const guide = guideMessageFor(phase);
  guideMessage.textContent = guide ?? '';
  (guideMessage.parentElement as HTMLElement).hidden = guide === null;
  if (phase === 'paused' && reason) {
    recoveryMessage.textContent = RECOVERY_MESSAGES[reason] ?? '';
  }
  if (phase === 'gameOver' && reason) {
    gameOverReason.textContent = RECOVERY_MESSAGES[reason] ?? '';
    gameOverScore.textContent = String(progress.score);
  }
  sendHostState();
}

function sendHostState() {
  const state: HostState = { phase, calibrated: calibration.calibrated, reason };
  hostSocket.sendHostState(state);
}

function goToPairing() {
  calibration.reset();
  seqTracker.lastSeq = null;
  setPhase('pairing');
}

function goToCalibrating() {
  calibration.reset();
  setPhase('calibrating');
}

function goToReady() {
  setPhase('ready');
}

// 새 게임 준비: 위치·월드 구간·점수·정체 타이머를 모두 초기화한다(GM-07). 재개에서는 호출하지 않는다.
function resetRun() {
  if (!physics) return;
  physics.setPlayerPosition(world.startPosition);
  world.reset();
  progress.reset(world.startPosition[2]);
}

function goToPlaying() {
  if (!canStartPlaying()) return;
  if (!physics || !swing) return;
  physics.detach();
  attachedPoint = null;
  swing.reset(pressed);
  if (!pendingResume) {
    resetRun();
    physics.setPlayerVelocity([0, 0, -gameConfig.physics.forwardSpeed]);
  }
  pendingResume = false;
  physicsAccumulatorSec = 0;
  setPhase('playing');
  sfx.startWind();
}

function goToPaused(pauseReason: PauseReason) {
  pendingResume = nextPendingResume(pendingResume, phase);
  calibration.reset();
  setPhase('paused', pauseReason);
}

function goToGameOver(pauseReason: PauseReason) {
  pendingResume = false;
  setPhase('gameOver', pauseReason);
}

// 종료 경로가 줄 해제를 빠뜨리지 않도록 한곳에 모은다.
function endRun(endReason: PauseReason) {
  physics?.detach();
  attachedPoint = null;
  goToGameOver(endReason);
}

function maybeRecover() {
  if (phase !== 'paused') return;
  if (mouseMode) return;
  const connected = controllerConnected;
  const sensorOk = controllerStatus?.sensorAvailable ?? false;
  const visible = controllerStatus?.pageVisible ?? false;
  if (connected && sensorOk && visible && inputReady()) {
    goToCalibrating();
  }
}

function inputReady(): boolean {
  if (mouseMode) return true;
  return (
    controllerConnected &&
    controllerStatus?.sensorAvailable === true &&
    controllerStatus.pageVisible &&
    !document.hidden &&
    lastInputAt !== null &&
    performance.now() - lastInputAt <= gameConfig.inputLostTimeoutMs
  );
}

function canStartPlaying(): boolean {
  return (
    (phase === 'ready' || (mouseMode && phase === 'paused')) &&
    inputReady() &&
    !pressed &&
    physicsReady
  );
}

function clearInput() {
  seqTracker.lastSeq = null;
  latestOrientation = null;
  lastInputAt = null;
  controllerStatus = null;
  pressed = false;
  updateCrosshair();
}

function refreshStatusText() {
  btnCalibrate.disabled = mouseMode || phase !== 'calibrating' || !inputReady() || pressed;
  btnStart.disabled = !canStartPlaying();
  btnSwitchPhone.disabled = mouseMode;
  statusConnection.textContent = mouseMode
    ? '마우스 입력'
    : controllerConnected
      ? '연결됨'
      : '대기중';
  statusSensor.textContent = controllerStatus?.sensorAvailable ? '정상' : '없음';
  statusTouch.textContent = pressed ? '누름' : '해제';
  diagSensorHz.textContent = String(controllerStatus?.sensorHz ?? 0);
  diagSendHz.textContent = String(controllerStatus?.sendHz ?? 0);
  diagRecvHz.textContent = String(recvRate.hz());
}

function magnitude(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function directionTo(from: Vec3, to: Vec3): Vec3 {
  const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len = magnitude(delta) || 1;
  return [delta[0] / len, delta[1] / len, delta[2] / len];
}

// selectTarget과 동일한 후보·설정으로 부착 예정점을 미리 계산한다(발사 전 표적 표시).
function computePreviewTarget() {
  if (!physics || !swing || phase !== 'playing' || swing.phase !== 'idle') return null;
  const origin = physics.getPlayerPosition();
  return selectTarget(origin, currentAimDirection, physics, swingOptions);
}

// 조준점·표적 마커 모두 실제 발사 방향(currentAimDirection)을 카메라로 투영해 표시한다.
// 표시는 읽기 전용이며 실제 발사 방향(swing.update에 넘기는 값)을 바꾸지 않는다.
function updateCrosshair() {
  crosshair.dataset.pressed = String(pressed);

  const hasAim = mouseMode || (latestOrientation !== null && calibration.q0 !== null);
  if (!hasAim) {
    previewTarget = null;
    crosshair.dataset.hasTarget = 'false';
    crosshair.dataset.onscreen = 'true';
    targetMarker.hidden = true;
    return;
  }

  const projection = directionToScreenRatio(currentAimDirection, sceneHandle.camera);
  crosshair.style.left = `${projection.x * 100}%`;
  crosshair.style.top = `${projection.y * 100}%`;
  crosshair.dataset.onscreen = String(projection.onScreen);

  const target = computePreviewTarget();
  previewTarget = target;
  crosshair.dataset.hasTarget = String(target !== null);
  if (target && physics) {
    const toTarget = directionTo(physics.getPlayerPosition(), target.point);
    const targetProjection = directionToScreenRatio(toTarget, sceneHandle.camera);
    targetMarker.hidden = !targetProjection.onScreen;
    targetMarker.style.left = `${targetProjection.x * 100}%`;
    targetMarker.style.top = `${targetProjection.y * 100}%`;
  } else {
    targetMarker.hidden = true;
  }
}

const hostSocket = new HostSocket({
  onReconnect: () => {
    void init();
  },
  onInput: (frame: InputFrame) => {
    if (!isValidInputFrameShape(frame)) return;
    if (!acceptSeq(seqTracker, frame.seq)) return;
    latestOrientation = normalizeQuaternion(frame.orientation);
    pressed = frame.pressed;
    lastInputAt = performance.now();
    recvRate.tick();
    maybeRecover();
    refreshStatusText();
  },
  onControllerStatus: (status: ControllerStatus) => {
    controllerStatus = status;
    if (phase === 'playing' && !status.sensorAvailable) {
      goToPaused('sensorUnavailable');
    } else if (phase === 'ready' && (!status.sensorAvailable || !status.pageVisible)) {
      goToCalibrating();
    } else if (phase === 'playing' && !status.pageVisible) {
      goToPaused('hidden');
    }
    maybeRecover();
    refreshStatusText();
  },
  onSessionStatus: (status) => {
    if (mouseMode) return;
    const wasConnected = controllerConnected;
    controllerConnected = status.controllerConnected;
    if (!controllerConnected && wasConnected) {
      clearInput();
      if (phase === 'playing') {
        goToPaused('inputLost');
      } else {
        goToPairing();
      }
    } else if (controllerConnected && !wasConnected) {
      clearInput();
      goToCalibrating();
    }
    refreshStatusText();
  },
});

setInterval(() => {
  refreshStatusText();
  if (mouseMode) return;
  if (
    (phase === 'playing' || phase === 'ready') &&
    lastInputAt !== null &&
    performance.now() - lastInputAt > gameConfig.inputLostTimeoutMs
  ) {
    goToPaused('inputLost');
  }
}, 100);

document.addEventListener('visibilitychange', () => {
  if (mouseMode) return;
  if (document.hidden && (phase === 'playing' || phase === 'ready')) {
    goToPaused('hidden');
  }
});

btnCalibrate.addEventListener('click', () => {
  sfx.resume();
  if (phase !== 'calibrating' || !latestOrientation || !inputReady()) return;
  if (calibration.calibrate(latestOrientation, pressed)) {
    goToReady();
  }
});

btnStart.addEventListener('click', () => {
  sfx.resume();
  goToPlaying();
});
btnStop.addEventListener('click', () => {
  if (phase === 'playing') goToPaused('operator');
});
btnSwitchPhone.addEventListener('click', () => {
  hostSocket.requestReplaceController();
  goToPairing();
});
btnRestart.addEventListener('click', () => {
  sfx.resume();
  if (phase !== 'gameOver' || !physics || !swing) return;
  physics.detach();
  resetRun();
  physics.setPlayerVelocity([0, 0, 0]);
  swing.reset(pressed);
  attachedPoint = null;
  pendingResume = false;
  goToReady();
});
btnMute.addEventListener('click', () => {
  sfx.resume();
  sfx.setMuted(!sfx.isMuted);
  btnMute.textContent = sfx.isMuted ? '소리 켜기' : '소리 끄기';
});
if (mouseMode) {
  canvas.addEventListener('mousedown', () => sfx.resume());
}

// --- 물리·조준·거미줄 프레임 루프 (고정 60Hz 물리 + 보간 렌더링, ARCHITECTURE 5절) ---
function computeAimDirection(): Vec3 {
  if (mouseMode && mouseInput) {
    pressed = mouseInput.current.pressed;
    return mouseInput.current.direction;
  }
  if (!latestOrientation || !calibration.q0) return currentAimDirection;
  const angles = clampAimAngles(aimAnglesFromOrientation(latestOrientation, calibration.q0));
  return anglesToDirection(angles);
}

function stepPhysicsFixed(nowSec: number) {
  if (!physics || !swing) return;
  const origin = physics.getPlayerPosition();
  swing.update(pressed, nowSec, origin, currentAimDirection, {
    onFireStart: () => {
      missBeam = null;
      sfx.playFire();
    },
    onFireMiss: (tip, direction) => {
      missBeam = { point: tip, direction, startedAtMs: nowSec * 1000 };
      sfx.playMiss();
    },
    onAttach: (target) => {
      if (!physics) return;
      physics.attach(target.point);
      attachedPoint = target.point;
      sfx.playAttach();
      showAttachFlashAt(attachFlash, target.point);
      attachFlashStartMs = nowSec * 1000;
    },
    onRelease: () => {
      physics?.detach();
      attachedPoint = null;
      sfx.playRelease();
    },
  });
  physics.step();
  const outsideRoad = physics.isOutsideRoad();
  if (physics.didTouchGroundThisStep() || outsideRoad) {
    endRun(outsideRoad ? 'outOfBounds' : 'fall');
    return;
  }

  // 점수·정체는 실제 수행한 물리 step으로만 증가한다(ARCHITECTURE 5절).
  progress.step(gameConfig.physics.fixedTimestepSec, physics.getPlayerPosition()[2]);
  if (progress.stallState === 'ended') endRun('stalled');
}

function updateHud(speedMs: number | null) {
  hudScore.textContent = String(progress.score);
  if (speedMs !== null) hudSpeed.textContent = `${Math.round(speedMs)} m/s`;
  const warning = phase === 'playing' && progress.stallState === 'warning';
  hudStall.hidden = !warning;
  if (warning) hudStallLeft.textContent = progress.stallSecondsLeft.toFixed(1);
}

// 화면 위 발사 상태 표시. '부착됨'은 실제 물리 부착에서만 켜서 빗나감 연출과 혼동하지 않게 한다.
const WEB_STATUS_MESSAGES = {
  firing: '발사 중',
  attached: '부착됨',
  missed: '빗나감',
} as const;

// 조준각은 실제 발사에 쓰는 방향에서 그대로 되돌려 계산하므로 표시와 발사가 어긋나지 않는다.
// 표적·거미줄·부착 항목은 playing 동안만 갱신해 종료 화면에 마지막 발사 결과가 남는다.
function updateDiagnostics() {
  const [dx, dy, dz] = currentAimDirection;
  const yawDeg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const pitchDeg = (Math.asin(Math.max(-1, Math.min(1, dy))) * 180) / Math.PI;
  diagAim.textContent = `좌우 ${yawDeg.toFixed(1)}° / 상하 ${pitchDeg.toFixed(1)}°`;

  const state =
    phase !== 'playing' || !swing
      ? null
      : physics?.isAttached
        ? 'attached'
        : swing.phase === 'firing'
          ? 'firing'
          : swing.phase === 'releasedRequired'
            ? 'missed'
            : null;
  hudWebStatus.hidden = state === null;
  if (state !== null) {
    hudWebStatus.dataset.state = state;
    hudWebStatus.textContent = WEB_STATUS_MESSAGES[state];
  }

  if (phase !== 'playing' || !swing) return;
  // 발사 직전(idle)의 표적 유무를 남겨, 눌렀을 때 표적이 있었는지 사후에 확인할 수 있게 한다.
  if (swing.phase === 'idle') {
    diagTarget.textContent = previewTarget
      ? `있음 (${previewTarget.distance.toFixed(1)}m)`
      : '없음';
  }
  diagWebPhase.textContent = swing.phase;
  diagWebFailure.textContent = swing.lastFailure
    ? FIRE_FAILURE_MESSAGES[swing.lastFailure]
    : '없음';
  const attachment = physics?.attachment ?? null;
  diagAttach.textContent = attachment
    ? `부착 (앵커까지 ${attachment.distance.toFixed(1)}m / 보조 ${attachment.assisting ? '중' : '종료'})`
    : '없음';
}

function frameLoop(nowMs: number) {
  requestAnimationFrame(frameLoop);
  if (lastFrameAt === null) lastFrameAt = nowMs;
  const dtSec = Math.min((nowMs - lastFrameAt) / 1000, 0.25);
  lastFrameAt = nowMs;

  currentAimDirection = computeAimDirection();
  updateCrosshair();

  if (phase === 'playing' && physics) {
    const fixedDt = gameConfig.physics.fixedTimestepSec;
    physicsAccumulatorSec += dtSec;
    let steps = 0;
    while (
      physicsAccumulatorSec >= fixedDt &&
      steps < gameConfig.physics.maxStepsPerFrame &&
      (phase as GamePhase) === 'playing'
    ) {
      stepPhysicsFixed(nowMs / 1000);
      physicsAccumulatorSec -= fixedDt;
      steps += 1;
    }
    if (steps === gameConfig.physics.maxStepsPerFrame) physicsAccumulatorSec = 0;
  }

  if (physics && physicsReady) {
    // 부착 중인 앵커가 속한 구간은 회수하지 않는다.
    const attachedChunkIndex = attachedPoint === null ? null : chunkIndexForZ(attachedPoint[2]);
    world.update(physics.getPlayerPosition()[2], attachedChunkIndex);
  }

  const playerSpeed = physics ? magnitude(physics.getPlayerVelocity()) : null;
  updateHud(playerSpeed);
  updateDiagnostics();

  if (physics) {
    const alpha =
      phase === 'playing' ? physicsAccumulatorSec / gameConfig.physics.fixedTimestepSec : 1;
    const renderPos = physics.interpolatedPosition(Math.min(1, Math.max(0, alpha)));
    playerMesh.position.set(...renderPos);
    updateCameraPosition(sceneHandle.camera, renderPos);
    updateRopeLine(ropeLine, renderPos, attachedPoint);

    // 뻗어나가는 줄과 빗나감 연출은 같은 선을 공유한다.
    const firingTip = phase === 'playing' ? (swing?.tipPoint ?? null) : null;
    if (firingTip) {
      const pulse = 0.6 + 0.4 * Math.sin(nowMs * gameConfig.effects.firePulsePerMs);
      updateFireBeamLine(fireBeamLine, renderPos, firingTip, pulse);
    } else if (missBeam) {
      // 걸리지 못한 줄은 같은 속도로 계속 날아가며 흐려진다.
      const elapsedMs = nowMs - missBeam.startedAtMs;
      const fadeProgress = elapsedMs / gameConfig.effects.missBeamDurationMs;
      if (fadeProgress >= 1) missBeam = null;
      const flownM = (elapsedMs / 1000) * gameConfig.web.travelSpeedMps;
      const tip: Vec3 | null = missBeam
        ? [
            missBeam.point[0] + missBeam.direction[0] * flownM,
            missBeam.point[1] + missBeam.direction[1] * flownM,
            missBeam.point[2] + missBeam.direction[2] * flownM,
          ]
        : null;
      updateFireBeamLine(fireBeamLine, renderPos, tip, Math.max(0, 1 - fadeProgress));
    } else {
      updateFireBeamLine(fireBeamLine, renderPos, null, 0);
    }

    if (attachFlashStartMs !== null) {
      const elapsed = nowMs - attachFlashStartMs;
      if (elapsed >= gameConfig.effects.attachFlashDurationMs) {
        attachFlash.visible = false;
        attachFlashStartMs = null;
      } else {
        updateAttachFlash(attachFlash, elapsed / gameConfig.effects.attachFlashDurationMs);
      }
    }

    if (phase === 'playing' && playerSpeed !== null) sfx.updateWind(playerSpeed);
  }

  sceneHandle.render();
}
requestAnimationFrame(frameLoop);

async function init() {
  if (mouseMode) {
    goToReady();
    return;
  }
  const session = await hostSocket.startOrResume();
  const controllerUrl = buildControllerUrl(session.inviteToken);
  inviteLink.href = controllerUrl;
  inviteLink.textContent = controllerUrl;
  await renderQr(qrImage, controllerUrl);
  if (!controllerConnected) setPhase('pairing');
}

init();
