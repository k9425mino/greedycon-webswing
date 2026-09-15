import { describe, expect, it } from 'vitest';
import { gameConfig } from '@shared/config';
import { PhysicsWorld, type Vec3 } from '../../client/host/physics';
import { ChunkedWorld } from '../../client/host/world';
import { defaultSwingOptions, selectTarget, WebSwing } from '../../client/host/web';
import { aimAnglesFromOrientation, anglesToDirection, clampAimAngles } from '../../client/host/aim';
import { applyScreenOrientation, orientationToQuaternion } from '../../client/controller/sensor';

// 폰 자세부터 실제 Rapier 스윙까지를 한 번에 고정한다. 조준각·표적 선택·부착·보조는 모두 제품
// 코드를 그대로 쓰고, main.ts의 프레임 루프에 해당하는 호출 순서만 여기서 재현한다.

const FORWARD = applyScreenOrientation(orientationToQuaternion(0, 0, 0), 0);

function aimDirectionFor(alpha: number, beta: number): Vec3 {
  const orientation = applyScreenOrientation(orientationToQuaternion(alpha, beta, 0), 0);
  return anglesToDirection(clampAimAngles(aimAnglesFromOrientation(orientation, FORWARD)));
}

async function createRun() {
  const physics = await PhysicsWorld.create();
  const world = new ChunkedWorld({
    onAdd: (chunk) => physics.addChunk(chunk.index, chunk.road, chunk.buildings),
    onRemove: (chunkIndex) => physics.removeChunk(chunkIndex),
  });
  physics.createPlayer(world.startPosition);
  world.reset();
  physics.setPlayerVelocity([0, 0, -gameConfig.physics.forwardSpeed]);
  const swing = new WebSwing(physics, defaultSwingOptions());
  // Rapier의 질의 구조는 step 이후에 갱신된다. 구간 콜라이더를 붙인 직후 첫 step 전에는 raycast가
  // 건물을 보지 못하므로, 사람이 실제로 손을 대는 시점(시작 후 최소 한 프레임 뒤)에 맞춰 한 번 돌린다.
  physics.step();
  return { physics, world, swing };
}

describe('폰 조준으로 시작하는 실제 스윙', () => {
  it('높은 표적에 부착하면 보조를 받는 동안 전방으로 나아가고 고도를 잃지 않는다', async () => {
    const { physics, swing } = await createRun();
    // 팔 오른쪽 30도, 손목 위 30도.
    const direction = aimDirectionFor(-30, 30);

    const dt = gameConfig.physics.fixedTimestepSec;
    const samples: { y: number; z: number; forwardSpeed: number }[] = [];
    let attachedAt: number | null = null;

    // 보조가 끝날 때까지(부착점을 지날 때까지) 관찰한다. 그 뒤로는 자유낙하라 바닥에 닿는다.
    for (let step = 0; step < 180; step++) {
      const origin = physics.getPlayerPosition();
      swing.update(true, step * dt, origin, direction, {
        onAttach: (target) => {
          physics.attach(target.point);
          attachedAt = step;
        },
        onRelease: () => physics.detach(),
      });
      physics.step();
      expect(physics.didTouchGroundThisStep()).toBe(false);
      const attachment = physics.attachment;
      if (!attachment?.assisting) {
        if (attachedAt !== null) break;
        continue;
      }
      const [, y, z] = physics.getPlayerPosition();
      samples.push({ y, z, forwardSpeed: -physics.getPlayerVelocity()[2] });
    }

    expect(attachedAt).not.toBeNull();
    expect(samples.length).toBeGreaterThan(30);
    // 전방(-Z)으로 계속 나아가고, 전진 속도가 시작 속도보다 빨라진다.
    expect(samples.at(-1)!.z).toBeLessThan(samples[0]!.z - 10);
    expect(samples.at(-1)!.forwardSpeed).toBeGreaterThan(gameConfig.physics.forwardSpeed);
    expect(Math.max(...samples.map((sample) => sample.forwardSpeed))).toBeLessThanOrEqual(
      gameConfig.physics.assistForwardTargetSpeed + 1e-6,
    );
    // 위쪽 벽면에 걸었으므로 보조를 받는 동안에는 크게 떨어지지 않는다.
    const ys = samples.map((sample) => sample.y);
    expect(Math.min(...ys)).toBeGreaterThan(ys[0]! - 5);

    physics.dispose();
  });

  it('낮은 앵커에 걸면 아래로 당겨져 바닥에 닿는다', async () => {
    const { physics } = await createRun();
    // 낮은 벽면도 조준한 그대로 부착된다. 부착이 추락을 막아 주지는 않는다.
    physics.attach([12, 3, -20]);

    let touched = false;
    for (let step = 0; step < 600 && !touched; step++) {
      physics.step();
      touched = physics.didTouchGroundThisStep();
    }

    expect(touched).toBe(true);
    // 부착을 유지한 채로도 바닥 접촉이 감지된다(안전 표적 변경이나 추락 방지 보정이 없다).
    expect(physics.isAttached).toBe(true);
    physics.dispose();
  });
});

describe('벽면 높이와 표적 선택', () => {
  it('위쪽·수평·아래쪽 벽면을 모두 표적으로 잡는다', async () => {
    const { physics } = await createRun();
    const origin = physics.getPlayerPosition();
    const options = defaultSwingOptions();

    for (const pitch of [30, 5, -10]) {
      const target = selectTarget(origin, aimDirectionFor(-30, pitch), physics, options);
      expect(target).not.toBeNull();
      // 조준한 방향의 벽면이며, 위로 올려 옮기지 않는다.
      expect(Math.sign(target!.point[1] - origin[1])).toBe(Math.sign(pitch));
    }
    physics.dispose();
  });

  it('빈 하늘은 표적이 없다', async () => {
    const { physics } = await createRun();
    const origin = physics.getPlayerPosition();
    // 도로 한가운데서 거의 수직으로 올려보면 건물 벽면에 닿지 않는다.
    expect(selectTarget(origin, aimDirectionFor(0, 70), physics, defaultSwingOptions())).toBeNull();
    physics.dispose();
  });
});
