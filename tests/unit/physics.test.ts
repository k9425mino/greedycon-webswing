import { describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../../client/host/physics';

describe('PhysicsWorld', () => {
  it('바닥에 닿으면 종료 조건을 감지한다', async () => {
    const physics = await PhysicsWorld.create();
    physics.createGround(24, 120, 0);
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
    physics.createGround(24, 1000, -500); // 낙하 중 바닥에 닿지 않도록 아래로 치운다
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
    physics.createGround(24, 1000, -500);
    physics.createPlayer([0, 50, 0]);
    physics.attach([0, 55, 0], 5); // 팽팽한 줄로 몇 스텝 스윙시킨다
    for (let i = 0; i < 10; i++) physics.step();

    const beforeRelease = physics.getPlayerVelocity();
    physics.detach();
    const afterRelease = physics.getPlayerVelocity();

    expect(afterRelease).toEqual(beforeRelease);
    physics.dispose();
  });
});
