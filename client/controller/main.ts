import type { ControllerStatus, HostState, InputFrame } from '@shared/types';
import { gameConfig, type InputRateHz } from '@shared/config';
import { requestOrientationPermission, SensorTracker } from './sensor';
import { TouchState } from './touch';
import { ControllerSocket } from './socket';

const statusMessage = document.getElementById('status-message') as HTMLElement;
const btnPermission = document.getElementById('btn-permission') as HTMLButtonElement;
const touchArea = document.getElementById('touch-area') as HTMLElement;
const selectRate = document.getElementById('select-rate') as HTMLSelectElement;

const inviteToken = new URLSearchParams(location.search).get('invite') ?? '';

const sensor = new SensorTracker();
const touch = new TouchState();
let seq = 0;
let rateHz: InputRateHz = gameConfig.defaultInputRateHz;
let sendTimer: ReturnType<typeof setInterval> | null = null;

const sensorEventCounter = { count: 0, windowStart: performance.now() };
const sendCounter = { count: 0, windowStart: performance.now() };

function nextSeq(): number {
  seq += 1;
  return seq;
}

function currentFrame(): InputFrame | null {
  if (!sensor.orientation) return null;
  return { seq: nextSeq(), orientation: sensor.orientation, pressed: touch.pressed };
}

function startSendLoop() {
  if (sendTimer) clearInterval(sendTimer);
  sendTimer = setInterval(() => {
    const frame = currentFrame();
    if (!frame) return;
    controllerSocket.sendDirectionFrame(frame);
    sendCounter.count += 1;
  }, 1000 / rateHz);
}

function windowedRate(counter: { count: number; windowStart: number }): number {
  const now = performance.now();
  const elapsed = now - counter.windowStart;
  if (elapsed >= 1000) {
    const hz = (counter.count * 1000) / elapsed;
    counter.count = 0;
    counter.windowStart = now;
    return Math.round(hz);
  }
  return Math.round((counter.count * 1000) / Math.max(elapsed, 1));
}

function sendStatus() {
  const status: ControllerStatus = {
    sensorAvailable: sensor.available,
    pageVisible: document.visibilityState === 'visible',
    sensorHz: windowedRate(sensorEventCounter),
    sendHz: windowedRate(sendCounter),
  };
  controllerSocket.sendStatus(status);
}

const controllerSocket = new ControllerSocket((state: HostState) => {
  if (state.phase === 'paused' && state.reason) {
    statusMessage.textContent = pauseGuidance(state.reason);
  } else {
    statusMessage.textContent = '연결됨. 노트북 화면의 안내를 따르세요.';
  }
});

function pauseGuidance(reason: NonNullable<HostState['reason']>): string {
  switch (reason) {
    case 'inputLost':
      return '입력이 끊겼습니다. 손가락을 뗀 뒤 운영자의 재보정을 기다리세요.';
    case 'hidden':
      return '화면이 전환되었습니다. 이 화면으로 돌아와 대기하세요.';
    case 'sensorUnavailable':
      return '센서 신호가 없습니다. 권한과 연결을 확인하세요.';
    default:
      return '운영자의 안내를 기다리세요.';
  }
}

function handlePointerDown(event: PointerEvent) {
  event.preventDefault();
  touchArea.setPointerCapture(event.pointerId);
  const changed = touch.add(event.pointerId);
  touchArea.dataset.pressed = String(touch.pressed);
  if (changed) sendPressTransitionNow();
}

function handlePointerUp(event: PointerEvent) {
  const changed = touch.remove(event.pointerId);
  touchArea.dataset.pressed = String(touch.pressed);
  if (changed) sendPressTransitionNow();
}

function sendPressTransitionNow() {
  const frame = currentFrame();
  if (!frame) return;
  controllerSocket.sendPressTransition(frame);
}

touchArea.addEventListener('pointerdown', handlePointerDown);
touchArea.addEventListener('pointerup', handlePointerUp);
touchArea.addEventListener('pointercancel', handlePointerUp);
touchArea.addEventListener('lostpointercapture', handlePointerUp);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const changed = touch.clear();
    touchArea.dataset.pressed = 'false';
    if (changed) sendPressTransitionNow();
  }
  sendStatus();
});

window.screen.orientation?.addEventListener('change', () => {
  // 화면 회전 시 터치를 해제하고 재보정을 요구한다(호스트가 sensorAvailable false로 감지해 일시 정지).
  const changed = touch.clear();
  touchArea.dataset.pressed = 'false';
  if (changed) sendPressTransitionNow();
  controllerSocket.sendStatus({
    sensorAvailable: false,
    pageVisible: document.visibilityState === 'visible',
    sensorHz: 0,
    sendHz: 0,
  });
});

selectRate.addEventListener('change', () => {
  rateHz = Number(selectRate.value) as InputRateHz;
  startSendLoop();
});

btnPermission.addEventListener('click', async () => {
  const result = await requestOrientationPermission();
  if (result === 'denied') {
    statusMessage.textContent =
      '센서 권한이 거부되었습니다. 브라우저 설정에서 허용한 뒤 새로고침하세요.';
    return;
  }
  if (result === 'unavailable') {
    statusMessage.textContent = '이 브라우저에서는 방향 센서를 사용할 수 없습니다.';
    return;
  }
  sensor.start(() => {
    sensorEventCounter.count += 1;
  });
  setTimeout(() => {
    if (!sensor.available) {
      statusMessage.textContent = '센서 이벤트가 수신되지 않습니다. 기기 설정을 확인하세요.';
    }
  }, 1500);

  const joinResult = await controllerSocket.joinOrResume(inviteToken);
  if (!joinResult.ok) {
    statusMessage.textContent =
      joinResult.error === 'controller_busy'
        ? '이미 다른 폰이 연결되어 있습니다. 운영자에게 교체를 요청하세요.'
        : '연결 정보가 올바르지 않습니다. QR을 다시 스캔하세요.';
    return;
  }
  statusMessage.textContent = '연결됨. 정면을 향한 뒤 운영자의 보정을 기다리세요.';
  startSendLoop();
  setInterval(sendStatus, 500);
});
