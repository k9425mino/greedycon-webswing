import { describe, expect, it } from 'vitest';
import { gameConfig } from '@shared/config';
import { defaultSwingOptions, selectTarget } from '../../client/host/web';
import {
  forwardSwingBoost,
  isOutsideRoad,
  PhysicsWorld,
  type BoxSpec,
} from '../../client/host/physics';

function road(lengthZ: number, centerZ: number): BoxSpec {
  return { center: [0, -0.5, centerZ], halfExtents: [12, 0.5, lengthZ / 2] };
}

describe('PhysicsWorld', () => {
  it('부착 보조는 줄에 수직인 전방 접선으로만 적용한다', () => {
    const origin: [number, number, number] = [0, 18, 0];
    const anchor: [number, number, number] = [12, 24, -20];
    const boost = forwardSwingBoost(origin, anchor, 6);
    const axisLength = Math.hypot(12, 6, -20);
    const dot = (boost[0] * 12 + boost[1] * 6 + boost[2] * -20) / axisLength;
    // 크기는 speed × sin(전방과 줄 축 사이 각).
    const sine = Math.sqrt(1 - (20 / axisLength) ** 2);

    expect(Math.hypot(...boost)).toBeCloseTo(6 * sine);
    expect(dot).toBeCloseTo(0, 8);
    expect(boost[2]).toBeLessThan(0);
  });

  it('줄이 전방과 나란할수록 부착 보조가 작아진다', () => {
    const origin: [number, number, number] = [0, 18, 0];
    // 멀리 있는 정면 표적. 접선이 거의 0이므로 보조도 거의 없어야 한다.
    const nearForward = forwardSwingBoost(origin, [12, 24, -68], 6);
    // 옆으로 뻗은 표적. 전방이 줄과 수직이라 보조가 최대다.
    const perpendicular = forwardSwingBoost(origin, [12, 18, 0], 6);

    expect(Math.hypot(...nearForward)).toBeLessThan(1.5);
    expect(Math.hypot(...perpendicular)).toBeCloseTo(6);
  });

  it('줄 축이 전방과 완전히 나란하면 보조가 없다', () => {
    expect(Math.hypot(...forwardSwingBoost([0, 18, 0], [0, 18, -30], 6))).toBe(0);
    expect(Math.hypot(...forwardSwingBoost([0, 18, 0], [0, 18, 0], 6))).toBe(0);
  });

  it('도로 밖에서 바닥 높이까지 떨어지면 이탈로 판정한다', () => {
    expect(isOutsideRoad([11.6, 0, 0], 24, 0.4)).toBe(false);
    expect(isOutsideRoad([11.7, 1, 0], 24, 0.4)).toBe(false);
    expect(isOutsideRoad([11.7, 0, 0], 24, 0.4)).toBe(true);
    expect(isOutsideRoad([-11.7, -1, 0], 24, 0.4)).toBe(true);
  });

  it('바닥에 닿으면 종료 조건을 감지한다', async () => {
    const physics = await PhysicsWorld.create();
    physics.addChunk(0, road(120, 0), []);
    physics.createPlayer([0, 2, 0]);

    let touched = false;
    for (let i = 0; i < 300 && !touched; i++) {
      physics.step();
      touched = physics.didTouchGroundThisStep();
    }
    expect(touched).toBe(true);
    physics.dispose();
  });

  it('앵커에 가까워져도 줄이 느슨해지지 않고 고정 길이로 되돌린다', async () => {
    const physics = await PhysicsWorld.create();
    physics.addChunk(0, road(1000, -500), []); // 낙하 중 바닥에 닿지 않도록 아래로 치운다
    const ropeLength = 20;
    // 줄 길이보다 가까운 곳에서 시작한다. 최대 거리만 막는 줄이라면 그대로 자유낙하한다.
    physics.createPlayer([0, 60 - 12, 0]);
    physics.attach([0, 60, 0], ropeLength);

    for (let i = 0; i < 120; i++) physics.step();
    const attachment = physics.attachment!;
    // 부착 직후 짧은 당김만큼 짧아진 길이로 고정된다.
    const fixedLength = ropeLength - gameConfig.physics.attachPullDistanceM;
    expect(attachment.length).toBeCloseTo(fixedLength, 6);
    expect(Math.abs(attachment.distance - fixedLength)).toBeLessThanOrEqual(0.1);
    physics.dispose();
  });

  it('줄 해제는 속도를 그대로 보존한다', async () => {
    const physics = await PhysicsWorld.create();
    physics.addChunk(0, road(1000, -500), []);
    physics.createPlayer([0, 50, 0]);
    physics.attach([0, 55, 0], 5); // 팽팽한 줄로 몇 스텝 스윙시킨다
    for (let i = 0; i < 10; i++) physics.step();

    const beforeRelease = physics.getPlayerVelocity();
    physics.detach();
    const afterRelease = physics.getPlayerVelocity();

    expect(afterRelease).toEqual(beforeRelease);
    physics.dispose();
  });

  it('회수한 구간의 건물은 더 이상 조준에 맞지 않고 남은 구간의 바닥은 그대로 동작한다', async () => {
    const physics = await PhysicsWorld.create();
    physics.addChunk(0, road(60, -30), [{ center: [20, 20, -30], halfExtents: [6, 20, 9] }]);
    physics.addChunk(1, road(60, -90), [{ center: [20, 20, -90], halfExtents: [6, 20, 9] }]);
    physics.createPlayer([0, 20, -30]);
    physics.step(); // Rapier 질의 구조는 step 이후에 갱신된다

    expect(physics.raycastBuilding([0, 20, -90], [1, 0, 0], 70)).not.toBeNull();
    physics.removeChunk(1);
    expect(physics.raycastBuilding([0, 20, -90], [1, 0, 0], 70)).toBeNull();
    // 남은 구간 0의 건물과 바닥은 유지된다.
    expect(physics.raycastBuilding([0, 20, -30], [1, 0, 0], 70)).not.toBeNull();

    physics.setPlayerPosition([0, 2, -30]);
    let touched = false;
    for (let i = 0; i < 300 && !touched; i++) {
      physics.step();
      touched = physics.didTouchGroundThisStep();
    }
    expect(touched).toBe(true);
    physics.dispose();
  });
});

