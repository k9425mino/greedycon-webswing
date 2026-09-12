import type { GamePhase } from '@shared/types';

// 재개 대기 여부: playing에서 최초로 설정되면 paused/calibrating/ready를 거치는 동안
// 다시 입력이 끊겨도(phase가 playing이 아니어도) 유지된다. goToPlaying이 소비한 뒤에만 꺼진다.
export function nextPendingResume(pendingResume: boolean, phase: GamePhase): boolean {
  return pendingResume || phase === 'playing';
}
