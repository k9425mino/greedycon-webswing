// 1초 슬라이딩 윈도우로 이벤트 발생률(Hz)을 계산한다. 중복 전송과 실제 갱신 빈도를 구분하기 위함.
export class RateCounter {
  private timestamps: number[] = [];

  tick(now: number = performance.now()): void {
    this.timestamps.push(now);
    const cutoff = now - 1000;
    while (this.timestamps.length > 0 && (this.timestamps[0] as number) < cutoff) {
      this.timestamps.shift();
    }
  }

  hz(now: number = performance.now()): number {
    const cutoff = now - 1000;
    while (this.timestamps.length > 0 && (this.timestamps[0] as number) < cutoff) {
      this.timestamps.shift();
    }
    return this.timestamps.length;
  }
}