describe('고정 길이 줄 구속', () => {
  // 부착과 무관하게 바닥이 끼어들지 않도록 도로를 아주 먼 z로 치운다.
  const FAR_ROAD = road(10, -5000);
  const START: [number, number, number] = [0, 18, 0];
  // 앞쪽 위 건물 벽면에 해당하는 앵커. rope joint로는 여기가 끝까지 느슨해 힘이 전혀 안 걸렸다.
  const ANCHOR: [number, number, number] = [12, 30, -23];
  const ANCHOR_DISTANCE = Math.hypot(12, 12, 23);
  const PULL_DISTANCE = gameConfig.physics.attachPullDistanceM;
  // 0.6m를 3m/s로 당기므로 12스텝(0.2초)이다.
  const PULL_STEPS = Math.ceil(
    PULL_DISTANCE / (gameConfig.physics.attachPullSpeed * gameConfig.physics.fixedTimestepSec),
  );

  async function run(attached: boolean, steps: number) {
    const physics = await PhysicsWorld.create();
    physics.addChunk(0, FAR_ROAD, []);
    physics.createPlayer(START);
    physics.setPlayerVelocity([0, 0, -gameConfig.physics.forwardSpeed]);
    if (attached) physics.attach(ANCHOR, ANCHOR_DISTANCE);
    for (let i = 0; i < steps; i++) physics.step();
    return physics;
  }

  it('짧은 당김이 끝나면 길이를 고정하고 3초 동안 앵커 거리를 유지한다', async () => {
    const physics = await run(true, 0);
    expect(physics.attachment!.length).toBeCloseTo(ANCHOR_DISTANCE, 6);
    const fixedLength = ANCHOR_DISTANCE - PULL_DISTANCE;

    // 당김이 끝난 뒤(12스텝) 길이가 더 줄지 않는지 본다.
    for (let i = 0; i < PULL_STEPS; i++) physics.step();
    expect(physics.attachment!.length).toBeCloseTo(fixedLength, 6);

    let maxError = 0;
    for (let i = 0; i < 180; i++) {
      physics.step();
      const attachment = physics.attachment!;
      // 당김은 부착당 한 번이다. 이후 길이는 그대로다.
      expect(attachment.length).toBeCloseTo(fixedLength, 6);
      maxError = Math.max(maxError, Math.abs(attachment.distance - attachment.length));
    }
    expect(maxError).toBeLessThanOrEqual(0.1);
    physics.dispose();
  });

  it('첫 물리 스텝부터 안쪽으로 당기는 반경 방향 속도가 생긴다', async () => {
    const physics = await run(true, 1);
    const [px, py, pz] = physics.getPlayerPosition();
    const dx = px - ANCHOR[0];
    const dy = py - ANCHOR[1];
    const dz = pz - ANCHOR[2];
    const distance = Math.hypot(dx, dy, dz);
    const v = physics.getPlayerVelocity();
    const radial = (v[0] * dx + v[1] * dy + v[2] * dz) / distance;

    // 당김 속도(안쪽 3m/s)에 한 스텝의 중력 적분분(9.81/60 ≈ 0.16m/s)만 더해진다. 구속이
    // 없다면 부착 순간의 반경 방향 속도(전방 속도의 줄 축 성분)가 그대로 남아 부호부터 다르다.
    expect(radial).toBeLessThan(0);
    expect(Math.abs(radial + gameConfig.physics.attachPullSpeed)).toBeLessThan(0.5);
    physics.dispose();
  });

  it('가까운 표적과 먼 표적을 같은 거리·속도로 당긴다', async () => {
    for (const anchor of [
      [3, 18, 0], // 최소 사거리
      [6, 22, -6],
      [10, 40, -55],
      [0, 88, 0], // 최대 사거리
    ] as [number, number, number][]) {
      const physics = await PhysicsWorld.create();
      physics.addChunk(0, FAR_ROAD, []);
      physics.createPlayer(START);
      const distance = Math.hypot(anchor[0] - START[0], anchor[1] - START[1], anchor[2] - START[2]);
      physics.attach(anchor, distance);

      physics.step();
      // 한 스텝에 줄어드는 길이는 표적 거리와 무관하게 3m/s × dt다.
      expect(physics.attachment!.length).toBeCloseTo(
        distance - gameConfig.physics.attachPullSpeed * gameConfig.physics.fixedTimestepSec,
        6,
      );
      // 설정된 줄 길이뿐 아니라 실제 플레이어도 첫 스텝부터 앵커에 가까워져야 한다.
      expect(distance - physics.attachment!.distance).toBeGreaterThan(0.04);

      for (let i = 0; i < PULL_STEPS + 60; i++) physics.step();
      expect(physics.attachment!.length).toBeCloseTo(distance - PULL_DISTANCE, 6);
      expect(Math.abs(physics.attachment!.distance - physics.attachment!.length)).toBeLessThan(0.1);
      physics.dispose();
    }
  });

  it('당김 도중 해제하면 속도를 보존하고 재부착하면 당김이 다시 시작된다', async () => {
    const physics = await run(true, 3); // 당김(12스텝) 도중
    const beforeRelease = physics.getPlayerVelocity();
    physics.detach();
    expect(physics.getPlayerVelocity()).toEqual(beforeRelease);

    const position = physics.getPlayerPosition();
    const distance = Math.hypot(
      position[0] - ANCHOR[0],
      position[1] - ANCHOR[1],
      position[2] - ANCHOR[2],
    );
    physics.attach(ANCHOR, distance);
    for (let i = 0; i < PULL_STEPS + 30; i++) physics.step();
    // 새 부착이므로 남은 당김이 아니라 다시 0.6m를 당긴다.
    expect(physics.attachment!.length).toBeCloseTo(distance - PULL_DISTANCE, 6);
    physics.dispose();
  });

  it('당김 도중 해제한 다음 스텝부터는 줄 구속 없이 자유비행한다', async () => {
    const physics = await run(true, 3);
    const free = await PhysicsWorld.create();
    try {
      free.addChunk(0, FAR_ROAD, []);
      free.createPlayer(physics.getPlayerPosition());
      free.setPlayerVelocity(physics.getPlayerVelocity());
      physics.detach();
      for (let step = 0; step < 30; step++) {
        physics.step();
        free.step();
        expect(physics.attachment).toBeNull();
        physics.getPlayerPosition().forEach((value, axis) => {
          expect(value).toBeCloseTo(free.getPlayerPosition()[axis]!, 5);
        });
        physics.getPlayerVelocity().forEach((value, axis) => {
          expect(value).toBeCloseTo(free.getPlayerVelocity()[axis]!, 5);
        });
      }
    } finally {
      physics.dispose();
      free.dispose();
    }
  });

  it('당기는 경로에 벽이 있어도 관통하지 않고 해제 후 벽에서 벗어날 수 있다', async () => {
    const physics = await PhysicsWorld.create();
    try {
      // 당김 도중 옆 건물과 충돌하는 상황. 앵커는 경로 너머의 고정점이다.
      const wallX = 0.65;
      physics.addChunk(0, FAR_ROAD, [{ center: [wallX + 1, 50, 0], halfExtents: [1, 30, 30] }]);
      physics.createPlayer([0, 50, 0]);
      physics.attach([3, 50, 0], 3);
      let closestX = 0;
      for (let step = 0; step < PULL_STEPS + 30; step++) {
        physics.step();
        const [x] = physics.getPlayerPosition();
        closestX = Math.max(closestX, x);
        expect(x).toBeLessThanOrEqual(wallX - gameConfig.physics.playerRadius + 0.02);
        expect(physics.getPlayerVelocity().every(Number.isFinite)).toBe(true);
      }
      expect(closestX).toBeGreaterThan(0.2);
      physics.detach();
      physics.setPlayerVelocity([-3, 0, 0]);
      for (let step = 0; step < 12; step++) physics.step();
      expect(physics.getPlayerPosition()[0]).toBeLessThan(0);
    } finally {
      physics.dispose();
    }
  });

  it('부착하면 자유낙하와 궤적이 달라진다', async () => {
    const steps = 120; // 2초. 자유낙하라면 이미 바닥 높이를 지난다.
    const attached = await run(true, steps);
    const free = await run(false, steps);
    const attachedY = attached.getPlayerPosition()[1];
    const freeY = free.getPlayerPosition()[1];
    attached.dispose();
    free.dispose();

    expect(attachedY).toBeGreaterThan(freeY + 5);
  });

  it('전방 상향 앵커에서 전방으로 나아가고 하강 후 다시 올라온다', async () => {
    const physics = await run(true, 0);
    const ys: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < 180; i++) {
      physics.step();
      const [, y, z] = physics.getPlayerPosition();
      ys.push(y);
      zs.push(z);
    }
    physics.dispose();

    // 3초 안에 전방(-Z)으로 5m 이상 나아간다.
    expect(Math.min(...zs)).toBeLessThan(START[2] - 5);
    // 중력으로 내려갔다가 진자가 다시 밀어 올리는 구간이 있어야 스윙이다.
    const lowest = Math.min(...ys);
    expect(lowest).toBeLessThan(START[1] - 1);
    expect(Math.max(...ys.slice(ys.lastIndexOf(lowest)))).toBeGreaterThan(lowest + 0.5);
  });

  it('반경 방향 속도는 양방향으로 지우고 접선 속도는 남긴다', async () => {
    const physics = await PhysicsWorld.create();
    physics.addChunk(0, FAR_ROAD, []);
    physics.createPlayer([0, 50, 0]);
    physics.attach([0, 60, 0], 10); // 현재 거리 10에 딱 맞는 줄
    // 앵커에서 멀어지는(아래) 성분과 접선(+X) 성분을 같이 준다.
    physics.setPlayerVelocity([8, -6, 0]);
    physics.step();

    const [vx, vy] = physics.getPlayerVelocity();
    expect(vx).toBeCloseTo(8, 1); // 접선은 보존
    // 멀어지는 성분은 지워지고, 당김이 앵커 쪽(위)으로 3m/s를 만든 뒤 한 스텝의 중력분만 빠진다.
    expect(
      Math.abs(
        vy -
          gameConfig.physics.attachPullSpeed +
          gameConfig.physics.gravity * gameConfig.physics.fixedTimestepSec,
      ),
    ).toBeLessThan(0.05);
    physics.dispose();
  });

  it('오래 매달려도 앵커 거리가 줄 길이에서 누적해 벗어나지 않는다', async () => {
    // 위치를 직접 옮기지 않고 속도로만 보정하므로, 오차가 커지지 않는지가 핵심이다.
    const physics = await run(true, 60);
    let maxError = 0;
    for (let i = 0; i < 600; i++) {
      physics.step();
      const attachment = physics.attachment!;
      maxError = Math.max(maxError, Math.abs(attachment.distance - attachment.length));
    }
    expect(maxError).toBeLessThanOrEqual(0.2);
    physics.dispose();
  });
});

