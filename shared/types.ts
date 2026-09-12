export type Quaternion = [number, number, number, number]; // x, y, z, w

export type GamePhase = 'pairing' | 'calibrating' | 'ready' | 'playing' | 'paused' | 'gameOver';

export type PauseReason =
  'inputLost' | 'hidden' | 'sensorUnavailable' | 'fall' | 'stalled' | 'operator';

export type InputFrame = {
  seq: number;
  orientation: Quaternion; // 화면 방향 보정 후 기기 자세, 정면 보정 전
  pressed: boolean;
};

export type AimInput = {
  direction: [number, number, number]; // 게임 월드의 정규화 방향
  pressed: boolean;
};

export type HostState = {
  phase: GamePhase;
  calibrated: boolean;
  reason?: PauseReason;
};

export type ControllerStatus = {
  sensorAvailable: boolean;
  pageVisible: boolean;
  sensorHz: number;
  sendHz: number;
};

export type SessionRole = 'host' | 'controller';

export type SessionCreateAck =
  | {
      ok: true;
      sessionId: string;
      hostToken: string;
      inviteToken: string;
    }
  | { ok: false; error: string };

export type SessionJoinAck =
  | {
      ok: true;
      sessionId: string;
      controllerToken: string;
    }
  | { ok: false; error: 'invalid_invite' | 'controller_busy' };

export type SessionResumeAck =
  { ok: true; sessionId: string; role: SessionRole } | { ok: false; error: 'invalid_token' };

export type SessionStatus = {
  hostConnected: boolean;
  controllerConnected: boolean;
};

export const SOCKET_EVENTS = {
  sessionCreate: 'session:create',
  sessionJoin: 'session:join',
  sessionResume: 'session:resume',
  sessionReplaceController: 'session:replaceController',
  controllerInput: 'controller:input',
  controllerStatus: 'controller:status',
  hostState: 'host:state',
  sessionStatus: 'session:status',
} as const;
