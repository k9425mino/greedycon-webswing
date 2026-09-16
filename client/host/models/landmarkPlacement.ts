import type { BoxSpec, Vec3 } from '../physics';

export type LandmarkPlacement = {
  kind: 'aejiheon' | 'daeyang-ai' | 'gwanggaeto' | 'naver';
  scale: number;
  position: Vec3;
  side: -1 | 1;
};

// 모델의 바닥 경계. +Z 정면을 도로로 돌리면 예배당(-Z)은 도로 바깥에 놓인다.
export const AEJIHEON_BOUNDS = { minX: -4.8, maxX: 15.3, minZ: -24.5, maxZ: 4.8 };
export const DAEYANG_AI_BOUNDS = { minX: -24, maxX: 24, minZ: -19, maxZ: 23 };
export const GWANGGAETO_BOUNDS = { minX: -23, maxX: 25, minZ: -35, maxZ: 14 };
export const NAVER_BOUNDS = { minX: -20, maxX: 20, minZ: -13, maxZ: 15 };

// 기존 물리의 상자 충돌체를 사용한다. 몰딩·아치·경사 지붕은 단순화하되
// 낮은 예배당 위에 탑 높이의 보이지 않는 벽을 만들지 않는다.
const localBoxes: BoxSpec[] = [
  { center: [0, 1.5, 0], halfExtents: [4.8, 1.5, 4.8] },
  { center: [0, 21, 0], halfExtents: [4, 18, 4] },
  { center: [0, 40.45, 0], halfExtents: [4.7, 1.45, 4.7] },
  { center: [0, 44.1, 0], halfExtents: [4.2, 2.2, 4.2] },
  { center: [0, 48.35, 0], halfExtents: [4.5, 2.05, 4.5] },
  { center: [0, 51.3, 0], halfExtents: [2.8, 0.9, 2.8] },
  { center: [0, 52.9, 0], halfExtents: [1, 0.7, 1] },
  { center: [7.3, 0.225, -13], halfExtents: [8, 0.225, 11.5] },
  { center: [7.3, 4.45, -13], halfExtents: [7, 4, 10.5] },
  { center: [7.3, 9.5, -13], halfExtents: [5, 0.85, 10.5] },
  { center: [7.3, 11.3, -13], halfExtents: [2.2, 0.95, 10.5] },
  { center: [7.3, 4.85, -2], halfExtents: [3, 4.4, 1] },
];

const aiBoxes: BoxSpec[] = [
  { center: [0, 0.25, 2], halfExtents: [24, 0.25, 21] },
  { center: [0, 9, 0], halfExtents: [21, 8.5, 17] },
  { center: [0, 18.85, 0], halfExtents: [22, 1.4, 18] },
  { center: [-2, 35.05, 2], halfExtents: [16, 14.75, 13] },
  { center: [-2, 51, 2], halfExtents: [16.75, 1.35, 13.75] },
  { center: [-3, 53.55, -0.5], halfExtents: [6, 1.1, 4.5] },
];

// ㄱ자 평면을 정면동·측면동·잘린 코너 세 덩어리로 묶고, 저층부와 기준층을 나눠 잡는다.
// 45° 코너는 상자로 표현할 수 없어 잘린 면 안쪽에 들어가는 작은 상자로 줄여 잡는다.
const gwanggaetoBoxes: BoxSpec[] = [
  { center: [1, 0.25, 12], halfExtents: [24, 0.25, 2] },
  { center: [-3, 4.6, 0], halfExtents: [19.9, 4.6, 10.9] },
  { center: [17, 4.6, -16], halfExtents: [7.9, 4.6, 18.9] },
  { center: [17, 4.6, 3], halfExtents: [3, 4.6, 3] },
  { center: [-3, 33.4, 0], halfExtents: [19, 24.2, 10] },
  { center: [17, 33.4, -16], halfExtents: [7, 24.2, 18] },
  { center: [17, 33.4, 3], halfExtents: [3, 24.2, 3] },
  { center: [-3, 58.25, 0], halfExtents: [19.6, 0.65, 10.6] },
  { center: [17, 58.25, -16], halfExtents: [7.6, 0.65, 18.6] },
  { center: [-3, 60.65, -2], halfExtents: [12, 1.75, 7] },
];

const boxesByKind = {
  aejiheon: localBoxes,
  'daeyang-ai': aiBoxes,
  gwanggaeto: gwanggaetoBoxes,
  naver: [
    { center: [0, 0.2, 1], halfExtents: [20, 0.2, 14] },
    { center: [0, 3.2, 0], halfExtents: [18, 2.8, 11.5] },
    { center: [0, 42.5, 0], halfExtents: [18, 36.5, 11] },
    { center: [2, 80.25, -3], halfExtents: [6, 0.9, 3.5] },
  ] as BoxSpec[],
};

export function landmarkColliders({ position, side, scale, kind }: LandmarkPlacement): BoxSpec[] {
  return boxesByKind[kind].map(({ center: [x, y, z], halfExtents: [w, h, d] }) => ({
    center: [
      position[0] - side * z * scale,
      position[1] + y * scale,
      position[2] + side * x * scale,
    ],
    halfExtents: [d * scale, h * scale, w * scale],
  }));
}
