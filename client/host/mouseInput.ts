import type { AimInput } from '@shared/types';

// ?input=mouse 일 때만 활성화하는 개발용 AimInput 대체 입력.
// 폰 없이 물리·조준·거미줄 로직을 검증하기 위한 것이며 폰 좌표계와는 무관하다.
export function isMouseInputEnabled(): boolean {
  return new URLSearchParams(window.location.search).get('input') === 'mouse';
}

export class MouseAimInput {
  private input: AimInput = { direction: [0, 0, -1], pressed: false };

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: { fov: number; aspect: number },
  ) {
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseButton);
    canvas.addEventListener('mouseup', this.onMouseButton);
    canvas.addEventListener('mouseleave', this.onMouseLeave);
  }

  get current(): AimInput {
    return this.input;
  }

  private onMouseMove = (event: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    this.input = { ...this.input, direction: mouseNdcToDirection(ndcX, ndcY, this.camera) };
  };

  private onMouseButton = (event: MouseEvent) => {
    this.input = { ...this.input, pressed: (event.buttons & 1) === 1 };
  };

  private onMouseLeave = () => {
    this.input = { ...this.input, pressed: false };
  };

  dispose(): void {
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseButton);
    this.canvas.removeEventListener('mouseup', this.onMouseButton);
    this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
  }
}

// 원근 투영에 맞춘 방향 계산. 카메라는 항상 -Z를 바라보고 롤이 없다고 가정한다(ARCHITECTURE 5절).
export function mouseNdcToDirection(
  ndcX: number,
  ndcY: number,
  camera: { fov: number; aspect: number },
): [number, number, number] {
  const halfFovV = (camera.fov * Math.PI) / 360;
  const tanHalfV = Math.tan(halfFovV);
  const tanHalfH = tanHalfV * camera.aspect;

  const vx = ndcX * tanHalfH;
  const vy = ndcY * tanHalfV;
  const vz = -1;

  const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
  return [vx / len, vy / len, vz / len];
}
