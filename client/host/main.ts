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
  anglesToScreenRatio,
  clampAimAngles,
  relativeRotation,
  relativeRotationToAngles,
} from './aim';
import { RateCounter } from './diagnostics';
import { createScene } from './scene';

const qrImage = document.getElementById('qr-image') as HTMLImageElement;
const inviteLink = document.getElementById('invite-link') as HTMLAnchorElement;
const statusConnection = document.getElementById('status-connection') as HTMLElement;
const statusSensor = document.getElementById('status-sensor') as HTMLElement;
const statusTouch = document.getElementById('status-touch') as HTMLElement;
const statusPhase = document.getElementById('status-phase') as HTMLElement;
const crosshair = document.getElementById('crosshair') as HTMLElement;
const recoverySection = document.getElementById('recovery-section') as HTMLElement;
const recoveryMessage = document.getElementById('recovery-message') as HTMLElement;
const diagSensorHz = document.getElementById('diag-sensor-hz') as HTMLElement;
const diagSendHz = document.getElementById('diag-send-hz') as HTMLElement;
const diagRecvHz = document.getElementById('diag-recv-hz') as HTMLElement;
const btnCalibrate = document.getElementById('btn-calibrate') as HTMLButtonElement;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const btnSwitchPhone = document.getElementById('btn-switch-phone') as HTMLButtonElement;
const canvas = document.getElementById('scene') as HTMLCanvasElement;

createScene(canvas);

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

const calibration = new Calibration();
const seqTracker = createSeqTracker();
const sensorRate = new RateCounter();
const recvRate = new RateCounter();

function setPhase(next: GamePhase, nextReason?: PauseReason) {
  phase = next;
  reason = nextReason;
  statusPhase.textContent = phase;
  refreshStatusText();
  recoverySection.hidden = phase !== 'paused';
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
  if (phase !== 'ready' || !inputReady() || pressed) return;
  setPhase('playing');
}

function goToPaused(pauseReason: PauseReason) {
  calibration.reset();
  setPhase('paused', pauseReason);
}

function maybeRecover() {
  if (phase !== 'paused') return;
  const connected = controllerConnected;
  const sensorOk = controllerStatus?.sensorAvailable ?? false;
  const visible = controllerStatus?.pageVisible ?? false;
  if (connected && sensorOk && visible && inputReady()) {
    goToCalibrating();
  }
}

function inputReady(): boolean {
  return (
    controllerConnected &&
    controllerStatus?.sensorAvailable === true &&
    controllerStatus.pageVisible &&
    !document.hidden &&
    lastInputAt !== null &&
    performance.now() - lastInputAt <= gameConfig.inputLostTimeoutMs
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
  btnCalibrate.disabled = phase !== 'calibrating' || !inputReady() || pressed;
  btnStart.disabled = phase !== 'ready' || !inputReady() || pressed;
  statusConnection.textContent = controllerConnected ? '연결됨' : '대기중';
  statusSensor.textContent = controllerStatus?.sensorAvailable ? '정상' : '없음';
  statusTouch.textContent = pressed ? '누름' : '해제';
  diagSensorHz.textContent = String(controllerStatus?.sensorHz ?? 0);
  diagSendHz.textContent = String(controllerStatus?.sendHz ?? 0);
  diagRecvHz.textContent = String(recvRate.hz());
}

function updateCrosshair() {
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
  // 이번 범위엔 건물이 없어 유효 표적 판정을 하지 않는다. 항상 "표적 없음" 스타일로 표시한다.
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
  if (
    (phase === 'playing' || phase === 'ready') &&
    lastInputAt !== null &&
    performance.now() - lastInputAt > gameConfig.inputLostTimeoutMs
  ) {
    goToPaused('inputLost');
  }
}, 100);

document.addEventListener('visibilitychange', () => {
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

async function init() {
  const session = await hostSocket.startOrResume();
  const controllerUrl = buildControllerUrl(session.inviteToken);
  inviteLink.href = controllerUrl;
  inviteLink.textContent = controllerUrl;
  await renderQr(qrImage, controllerUrl);
  if (!controllerConnected) setPhase('pairing');
}

init();
