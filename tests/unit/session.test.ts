import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionStore } from '../../server/session';

describe('SessionStore', () => {
  let now: number;
  let store: SessionStore;

  beforeEach(() => {
    now = 0;
    store = new SessionStore(() => now);
  });

  afterEach(() => {
    store.stop();
  });

  it('두 번째 컨트롤러 join은 거절한다', () => {
    const session = store.create('host-1');
    expect(store.joinController(session, 'controller-1')).toEqual({ ok: true });
    expect(store.joinController(session, 'controller-2')).toEqual({ ok: false });
  });

  it('복구 토큰으로 같은 세션을 다시 찾을 수 있다', () => {
    const session = store.create('host-1');
    store.joinController(session, 'controller-1');
    const found = store.findByControllerToken(session.controllerToken!);
    expect(found?.id).toBe(session.id);
  });

  it('폰 교체 후에는 새 컨트롤러가 join할 수 있다', () => {
    const session = store.create('host-1');
    store.joinController(session, 'controller-1');
    store.replaceController(session);
    expect(session.controllerSocketId).toBeNull();
    expect(store.joinController(session, 'controller-2')).toEqual({ ok: true });
  });

  it('호스트·컨트롤러 모두 연결 해제된 지 10분이 지나면 정리한다', () => {
    const session = store.create('host-1');
    store.joinController(session, 'controller-1');
    store.disconnectHost(session);
    store.disconnectController(session);

    now += 9 * 60 * 1000;
    store.cleanupEmptySessions();
    expect(store.getById(session.id)).toBeDefined();

    now += 2 * 60 * 1000; // 총 11분 경과
    store.cleanupEmptySessions();
    expect(store.getById(session.id)).toBeUndefined();
  });

  it('한쪽만 재연결하면 정리 대상에서 제외된다', () => {
    const session = store.create('host-1');
    store.joinController(session, 'controller-1');
    store.disconnectHost(session);
    store.disconnectController(session);

    now += 5 * 60 * 1000;
    store.resumeHost(session, 'host-2');

    now += 11 * 60 * 1000;
    store.cleanupEmptySessions();
    expect(store.getById(session.id)).toBeDefined();
  });
});
