import { describe, expect, it } from 'vitest';
import { PhysicsWorld, type BoxSpec } from '../../client/host/physics';

function road(lengthZ: number, centerZ: number): BoxSpec {
  return { center: [0, -0.5, centerZ], halfExtents: [12, 0.5, lengthZ / 2] };
}

describe('PhysicsWorld', () => {
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

  it('느슨한 줄은 팽팽해지기 전까지 밀어내지 않는다', async () => {
    const physics = await PhysicsWorld.create();
    physics.addChunk(0, road(1000, -500), []); // 낙하 중 바닥에 닿지 않도록 아래로 치운다
    physics.createPlayer([0, 50, 0]);
    physics.attach([0, 60, 0], 20); // 현재 거리 10, 줄 길이 20 (느슨함)

    physics.step();
    physics.step();
    const [, vy] = physics.getPlayerVelocity();
    // 중력만 작용해 자유낙하와 거의 같은 속도여야 한다 (줄이 당기지 않음)
    const expectedFreeFallVy = -9.81 * (2 / 60);
    expect(vy).toBeCloseTo(expectedFreeFallVy, 1);
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