describe('sweepBuilding', () => {
  it('스윕은 닿아도 접촉점이 70m 밖이면 발사 표적에서 제외한다', async () => {
    const physics = await PhysicsWorld.create();
    try {
      physics.addChunk(0, road(200, -100), [{ center: [20, 25, -79], halfExtents: [8, 25, 9] }]);
      physics.createPlayer([10, 20, 0]);
      physics.step();
      const origin: [number, number, number] = [10, 20, 0];
      const hit = physics.sweepBuilding(origin, [0, 0, -1], 70, 2.5);
      expect(hit).not.toBeNull();
      expect(hit!.distance).toBeGreaterThan(70);
      expect(selectTarget(origin, [0, 0, -1], physics, defaultSwingOptions())).toBeNull();
    } finally {
      physics.dispose();
    }
  });

  // 건물 벽면(x=12)을 정면 -Z 방향 20m 앞에 둔다.
  const WALL = {
    center: [20, 25, -20] as [number, number, number],
    halfExtents: [8, 25, 9] as [number, number, number],
  };

  async function worldWithWall() {
    const physics = await PhysicsWorld.create();
    physics.addChunk(0, road(200, -100), [WALL]);
    physics.createPlayer([0, 20, 0]);
    physics.step(); // Rapier 질의 구조는 step 이후에 갱신된다
    return physics;
  }

  it('조준선이 벽을 빗나가도 보정 반경 안이면 접촉점을 돌려준다', async () => {
    const physics = await worldWithWall();
    // 벽은 x >= 12인데 x=10 선을 따라 쏜다. 직접 raycast는 못 맞히고 반경 2.5m 스윕이 잡는다.
    const origin: [number, number, number] = [10, 20, 0];
    expect(physics.raycastBuilding(origin, [0, 0, -1], 70)).toBeNull();

    const swept = physics.sweepBuilding(origin, [0, 0, -1], 70, 2.5);
    expect(swept).not.toBeNull();
    // 접촉점은 실제 벽면 위에 있어야 한다(안쪽 면 x=12).
    expect(swept!.point[0]).toBeCloseTo(12, 1);
    physics.dispose();
  });

  it('보정 반경 밖이면 표적이 없다', async () => {
    const physics = await worldWithWall();
    expect(physics.sweepBuilding([0, 20, 0], [0, 0, -1], 70, 2.5)).toBeNull();
    physics.dispose();
  });

  it('가까운 건물만 돌려준다(가림이 내재적으로 걸러진다)', async () => {
    const physics = await PhysicsWorld.create();
    physics.addChunk(0, road(400, -200), [
      { center: [0, 25, -30], halfExtents: [8, 25, 5] }, // 앞
      { center: [0, 25, -60], halfExtents: [8, 25, 5] }, // 뒤 (가려짐)
    ]);
    physics.createPlayer([0, 20, 0]);
    physics.step();

    const swept = physics.sweepBuilding([0, 20, 0], [0, 0, -1], 70, 2.5);
    expect(swept).not.toBeNull();
    expect(swept!.point[2]).toBeCloseTo(-25, 1); // 앞 건물의 앞면
    physics.dispose();
  });
});
