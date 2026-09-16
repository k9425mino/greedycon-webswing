import { describe, expect, it } from 'vitest';
import { gameConfig } from '@shared/config';
import { defaultSwingOptions, selectTarget } from '../../client/host/web';
import { isOutsideRoad, PhysicsWorld, type BoxSpec } from '../../client/host/physics';

function road(lengthZ: number, centerZ: number): BoxSpec {
  return { center: [0, -0.5, centerZ], halfExtents: [12, 0.5, lengthZ / 2] };
}

describe('PhysicsWorld', () => {
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

  it('줄 해제는 속도를 그대로 보존한다', async () => {
    const physics = await PhysicsWorld.create();
    physics.addChunk(0, road(1000, -500), []);
    physics.createPlayer([0, 50, 0]);
    physics.attach([0, 55, 0]); // 보조를 받는 상태로 몇 스텝 날린다
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

describe('부착 중 전방 보조와 당김', () => {
  // 부착과 무관하게 바닥이 끼어들지 않도록 도로를 아주 먼 z로 치운다.
  const FAR_ROAD = road(10, -5000);
  const START: [number, number, number] = [0, 18, 0];
  // 앞쪽 위 건물 벽면에 해당하는 앵커.
  const ANCHOR: [number, number, number] = [12, 30, -23];
  const DT = gameConfig.physics.fixedTimestepSec;

  async function run(attached: boolean, steps: number, anchor = ANCHOR) {
    const physics = await PhysicsWorld.create();
    physics.addChunk(0, FAR_ROAD, []);
    physics.createPlayer(START);
    physics.setPlayerVelocity([0, 0, -gameConfig.physics.forwardSpeed]);
    if (attached) physics.attach(anchor);
    for (let i = 0; i < steps; i++) physics.step();
    return physics;
  }

  // 한 스텝의 속도 변화만 보는 경우. 초기 속도를 0으로 둬 보조 성분을 그대로 읽는다.
  async function oneStepDelta(anchor: [number, number, number], from: [number, number, number]) {
    const physics = await PhysicsWorld.create();
    physics.addChunk(0, FAR_ROAD, []);
    physics.createPlayer(from);
    physics.setPlayerVelocity([0, 0, 0]);
    physics.attach(anchor);
    physics.step();
    const [vx, vy, vz] = physics.getPlayerVelocity();
    physics.dispose();
    // 중력은 y에만 들어가므로 빼고 본다.
    return { vx, vy: vy + gameConfig.physics.gravity * DT, vz };
  }

  it('전진 속도를 목표까지 올리고 그 위로는 가속하지 않는다', async () => {
    const physics = await run(true, 600); // 10초
    const forwardSpeed = -physics.getPlayerVelocity()[2];
    expect(forwardSpeed).toBeCloseTo(gameConfig.physics.assistForwardTargetSpeed, 3);
    physics.dispose();
  });

  it('이미 목표보다 빠르면 전방 속도를 건드리지 않는다', async () => {
    const physics = await PhysicsWorld.create();
    physics.addChunk(0, FAR_ROAD, []);
    physics.createPlayer(START);
    const fast = gameConfig.physics.assistForwardTargetSpeed + 7;
    physics.setPlayerVelocity([0, 0, -fast]);
    physics.attach(ANCHOR);
    for (let i = 0; i < 10; i++) physics.step();
    expect(-physics.getPlayerVelocity()[2]).toBeCloseTo(fast, 6);
    physics.dispose();
  });

  it('좌우 당김은 부착점 방향으로 대칭이다', async () => {
    const right = await oneStepDelta([12, 18, -20], START);
    const left = await oneStepDelta([-12, 18, -20], START);

    expect(right.vx).toBeGreaterThan(0);
    expect(right.vx).toBeCloseTo(-left.vx, 6);
    expect(right.vz).toBeCloseTo(left.vz, 6);
  });

  it('높은 부착점은 위로, 낮은 부착점은 아래로 당긴다', async () => {
    const high = await oneStepDelta([12, 40, -20], START);
    const low = await oneStepDelta([12, 6, -20], START);

    expect(high.vy).toBeGreaterThan(0);
    expect(low.vy).toBeLessThan(0);
  });

  it('부착점 앞 5m 안에서는 보조가 선형으로 줄어든다', async () => {
    const fade = gameConfig.physics.assistFadeDistanceM;
    // 정면 부착점이라 좌우·상하 성분 없이 전방 보조만 남는다.
    const far = await oneStepDelta([0, 18, -4 * fade], START);
    const near = await oneStepDelta([0, 18, -fade / 2], START);

    expect(-far.vz).toBeCloseTo(gameConfig.physics.assistForwardAccel * DT, 6);
    expect(-near.vz).toBeCloseTo(gameConfig.physics.assistForwardAccel * DT * 0.5, 6);
  });

  it('부착점을 지나가면 보조가 끝나고 뒤로 밀려도 다시 켜지지 않는다', async () => {
    const anchor: [number, number, number] = [12, 30, -30];
    const physics = await run(true, 0, anchor);
    expect(physics.attachment!.assisting).toBe(true);

    for (let i = 0; i < 300 && physics.attachment!.assisting; i++) physics.step();
    expect(physics.getPlayerPosition()[2]).toBeLessThanOrEqual(anchor[2]);
    expect(physics.attachment!.assisting).toBe(false);

    // 뒤로 되돌려도 보조는 끝난 채다.
    physics.setPlayerPosition([0, 30, 0]);
    physics.step();
    expect(physics.attachment!.assisting).toBe(false);
    physics.dispose();
  });

  it('보조가 끝나도 부착은 유지되고 해제 전까지 앵커 거리를 그대로 보고한다', async () => {
    const anchor: [number, number, number] = [12, 30, -30];
    const physics = await run(true, 0, anchor);
    for (let i = 0; i < 300 && physics.attachment!.assisting; i++) physics.step();

    const attachment = physics.attachment!;
    expect(physics.isAttached).toBe(true);
    const [px, py, pz] = physics.getPlayerPosition();
    expect(attachment.distance).toBeCloseTo(
      Math.hypot(px - anchor[0], py - anchor[1], pz - anchor[2]),
      6,
    );
    physics.dispose();
  });

  it('해제하면 속도를 보존하고 다음 스텝부터 보조 없이 자유비행한다', async () => {
    const physics = await run(true, 20);
    const free = await PhysicsWorld.create();
    try {
      free.addChunk(0, FAR_ROAD, []);
      free.createPlayer(physics.getPlayerPosition());
      free.setPlayerVelocity(physics.getPlayerVelocity());
      const beforeRelease = physics.getPlayerVelocity();
      physics.detach();
      expect(physics.getPlayerVelocity()).toEqual(beforeRelease);

      for (let step = 0; step < 30; step++) {
        physics.step();
        free.step();
        expect(physics.attachment).toBeNull();
        physics.getPlayerPosition().forEach((value, axis) => {
          expect(value).toBeCloseTo(free.getPlayerPosition()[axis]!, 5);
        });
      }
    } finally {
      physics.dispose();
      free.dispose();
    }
  });

  it('높은 부착점에 걸면 0.5초 안에 실제로 올라간다', async () => {
    // 낙하 지연이 아니라 상승인지 본다. 충돌·페이드가 끼어들지 않는 먼 부착점이다.
    const physics = await run(true, 30, [12, 42, -40]);
    const [, y] = physics.getPlayerPosition();
    const vy = physics.getPlayerVelocity()[1];
    physics.dispose();

    expect(y).toBeGreaterThan(START[1] + 1);
    expect(vy).toBeGreaterThan(0);
  });

  it('부착 직후 0.5초 안에 전진 속도가 뚜렷하게 오른다', async () => {
    const physics = await run(true, 30, [12, 42, -40]);
    const forwardSpeed = -physics.getPlayerVelocity()[2];
    physics.dispose();

    expect(forwardSpeed).toBeGreaterThan(gameConfig.physics.forwardSpeed + 8);
  });

  it('부착하면 자유낙하와 궤적이 달라진다', async () => {
    const steps = 120; // 2초. 자유낙하라면 이미 바닥 높이를 지난다.
    const attached = await run(true, steps);
    const free = await run(false, steps);
    const attachedY = attached.getPlayerPosition()[1];
    const attachedZ = attached.getPlayerPosition()[2];
    const freeY = free.getPlayerPosition()[1];
    const freeZ = free.getPlayerPosition()[2];
    attached.dispose();
    free.dispose();

    expect(attachedY).toBeGreaterThan(freeY + 5);
    // 전방 보조가 있으므로 자유비행보다 더 멀리 나아간다.
    expect(attachedZ).toBeLessThan(freeZ - 1);
  });

  it('당기는 경로에 벽이 있어도 관통하지 않는다', async () => {
    const physics = await PhysicsWorld.create();
    try {
      const wallX = 0.65;
      physics.addChunk(0, FAR_ROAD, [{ center: [wallX + 1, 50, -60], halfExtents: [1, 30, 60] }]);
      physics.createPlayer([0, 50, 0]);
      physics.attach([3, 50, -40]);
      for (let step = 0; step < 120; step++) {
        physics.step();
        expect(physics.getPlayerPosition()[0]).toBeLessThanOrEqual(
          wallX - gameConfig.physics.playerRadius + 0.02,
        );
        expect(physics.getPlayerVelocity().every(Number.isFinite)).toBe(true);
      }
    } finally {
      physics.dispose();
    }
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

  it('직접 명중과 스윕은 부착 자국에 사용할 벽의 바깥 법선을 전달한다', async () => {
    const physics = await worldWithWall();
    try {
      const origin: [number, number, number] = [0, 20, -20];
      const direct = physics.raycastBuilding(origin, [1, 0, 0], 70);
      const swept = physics.sweepBuilding(origin, [1, 0, 0], 70, 2.5);
      for (const hit of [direct, swept]) {
        expect(hit?.normal?.[0]).toBeCloseTo(-1);
        expect(hit?.normal?.[1]).toBeCloseTo(0);
        expect(hit?.normal?.[2]).toBeCloseTo(0);
      }
    } finally {
      physics.dispose();
    }
  });

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
