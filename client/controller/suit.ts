// 슈트 배경의 거미줄. 노즐 위치(상단 중앙)에서 방사되도록 SVG 경로를 만든다.
const SVG_NS = 'http://www.w3.org/2000/svg';
const CENTER_X = 100;
const CENTER_Y = 26;
const SPOKE_COUNT = 17;
const SPOKE_FROM_DEG = 4;
const SPOKE_TO_DEG = 176;
const SPOKE_LENGTH = 560;
const RING_RADII = [40, 72, 108, 148, 192, 240, 292, 348, 408, 472, 540];
// 가닥이 안쪽으로 처지는 정도. 1이면 직선이 된다.
const RING_SAG = 0.86;

export function buildSuitWeb(svg: SVGSVGElement) {
  const spokeAngle = (index: number) =>
    ((SPOKE_FROM_DEG + ((SPOKE_TO_DEG - SPOKE_FROM_DEG) * index) / (SPOKE_COUNT - 1)) * Math.PI) /
    180;
  const point = (angle: number, radius: number): [number, number] => [
    CENTER_X + Math.cos(angle) * radius,
    CENTER_Y + Math.sin(angle) * radius,
  ];

  const fragment = document.createDocumentFragment();
  const addPath = (className: string, d: string) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', className);
    path.setAttribute('d', d);
    fragment.appendChild(path);
  };

  for (let i = 0; i < SPOKE_COUNT; i += 1) {
    const [x, y] = point(spokeAngle(i), SPOKE_LENGTH);
    addPath('spoke', `M${CENTER_X} ${CENTER_Y} L${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  for (const radius of RING_RADII) {
    for (let i = 0; i < SPOKE_COUNT - 1; i += 1) {
      const angleStart = spokeAngle(i);
      const angleEnd = spokeAngle(i + 1);
      const [x0, y0] = point(angleStart, radius);
      const [x1, y1] = point(angleEnd, radius);
      const [cx, cy] = point((angleStart + angleEnd) / 2, radius * RING_SAG);
      addPath(
        'ring',
        `M${x0.toFixed(1)} ${y0.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`,
      );
    }
  }

  svg.appendChild(fragment);
}
