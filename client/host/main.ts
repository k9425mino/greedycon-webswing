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
  anglesToDirection,
  clampAimAngles,
  directionToScreenRatio,
  relativeRotation,
  relativeRotationToAngles,
} from './aim';
import { nextPendingResume } from './resumeState';
import { RateCounter } from './diagnostics';
import {
  createChunkMeshes,
  createPlayerMesh,
  createRopeLine,
  createScene,
  updateCameraPosition,
  updateRopeLine,
} from './scene';
import { isMouseInputEnabled, MouseAimInput } from './mouseInput';
import { PhysicsWorld, type Vec3 } from './physics';
import { ChunkedWorld, chunkIndexForZ } from './world';
import { Progress } from './progress';
import { defaultSwingOptions, selectTarget, WebSwing } from './web';

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
const diagSensorHz = document.getElementById('diag-sensor-hz') as HTMLElement;
const diagSendHz = document.getElementById('diag-send-hz') as HTMLElement;
const diagRecvHz = document.getElementById('diag-recv-hz') as HTMLElement;
const btnCalibrate = document.getElementById('btn-calibrate') as HTMLButtonElement;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const btnSwitchPhone = document.getElementById('btn-switch-phone') as HTMLButtonElement;
const btnRestart = document.getElementById('btn-restart') as HTMLButtonElement;
const canvas = document.getElementById('scene') as HTMLCanvasElement;

const mouseMode = isMouseInputEnabled();
const sceneHandle = createScene(canvas);
const mouseInput = mouseMode ? new MouseAimInput(canvas, sceneHandle.camera) : null;

const RECOVERY_MESSAGES: Record<PauseReason, string> = {
  inputLost: '입력이 끊겼습니다. 터치를 뗀 뒤 재보정하세요.',
  hidden: '폰 화면이 전환되었습니다. 폰으로 돌아와 재보정하세요.',
  sensorUnavailable: '센서 신호가 없습니다. 폰의 센서 권한과 연결을 확인하세요.',
  fall: '추락으로 종료되었습니다.',
  stalled: '전진 정체로 종료되었습니다.',
  operator: '운영자가 중지했습니다.',
};

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
const sensorRate = new RateCounter();
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
const chunkMeshes = createChunkMeshes(sceneHandle.scene);
const progress = new Progress();

// 구간 생성·회수는 렌더 mesh와 물리 콜라이더를 같은 단위로 함께 붙였다 뗀다.
const world = new ChunkedWorld({
  onAdd: (chunk) => {
    chunkMeshes.add(chunk);
    physics?.addChunk(chunk.index, chunk.road, chunk.buildings);
  },
  onRemove: (chunkIndex) => {
    chunkMeshes.remove(chunkIndex);
    physics?.removeChunk(chunkIndex);
  },
});

// TODO: ARCHITECTURE 5절의 1,000m 좌표 재기준화는 아직 구현하지 않았다. 부착 중인 joint·앵커·보간
// 상태를 한 프레임에 함께 옮겨야 해 스윙 중 위험이 크고, 이 게임 길이(수 분)에서는 f32 해상도가 충분하다.
// 장시간 실행에서 좌표 정밀도 문제가 관측되면 구현한다.

PhysicsWorld.create()
  .then((created) => {
    physics = created;
    physics.createPlayer(world.startPosition);
    world.reset();
    progress.reset(world.startPosition[2]);
    swing = new WebSwing(physics, world.candidates, defaultSwingOptions());
    physicsReady = true;
    statusPhysics.textContent = '준비됨';
    refreshStatusText();
  })
  .catch((error) => {
    statusPhysics.textContent = '초기화 실패';
    console.error('Rapier 초기화 실패', error);
  });

