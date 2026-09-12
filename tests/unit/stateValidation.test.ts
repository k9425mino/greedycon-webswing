import { describe, expect, it } from 'vitest';
import { isValidControllerStatus, isValidHostState } from '../../shared/stateValidation';

describe('상태 메시지 검증', () => {
  it('종료·정지 사유와 사유 없는 정상 상태를 허용한다', () => {
    expect(isValidHostState({ phase: 'ready', calibrated: true })).toBe(true);
    expect(isValidHostState({ phase: 'paused', calibrated: false, reason: 'inputLost' })).toBe(
      true,
    );
    expect(isValidHostState({ phase: 'gameOver', calibrated: true, reason: 'fall' })).toBe(true);
  });

  it.each([
    null,
    [],
    'playing',
    {},
    { phase: 'unknown', calibrated: false },
    { phase: 'playing', calibrated: 1 },
    { phase: 'paused', calibrated: false, reason: null },
    { phase: 'paused', calibrated: false, reason: 'unknown' },
  ])('잘못된 호스트 상태를 거절한다: %j', (state) => {
    expect(isValidHostState(state)).toBe(false);
  });

  const status = { sensorAvailable: true, pageVisible: true, sensorHz: 60, sendHz: 30 };

  it('센서 미수신 상태와 0Hz도 유효한 상태로 취급한다', () => {
    expect(isValidControllerStatus(status)).toBe(true);
    expect(
      isValidControllerStatus({ ...status, sensorAvailable: false, sensorHz: 0, sendHz: 0 }),
    ).toBe(true);
  });

  it.each([NaN, Infinity, -1, '60', null, undefined])('잘못된 빈도를 거절한다: %s', (rate) => {
    expect(isValidControllerStatus({ ...status, sensorHz: rate })).toBe(false);
    expect(isValidControllerStatus({ ...status, sendHz: rate })).toBe(false);
  });

  it('객체·불리언 필드가 없거나 타입이 다르면 거절한다', () => {
    expect(isValidControllerStatus(null)).toBe(false);
    expect(isValidControllerStatus({})).toBe(false);
    expect(isValidControllerStatus({ ...status, sensorAvailable: 'true' })).toBe(false);
    expect(isValidControllerStatus({ ...status, pageVisible: 1 })).toBe(false);
  });
});
