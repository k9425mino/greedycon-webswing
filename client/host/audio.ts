// 오디오 실패는 게임 상태 전이와 물리 콜백을 중단시키지 않는다.
export class SfxPlayer {
  private ctx: AudioContext | null = null;
  private muted = false;
  private windRequested = false;
  private windOsc: OscillatorNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private voices = new Map<OscillatorNode, AudioNode[]>();

  constructor() {
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      /* 오디오 없이 플레이한다. */
    }
  }

  get available(): boolean {
    return this.ctx !== null;
  }
  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.clearVoices();
    else if (this.windRequested) this.startWind();
  }

  // 사용자 조작 안에서 호출한다. 정책에 의한 거절은 다음 조작에서 다시 시도한다.
  resume(): void {
    this.withAudio((ctx) => {
      void ctx.resume().catch(() => {});
    });
  }

  private withAudio(action: (ctx: AudioContext) => void): void {
    if (!this.ctx) return;
    try {
      action(this.ctx);
    } catch {
      this.dispose();
    }
  }

  private createVoice(ctx: AudioContext): OscillatorNode {
    const osc = ctx.createOscillator();
    this.voices.set(osc, [osc]);
    osc.onended = () => this.releaseVoice(osc);
    return osc;
  }

  private releaseVoice(osc: OscillatorNode): void {
    const nodes = this.voices.get(osc);
    if (!nodes) return;
    this.voices.delete(osc);
    osc.onended = null;
    // 부분 생성 실패로 아직 시작하지 못한 음원도 이 경로로 정리한다.
    try {
      osc.stop();
    } catch {
      /* 시작 전 또는 이미 종료됨 */
    }
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        /* 나머지 노드 정리를 계속한다. */
      }
    }
  }

  private clearVoices(): void {
    for (const osc of this.voices.keys()) this.releaseVoice(osc);
    this.windOsc = null;
    this.windGain = null;
    this.windFilter = null;
  }

  private tone(freq: number, durationSec: number, type: OscillatorType, peakGain: number): void {
    if (this.muted) return;
    this.withAudio((ctx) => {
      const t0 = ctx.currentTime;
      const osc = this.createVoice(ctx);
      const gain = ctx.createGain();
      this.voices.get(osc)!.push(gain);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + durationSec + 0.02);
    });
  }

  playFire(): void {
    this.tone(920, 0.07, 'square', 0.12);
  }
  playAttach(): void {
    this.tone(520, 0.09, 'sine', 0.18);
    this.tone(780, 0.09, 'sine', 0.1);
  }
  playRelease(): void {
    this.tone(260, 0.07, 'triangle', 0.1);
  }

  startWind(): void {
    this.windRequested = true;
    if (this.muted || this.windOsc) return;
    this.withAudio((ctx) => {
      const osc = this.createVoice(ctx);
      const filter = ctx.createBiquadFilter();
      this.voices.get(osc)!.push(filter);
      const gain = ctx.createGain();
      this.voices.get(osc)!.push(gain);
      osc.type = 'sawtooth';
      osc.frequency.value = 60;
      filter.type = 'lowpass';
      filter.frequency.value = 300;
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(ctx.destination);
      osc.start();
      this.windOsc = osc;
      this.windFilter = filter;
      this.windGain = gain;
    });
  }

  updateWind(speedMs: number): void {
    this.withAudio((ctx) => {
      if (!this.windGain || !this.windFilter) return;
      const t = ctx.currentTime;
      const clamped = Math.max(0, Math.min(30, speedMs));
      this.windGain.gain.setTargetAtTime(Math.min(0.06, clamped / 350), t, 0.1);
      this.windFilter.frequency.setTargetAtTime(250 + clamped * 18, t, 0.1);
    });
  }

  stopAll(): void {
    this.windRequested = false;
    this.clearVoices();
  }

  dispose(): void {
    this.stopAll();
    const ctx = this.ctx;
    this.ctx = null;
    try {
      void ctx?.close().catch(() => {});
    } catch {
      /* 이미 닫힌 오디오 */
    }
  }
}