function setPhase(next: GamePhase, nextReason?: PauseReason) {
  phase = next;
  reason = nextReason;
  statusPhase.textContent = phase;
  refreshStatusText();
  recoverySection.hidden = phase !== 'paused';
  gameOverSection.hidden = phase !== 'gameOver';
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

function directionTo(from: Vec3, to: Vec3): Vec3 {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return [dx / len, dy / len, dz / len];
}

// selectTarget과 동일한 후보·설정으로 부착 예정점을 미리 계산한다(발사 전 표적 표시).
function computePreviewTarget() {
  if (!physics || !swing || phase !== 'playing' || swing.phase !== 'idle') return null;
  const origin = physics.getPlayerPosition();
  return selectTarget(origin, currentAimDirection, world.candidates, physics, defaultSwingOptions());
}

// 조준점·표적 마커 모두 실제 발사 방향(currentAimDirection)을 카메라로 투영해 표시한다.
// 표시는 읽기 전용이며 실제 발사 방향(swing.update에 넘기는 값)을 바꾸지 않는다.
function updateCrosshair() {
  crosshair.dataset.pressed = String(pressed);

  const hasAim = mouseMode || (latestOrientation !== null && calibration.q0 !== null);
  if (!hasAim) {
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
    updateCrosshair();
  },
  onControllerStatus: (status: ControllerStatus) => {
    controllerStatus = status;
    sensorRate.tick();
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
  if (phase !== 'calibrating' || !latestOrientation || !inputReady()) return;
  if (calibration.calibrate(latestOrientation, pressed)) {
    goToReady();
  }
});

btnStart.addEventListener('click', () => goToPlaying());
btnStop.addEventListener('click', () => {
  if (phase === 'playing') goToPaused('operator');
});
btnSwitchPhone.addEventListener('click', () => {
  hostSocket.requestReplaceController();
  goToPairing();
});
btnRestart.addEventListener('click', () => {
  if (phase !== 'gameOver' || !physics || !swing) return;
  physics.detach();
  resetRun();
  physics.setPlayerVelocity([0, 0, 0]);
  swing.reset(pressed);
  attachedPoint = null;
  pendingResume = false;
  goToReady();
});

// --- 물리·조준·거미줄 프레임 루프 (고정 60Hz 물리 + 보간 렌더링, ARCHITECTURE 5절) ---
function computeAimDirection(): Vec3 {
  if (mouseMode && mouseInput) {
    pressed = mouseInput.current.pressed;
    return mouseInput.current.direction;
  }
  if (!latestOrientation || !calibration.q0) return currentAimDirection;
  const relative = relativeRotation(latestOrientation, calibration.q0);
  const angles = clampAimAngles(relativeRotationToAngles(relative));
  return anglesToDirection(angles);
}

function stepPhysicsFixed(nowSec: number) {
  if (!physics || !swing) return;
  const origin = physics.getPlayerPosition();
  swing.update(pressed, nowSec, origin, currentAimDirection, {
    onAttach: (target) => {
      if (!physics) return;
      const dx = target.point[0] - origin[0];
      const dy = target.point[1] - origin[1];
      const dz = target.point[2] - origin[2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      physics.attach(target.point, target.distance);
      physics.applyVelocityDelta([
        (dx / len) * gameConfig.physics.attachPullSpeed,
        (dy / len) * gameConfig.physics.attachPullSpeed,
        (dz / len) * gameConfig.physics.attachPullSpeed,
      ]);
      attachedPoint = target.point;
    },
    onRelease: () => {
      physics?.detach();
      attachedPoint = null;
    },
  });
  physics.step();
  if (physics.didTouchGroundThisStep()) {
    physics.detach();
    attachedPoint = null;
    goToGameOver('fall');
    return;
  }

  // 점수·정체는 실제 수행한 물리 step으로만 증가한다(ARCHITECTURE 5절).
  progress.step(gameConfig.physics.fixedTimestepSec, physics.getPlayerPosition()[2]);
  if (progress.stallState === 'ended') {
    physics.detach();
    attachedPoint = null;
    goToGameOver('stalled');
  }
}

function updateHud() {
  hudScore.textContent = String(progress.score);
  if (physics) {
    const [vx, vy, vz] = physics.getPlayerVelocity();
    hudSpeed.textContent = `${Math.round(Math.sqrt(vx * vx + vy * vy + vz * vz))} m/s`;
  }
  const warning = phase === 'playing' && progress.stallState === 'warning';
  hudStall.hidden = !warning;
  if (warning) hudStallLeft.textContent = progress.stallSecondsLeft.toFixed(1);
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

  updateHud();

  if (physics) {
    const alpha =
      phase === 'playing' ? physicsAccumulatorSec / gameConfig.physics.fixedTimestepSec : 1;
    const renderPos = physics.interpolatedPosition(Math.min(1, Math.max(0, alpha)));
    playerMesh.position.set(...renderPos);
    updateCameraPosition(sceneHandle.camera, renderPos);
    updateRopeLine(ropeLine, renderPos, attachedPoint);
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
