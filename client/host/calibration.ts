import type { Quaternion } from '@shared/types';

export class Calibration {
  private reference: Quaternion | null = null;

  get calibrated(): boolean {
    return this.reference !== null;
  }

  get q0(): Quaternion | null {
    return this.reference;
  }

  // 터치가 해제된 상태에서만 보정을 허용한다(문서: calibrating -> ready 전이 조건).
  calibrate(currentOrientation: Quaternion, pressed: boolean): boolean {
    if (pressed) return false;
    this.reference = currentOrientation;
    return true;
  }

  reset(): void {
    this.reference = null;
  }
}
