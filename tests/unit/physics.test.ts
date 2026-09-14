import { describe, expect, it } from 'vitest';
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
