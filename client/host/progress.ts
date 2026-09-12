import { gameConfig } from '@shared/config';

export type StallState = 'ok' | 'warning' | 'ended';

// 점수와 전진 정체를 계산한다(PRD GM-03·GM-04).
// 물리 step에서만 호출하므로 정지·연결 중단 중에는 시간이 늘지 않는다(OP-04).
export class Progress {
  private activeSeconds = 0;
  private maxForward = 0;
  private stallAnchor = 0;
  private stallSeconds = 0;

  // 전방 최고 도달 거리는 -Z 기준이다(ARCHITECTURE 5절).
  step(dtSec: number, playerZ: number): void {
    this.activeSeconds += dtSec;

    // 전진 갱신을 먼저 반영한 뒤 정체를 판정한다(ARCHITECTURE 5절).
    const forward = -playerZ;
    if (forward > this.maxForward) this.maxForward = forward;

    if (this.maxForward - this.stallAnchor >= gameConfig.progress.stallResetDistanceM) {
      this.stallAnchor = this.maxForward;
      this.stallSeconds = 0;
      return;
    }
    this.stallSeconds += dtSec;
  }

  get score(): number {
    return Math.floor(this.activeSeconds * gameConfig.progress.scorePerSecond);
  }

  get elapsedSeconds(): number {
    return this.activeSeconds;
  }

  get stallState(): StallState {
    if (this.stallSeconds >= gameConfig.progress.stallEndSec) return 'ended';
    if (this.stallSeconds >= gameConfig.progress.stallWarnSec) return 'warning';
    return 'ok';
  }

  // 종료까지 남은 시간(경고 표시용).
  get stallSecondsLeft(): number {
    return Math.max(0, gameConfig.progress.stallEndSec - this.stallSeconds);
  }

  reset(startZ: number): void {
    this.activeSeconds = 0;
    this.maxForward = -startZ;
    this.stallAnchor = this.maxForward;
    this.stallSeconds = 0;
  }
}
