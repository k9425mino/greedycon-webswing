import { io, type Socket } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  type ControllerStatus,
  type HostState,
  type InputFrame,
  type SessionCreateAck,
  type SessionResumeAck,
} from '@shared/types';

const HOST_TOKEN_KEY = 'webswing:hostToken';
const INVITE_TOKEN_KEY = 'webswing:inviteToken';

export type HostSession = {
  sessionId: string;
  inviteToken: string;
};

export type HostSocketCallbacks = {
  onInput: (frame: InputFrame) => void;
  onControllerStatus: (status: ControllerStatus) => void;
  onSessionStatus: (status: { hostConnected: boolean; controllerConnected: boolean }) => void;
};

export class HostSocket {
  socket: Socket;
  private callbacks: HostSocketCallbacks;

  constructor(callbacks: HostSocketCallbacks) {
    this.callbacks = callbacks;
    this.socket = io({ autoConnect: true });
    this.socket.on(SOCKET_EVENTS.controllerInput, (frame: InputFrame) =>
      this.callbacks.onInput(frame),
    );
    this.socket.on(SOCKET_EVENTS.controllerStatus, (status: ControllerStatus) =>
      this.callbacks.onControllerStatus(status),
    );
    this.socket.on(
      SOCKET_EVENTS.sessionStatus,
      (status: { hostConnected: boolean; controllerConnected: boolean }) =>
        this.callbacks.onSessionStatus(status),
    );
  }

  async startOrResume(): Promise<HostSession> {
    const storedToken = sessionStorage.getItem(HOST_TOKEN_KEY);
    if (storedToken) {
      const resumeAck = await this.emitAck<SessionResumeAck>(SOCKET_EVENTS.sessionResume, {
        token: storedToken,
      });
      if (resumeAck.ok && resumeAck.role === 'host') {
        return {
          sessionId: resumeAck.sessionId,
          inviteToken: sessionStorage.getItem(INVITE_TOKEN_KEY) ?? '',
        };
      }
    }
    const createAck = await this.emitAck<SessionCreateAck>(SOCKET_EVENTS.sessionCreate, {});
    if (!createAck.ok) {
      throw new Error(createAck.error);
    }
    sessionStorage.setItem(HOST_TOKEN_KEY, createAck.hostToken);
    sessionStorage.setItem(INVITE_TOKEN_KEY, createAck.inviteToken);
    return { sessionId: createAck.sessionId, inviteToken: createAck.inviteToken };
  }

  sendHostState(state: HostState): void {
    this.socket.emit(SOCKET_EVENTS.hostState, state);
  }

  requestReplaceController(): void {
    this.socket.emit(SOCKET_EVENTS.sessionReplaceController);
  }

  private emitAck<T>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve) => {
      this.socket.emit(event, payload, (ack: T) => resolve(ack));
    });
  }
}
