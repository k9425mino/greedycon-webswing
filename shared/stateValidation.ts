import type { ControllerStatus, GamePhase, HostState, PauseReason } from './types';

const GAME_PHASES: readonly GamePhase[] = [
  'pairing',
  'calibrating',
  'ready',
  'playing',
  'paused',
  'gameOver',
];
const PAUSE_REASONS: readonly PauseReason[] = [
  'inputLost',
  'hidden',
  'sensorUnavailable',
  'fall',
  'stalled',
  'operator',
];

export function isValidHostState(value: unknown): value is HostState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    GAME_PHASES.some((phase) => phase === state.phase) &&
    typeof state.calibrated === 'boolean' &&
    (state.reason === undefined || PAUSE_REASONS.some((reason) => reason === state.reason))
  );
}

export function isValidControllerStatus(value: unknown): value is ControllerStatus {
  if (typeof value !== 'object' || value === null) return false;
  const status = value as Record<string, unknown>;
  return (
    typeof status.sensorAvailable === 'boolean' &&
    typeof status.pageVisible === 'boolean' &&
    typeof status.sensorHz === 'number' &&
    Number.isFinite(status.sensorHz) &&
    status.sensorHz >= 0 &&
    typeof status.sendHz === 'number' &&
    Number.isFinite(status.sendHz) &&
    status.sendHz >= 0
  );
}
