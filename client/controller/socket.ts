import { io, type Socket } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  type ControllerStatus,
  type HostState,
  type InputFrame,
  type SessionJoinAck,
  type SessionResumeAck,
} from '@shared/types';

const CONTROLLER_TOKEN_KEY = 'webswing:controllerToken';

export class ControllerSocket {
  socket: Socket;
  private joined = false;
  private inviteToken: string | null = null;

  constructor(onHostState: (state: HostState) => void) {
    this.socket = io({ autoConnect: true });
    this.socket.on(SOCKET_EVENTS.hostState, onHostState);
    this.socket.on('disconnect', () => {
      this.joined = false;
      onHostState({ phase: 'paused', calibrated: false, reason: 'inputLost' });
    });
    this.socket.on('connect', () => {
      if (this.inviteToken !== null) void this.joinOrResume(this.inviteToken);
    });
  }

  async joinOrResume(inviteToken: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.joined) return { ok: true };
    const storedToken = sessionStorage.getItem(CONTROLLER_TOKEN_KEY);
    if (storedToken) {
      const resumeAck = await this.emitAck<SessionResumeAck>(SOCKET_EVENTS.sessionResume, {
        token: storedToken,
        inviteToken,
      });
      if (resumeAck.ok && resumeAck.role === 'controller') {
        this.joined = true;
        this.inviteToken = inviteToken;
        return { ok: true };
      }
      sessionStorage.removeItem(CONTROLLER_TOKEN_KEY);
    }
    const joinAck = await this.emitAck<SessionJoinAck>(SOCKET_EVENTS.sessionJoin, { inviteToken });
    if (!joinAck.ok) {
      return { ok: false, error: joinAck.error };
    }
    sessionStorage.setItem(CONTROLLER_TOKEN_KEY, joinAck.controllerToken);
    this.joined = true;
    this.inviteToken = inviteToken;
    return { ok: true };
  }

  sendDirectionFrame(frame: InputFrame): void {
    if (!this.socket.connected || !this.joined) return;
    this.socket.volatile.emit(SOCKET_EVENTS.controllerInput, frame);
  }

  sendPressTransition(frame: InputFrame): void {
    if (!this.socket.connected || !this.joined) return;
    this.socket.emit(SOCKET_EVENTS.controllerInput, frame);
  }

  sendStatus(status: ControllerStatus): void {
    if (!this.socket.connected || !this.joined) return;
    this.socket.emit(SOCKET_EVENTS.controllerStatus, status);
  }

  private emitAck<T>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve) => {
      this.socket.emit(event, payload, (ack: T) => resolve(ack));
    });
  }
}
