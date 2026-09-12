// pointerId 집합으로 멀티터치를 관리한다. 손가락 하나 이상이 남으면 누름을 유지한다.
export class TouchState {
  private pointers = new Set<number>();

  get pressed(): boolean {
    return this.pointers.size > 0;
  }

  add(pointerId: number): boolean {
    const wasPressed = this.pressed;
    this.pointers.add(pointerId);
    return this.pressed !== wasPressed;
  }

  remove(pointerId: number): boolean {
    const wasPressed = this.pressed;
    this.pointers.delete(pointerId);
    return this.pressed !== wasPressed;
  }

  // 페이지 숨김 등으로 전체 해제할 때 사용한다.
  clear(): boolean {
    const wasPressed = this.pressed;
    this.pointers.clear();
    return this.pressed !== wasPressed;
  }
}
