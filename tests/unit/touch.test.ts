import { describe, expect, it } from 'vitest';
import { TouchState } from '../../client/controller/touch';

describe('TouchState', () => {
  it('중지·약지 중 하나만 떼도 줄을 유지한다', () => {
    const touch = new TouchState();
    touch.add(1);
    touch.add(2);
    expect(touch.pressed).toBe(true);
    touch.remove(1);
    expect(touch.pressed).toBe(true);
  });

  it('마지막 포인터가 떨어져야 해제된다', () => {
    const touch = new TouchState();
    touch.add(1);
    touch.add(2);
    touch.remove(1);
    touch.remove(2);
    expect(touch.pressed).toBe(false);
  });

  it('pointercancel(remove)로도 해제된다', () => {
    const touch = new TouchState();
    touch.add(1);
    touch.remove(1);
    expect(touch.pressed).toBe(false);
  });

  it('clear()는 즉시 전체 해제한다(hidden 처리용)', () => {
    const touch = new TouchState();
    touch.add(1);
    touch.add(2);
    const changed = touch.clear();
    expect(touch.pressed).toBe(false);
    expect(changed).toBe(true);
  });

  it('상태 전환이 없으면 changed=false를 반환한다', () => {
    const touch = new TouchState();
    touch.add(1);
    const changed = touch.add(2);
    expect(changed).toBe(false);
  });
});
