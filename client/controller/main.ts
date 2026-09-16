import type { ControllerStatus, HostState, InputFrame } from '@shared/types';
import { AVAILABLE_INPUT_RATES_HZ, gameConfig, type InputRateHz } from '@shared/config';
import { requestOrientationPermission, SensorTracker } from './sensor';
import { TouchState } from './touch';
import { ControllerSocket } from './socket';
import { buildSuitWeb } from './suit';

const app = document.getElementById('app') as HTMLElement;
const statusMessage = document.getElementById('status-message') as HTMLElement;
const btnPermission = document.getElementById('btn-permission') as HTMLButtonElement;
const touchArea = document.getElementById('touch-area') as HTMLElement;
const rateControl = document.getElementById('rate-control') as HTMLElement;
const ledLink = document.getElementById('led-link') as HTMLElement;
const ledSensor = document.getElementById('led-sensor') as HTMLElement;
const ledFire = document.getElementById('led-fire') as HTMLElement;

buildSuitWeb(document.getElementById('suit-web') as unknown as SVGSVGElement);

const inviteToken = new URLSearchParams(location.search).get('invite') ?? '';

const sensor = new SensorTracker();
const touch = new TouchState();
let seq = 0;
let rateHz: InputRateHz = gameConfig.defaultInputRateHz;
let sendTimer: ReturnType<typeof setInterval> | null = null;

// 화면에 글자를 두지 않으므로 상태는 오버레이·LED로만 보인다. 문구는 스크린 리더용으로 남긴다.
function setState(state: 'idle' | 'live' | 'error', message: string) {
  app.dataset.state = state;
  statusMessage.textContent = message;
  ledLink.classList.toggle('on', state === 'live');
  ledLink.classList.toggle('err', state === 'error');
}

function setPressed(pressed: boolean) {
  app.dataset.pressed = String(pressed);
  ledFire.classList.toggle('fire', pressed);
}

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
  }, 1000 / rateHz);
}

function sendStatus() {
  const status: ControllerStatus = {
    sensorAvailable: sensor.available,
    pageVisible: document.visibilityState === 'visible',
  };
  ledSensor.classList.toggle('on', status.sensorAvailable);
  controllerSocket.sendStatus(status);
}

const controllerSocket = new ControllerSocket((state: HostState) => {
  if (state.phase === 'paused' && state.reason) {
    setState('error', pauseGuidance(state.reason));
  } else {
    setState('live', '연결됨. 노트북 화면의 안내를 따르세요.');
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
  setPressed(touch.pressed);
  if (changed) sendPressTransitionNow();
}

function handlePointerUp(event: PointerEvent) {
  const changed = touch.remove(event.pointerId);
  setPressed(touch.pressed);
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
    setPressed(false);
    if (changed) sendPressTransitionNow();
  }
  sendStatus();
});

window.screen.orientation?.addEventListener('change', () => {
  // 화면 회전 시 터치를 해제하고 재보정을 요구한다(호스트가 sensorAvailable false로 감지해 일시 정지).
  const changed = touch.clear();
  setPressed(false);
  if (changed) sendPressTransitionNow();
  controllerSocket.sendStatus({
    sensorAvailable: false,
    pageVisible: document.visibilityState === 'visible',
  });
});

// 전송 속도는 눈금 세 칸으로만 보인다. 탭할 때마다 30/60/120Hz를 순환한다.
function showRateLevel() {
  rateControl.dataset.level = String(AVAILABLE_INPUT_RATES_HZ.indexOf(rateHz) + 1);
}

function cycleRate() {
  const next = (AVAILABLE_INPUT_RATES_HZ.indexOf(rateHz) + 1) % AVAILABLE_INPUT_RATES_HZ.length;
  rateHz = AVAILABLE_INPUT_RATES_HZ[next] ?? rateHz;
  showRateLevel();
  if (sendTimer) startSendLoop();
}

showRateLevel();
rateControl.addEventListener('click', cycleRate);
rateControl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  cycleRate();
});

btnPermission.addEventListener('click', async () => {
  btnPermission.disabled = true;
  try {
    const result = await requestOrientationPermission();
    if (result === 'denied') {
      setState('error', '센서 권한이 거부되었습니다. 브라우저 설정에서 허용한 뒤 새로고침하세요.');
      return;
    }
    if (result === 'unavailable') {
      setState('error', '이 브라우저에서는 방향 센서를 사용할 수 없습니다.');
      return;
    }
    sensor.start();
    setTimeout(() => {
      // 센서 LED가 꺼진 것으로 이미 보이므로 오버레이로 발사 버튼을 덮지 않는다.
      if (!sensor.available) {
        statusMessage.textContent = '센서 이벤트가 수신되지 않습니다. 기기 설정을 확인하세요.';
      }
    }, 1500);

    const joinResult = await controllerSocket.joinOrResume(inviteToken);
    if (!joinResult.ok) {
      setState(
        'error',
        joinResult.error === 'controller_busy'
          ? '이미 다른 폰이 연결되어 있습니다. 운영자에게 교체를 요청하세요.'
          : '연결 정보가 올바르지 않습니다. QR을 다시 스캔하세요.',
      );
      return;
    }
    setState('live', '연결됨. 정면을 향한 뒤 운영자의 보정을 기다리세요.');
    startSendLoop();
    setInterval(sendStatus, 500);
  } finally {
    btnPermission.disabled = sendTimer !== null;
  }
});
