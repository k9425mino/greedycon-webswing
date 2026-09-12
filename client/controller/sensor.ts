import type { Quaternion } from '@shared/types';
import { multiplyQuaternions, quaternionFromAxisAngle } from '@shared/quaternionMath';

// W3C DeviceOrientation 워크드 이그잼플의 alpha/beta/gamma -> 쿼터니언 변환.
// 손목 장착 좌우·상하 부호는 실기기 검증 전이라 임시값이다(AGENTS.md: 미검증 표시).
export function orientationToQuaternion(alpha: number, beta: number, gamma: number): Quaternion {
  const degToRad = Math.PI / 180;
  const x = (beta * degToRad) / 2;
  const y = (gamma * degToRad) / 2;
  const z = (alpha * degToRad) / 2;

  const cX = Math.cos(x);
  const cY = Math.cos(y);
  const cZ = Math.cos(z);
  const sX = Math.sin(x);
  const sY = Math.sin(y);
  const sZ = Math.sin(z);

  const w = cX * cY * cZ - sX * sY * sZ;
  const qx = sX * cY * cZ - cX * sY * sZ;
  const qy = cX * sY * cZ + sX * cY * sZ;
  const qz = cX * cY * sZ + sX * sY * cZ;

  return [qx, qy, qz, w];
}

// 화면 회전(screen.orientation.angle)만큼 보정한다.
export function applyScreenOrientation(
  deviceQuaternion: Quaternion,
  screenAngleDeg: number,
): Quaternion {
  const screenAdjustment = quaternionFromAxisAngle([0, 0, -1], screenAngleDeg);
  return multiplyQuaternions(screenAdjustment, deviceQuaternion);
}

export type PermissionResult = 'granted' | 'denied' | 'unavailable';

export async function requestOrientationPermission(): Promise<PermissionResult> {
  if (typeof DeviceOrientationEvent === 'undefined') return 'unavailable';
  const RequestingEvent = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  };
  if (typeof RequestingEvent.requestPermission !== 'function') {
    // iOS 13+ 외 브라우저는 명시적 권한 요청이 없다. 이벤트 수신 여부로 사용 가능성을 판단한다.
    return 'granted';
  }
  try {
    const result = await RequestingEvent.requestPermission();
    return result === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export class SensorTracker {
  private latest: Quaternion | null = null;
  private lastEventAt: number | null = null;
  private listening = false;

  get available(): boolean {
    if (this.lastEventAt === null) return false;
    return performance.now() - this.lastEventAt < 1000;
  }

  get orientation(): Quaternion | null {
    return this.latest;
  }

  start(onEvent?: () => void): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('deviceorientation', this.handleEvent);
    if (onEvent) this.onEvent = onEvent;
  }

  stop(): void {
    this.listening = false;
    window.removeEventListener('deviceorientation', this.handleEvent);
  }

  private onEvent: (() => void) | undefined;

  private handleEvent = (event: DeviceOrientationEvent): void => {
    if (
      event.alpha === null ||
      event.beta === null ||
      event.gamma === null ||
      ![event.alpha, event.beta, event.gamma].every(Number.isFinite)
    )
      return;
    const deviceQuaternion = orientationToQuaternion(event.alpha, event.beta, event.gamma);
    const screenAngle = window.screen.orientation?.angle ?? 0;
    this.latest = applyScreenOrientation(deviceQuaternion, screenAngle);
    this.lastEventAt = performance.now();
    this.onEvent?.();
  };
}
