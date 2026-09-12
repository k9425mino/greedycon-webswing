import { randomUUID } from 'node:crypto';
import { gameConfig } from '../shared/config';

export type Session = {
  id: string;
  hostToken: string;
  inviteToken: string;
  controllerToken: string | null;
  hostSocketId: string | null;
  controllerSocketId: string | null;
  emptySince: number | null;
};

export class SessionStore {
  private sessions = new Map<string, Session>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private now: () => number = Date.now) {
    this.cleanupTimer = setInterval(() => this.cleanupEmptySessions(), 60_000);
    this.cleanupTimer.unref?.();
  }

  create(hostSocketId: string): Session {
    const session: Session = {
      id: randomUUID(),
      hostToken: randomUUID(),
      inviteToken: randomUUID(),
      controllerToken: null,
      hostSocketId,
      controllerSocketId: null,
      emptySince: null,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getById(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  findByInviteToken(inviteToken: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.inviteToken === inviteToken) return session;
    }
    return undefined;
  }

  findByHostToken(hostToken: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.hostToken === hostToken) return session;
    }
    return undefined;
  }

  findByControllerToken(controllerToken: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.controllerToken === controllerToken) return session;
    }
    return undefined;
  }

  // 활성 컨트롤러가 이미 연결되어 있으면 거절한다(OP-01).
  joinController(session: Session, socketId: string): { ok: true } | { ok: false } {
    if (session.controllerToken !== null) {
      return { ok: false };
    }
    session.controllerSocketId = socketId;
    session.controllerToken = randomUUID();
    session.emptySince = null;
    return { ok: true };
  }

  // 운영자 폰 교체: 기존 컨트롤러 권한을 무효화하고 새 join을 받을 수 있게 한다.
  replaceController(session: Session): void {
    session.controllerSocketId = null;
    session.controllerToken = null;
  }

  resumeHost(session: Session, socketId: string): void {
    session.hostSocketId = socketId;
    session.emptySince = null;
  }

  resumeController(session: Session, socketId: string): void {
    session.controllerSocketId = socketId;
    session.emptySince = null;
  }

  disconnectHost(session: Session): void {
    session.hostSocketId = null;
    this.markEmptyIfNeeded(session);
  }

  disconnectController(session: Session): void {
    session.controllerSocketId = null;
    this.markEmptyIfNeeded(session);
  }

  private markEmptyIfNeeded(session: Session): void {
    if (session.hostSocketId === null && session.controllerSocketId === null) {
      session.emptySince = this.now();
    }
  }

  cleanupEmptySessions(): void {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (session.emptySince !== null && now - session.emptySince >= gameConfig.emptySessionTtlMs) {
        this.sessions.delete(id);
      }
    }
  }

  stop(): void {
    clearInterval(this.cleanupTimer);
  }
}
