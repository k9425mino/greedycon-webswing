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
  anglesToScreenRatio,
  clampAimAngles,
  relativeRotation,
  relativeRotationToAngles,
} from './aim';
import { RateCounter } from './diagnostics';
import {
  addPracticeWorldMeshes,
  createPlayerMesh,
  createRopeLine,
  createScene,
  updateCameraPosition,
  updateRopeLine,
} from './scene';
import { isMouseInputEnabled, MouseAimInput } from './mouseInput';
import { PhysicsWorld, type Vec3 } from './physics';
import { createPracticeWorld } from './world';
import { defaultSwingOptions, WebSwing } from './web';

const qrImage = document.getElementById('qr-image') as HTMLImageElement;
const inviteLink = document.getElementById('invite-link') as HTMLAnchorElement;
const statusConnection = document.getElementById('status-connection') as HTMLElement;
const statusSensor = document.getElementById('status-sensor') as HTMLElement;
const statusTouch = document.getElementById('status-touch') as HTMLElement;
const statusPhase = document.getElementById('status-phase') as HTMLElement;
const statusPhysics = document.getElementById('status-physics') as HTMLElement;
const crosshair = document.getElementById('crosshair') as HTMLElement;
const recoverySection = document.getElementById('recovery-section') as HTMLElement;
const recoveryMessage = document.getElementById('recovery-message') as HTMLElement;
const gameOverSection = document.getElementById('gameover-section') as HTMLElement;
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

// --- 물리·월드·거미줄 (고정 연습 구간, ARCHITECTURE 5절) ---
const world = createPracticeWorld();
let physics: PhysicsWorld | null = null;
let swing: WebSwing | null = null;
let attachedPoint: Vec3 | null = null;
let currentAimDirection: Vec3 = [0, 0, -1];
let physicsAccumulatorSec = 0;
let lastFrameAt: number | null = null;

const playerMesh = createPlayerMesh(sceneHandle.scene);
const ropeLine = createRopeLine(sceneHandle.scene);
addPracticeWorldMeshes(sceneHandle.scene, world);

PhysicsWorld.create()
  .then((created) => {
    physics = created;
    physics.createGround(world.roadWidth, world.roadLengthZ, world.roadCenterZ);
    physics.createBuildings(world.buildings);
    physics.createPlayer(world.startPosition);
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

function goToPlaying() {
  if (!canStartPlaying()) return;
  if (!physics || !swing) return;
  physics.detach();
  attachedPoint = null;
  swing.reset(pressed);
  if (!pendingResume) {
    physics.setPlayerPosition(world.startPosition);
    physics.setPlayerVelocity([0, 0, -gameConfig.physics.forwardSpeed]);
  }
  pendingResume = false;
  physicsAccumulatorSec = 0;
  setPhase('playing');
}

function goToPaused(pauseReason: PauseReason) {
  pendingResume = phase === 'playing';
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

function updateCrosshair() {
  if (mouseMode) {
    crosshair.dataset.pressed = String(pressed);
    crosshair.dataset.hasTarget = 'false';
    return;
  }
  if (!latestOrientation || !calibration.q0) {
    crosshair.dataset.pressed = String(pressed);
    crosshair.dataset.hasTarget = 'false';
    return;
  }
  const relative = relativeRotation(latestOrientation, calibration.q0);
  const angles = clampAimAngles(relativeRotationToAngles(relative));
  const ratio = anglesToScreenRatio(angles);
  crosshair.style.left = `${ratio.x * 100}%`;
  crosshair.style.top = `${ratio.y * 100}%`;
  crosshair.dataset.pressed = String(pressed);
  crosshair.dataset.hasTarget = 'false';
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
  physics.setPlayerPosition(world.startPosition);
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
  }
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
