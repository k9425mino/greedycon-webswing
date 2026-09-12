import { describe, expect, it } from 'vitest';
import { nextPendingResume } from '../../client/host/resumeState';

describe('nextPendingResume', () => {
  it('playing에서 정지하면 재개 대기를 켠다', () => {
    expect(nextPendingResume(false, 'playing')).toBe(true);
  });

  it('재보정 후 ready 상태에서 다시 끊겨도 재개 대기를 유지한다', () => {
    // 문서화된 버그: goToPaused가 phase==='playing' 여부만으로 덮어써 ready에서 꺼졌었다.
    expect(nextPendingResume(true, 'ready')).toBe(true);
    expect(nextPendingResume(true, 'calibrating')).toBe(true);
  });

  it('애초에 재개 대기가 아니었다면 playing이 아닌 정지는 여전히 꺼져 있다', () => {
    expect(nextPendingResume(false, 'ready')).toBe(false);
    expect(nextPendingResume(false, 'calibrating')).toBe(false);
  });
});
