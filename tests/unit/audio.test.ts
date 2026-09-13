import { afterEach, expect, it, vi } from 'vitest';
import { SfxPlayer } from '../../client/host/audio';

function audioFixture() {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  });
  function makeNode() {
    const result = {
      frequency: param(),
      gain: param(),
      type: '',
      onended: null as (() => void) | null,
      connect: vi.fn((next: unknown) => next),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    return result;
  }
  const nodes: ReturnType<typeof makeNode>[] = [];
  function node() {
    const result = makeNode();
    nodes.push(result);
    return result;
  }
  const oscillators: ReturnType<typeof node>[] = [];
  const ctx = {
    currentTime: 0,
    destination: {},
    createOscillator: vi.fn(() => {
      const osc = node();
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(node),
    createBiquadFilter: vi.fn(node),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
  vi.stubGlobal('window', {
    AudioContext: class {
      constructor() {
        return ctx;
      }
    },
  });
  return { ctx, nodes, oscillators, player: new SfxPlayer() };
}

afterEach(() => vi.unstubAllGlobals());

it('음소거 해제는 요청 중인 바람만 복구하고 중복 시작하지 않는다', () => {
  const { player, oscillators } = audioFixture();
  player.startWind();
  player.startWind();
  expect(oscillators).toHaveLength(1);
  player.setMuted(true);
  player.setMuted(false);
  expect(oscillators).toHaveLength(2);
  player.stopAll();
  player.setMuted(true);
  player.setMuted(false);
  expect(oscillators).toHaveLength(2);
});

it('음소거 상태에서 시작한 게임도 음소거를 풀면 바람이 시작된다', () => {
  const { player, oscillators } = audioFixture();
  player.setMuted(true);
  player.startWind();
  expect(oscillators).toHaveLength(0);
  player.setMuted(false);
  expect(oscillators).toHaveLength(1);
});

it('자연 종료한 효과음과 반복 정리한 음원의 연결을 해제한다', () => {
  const { player, nodes, oscillators } = audioFixture();
  player.playFire();
  oscillators[0]!.onended?.();
  expect(nodes.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
  player.startWind();
  player.playAttach();
  player.stopAll();
  player.stopAll();
  expect(nodes.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
});

it('부분 생성 실패가 게임 호출부로 전파되지 않고 자원을 정리한다', () => {
  const { player, ctx, nodes } = audioFixture();
  ctx.createGain.mockImplementationOnce(() => {
    throw new Error('audio unavailable');
  });
  expect(() => player.playFire()).not.toThrow();
  expect(nodes[0]!.disconnect).toHaveBeenCalledOnce();
  expect(player.available).toBe(false);
  expect(() => {
    player.startWind();
    player.playAttach();
    player.dispose();
  }).not.toThrow();
});

it('resume 실패와 dispose 이후의 호출도 게임 진행을 막지 않는다', () => {
  const { player, ctx } = audioFixture();
  ctx.resume.mockImplementationOnce(() => {
    throw new Error('closed');
  });
  expect(() => player.resume()).not.toThrow();
  player.dispose();
  expect(() => {
    player.playFire();
    player.startWind();
    player.dispose();
  }).not.toThrow();
  expect(ctx.close).toHaveBeenCalledOnce();
});
