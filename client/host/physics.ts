import RAPIER from '@dimforge/rapier3d-compat';
import { gameConfig } from '@shared/config';
import type { TargetHit, TargetQuery } from './web';

export type Vec3 = [number, number, number];

export type BoxSpec = {
  center: Vec3;
  halfExtents: Vec3;
};

export function isOutsideRoad(position: Vec3, roadWidth: number, playerRadius: number): boolean {
  return Math.abs(position[0]) + playerRadius > roadWidth / 2 && position[1] <= 0;
}

export function forwardSwingBoost(origin: Vec3, anchor: Vec3, speed: number): Vec3 {
  const dx = anchor[0] - origin[0];
  const dy = anchor[1] - origin[1];
  const dz = anchor[2] - origin[2];
  const length = Math.hypot(dx, dy, dz);
  if (length === 0) return [0, 0, 0];

  const axis: Vec3 = [dx / length, dy / length, dz / length];
  const forward: Vec3 = [0, 0, -1];
  const projected = forward[0] * axis[0] + forward[1] * axis[1] + forward[2] * axis[2];
  const tangent: Vec3 = [
    forward[0] - projected * axis[0],
    forward[1] - projected * axis[1],
    forward[2] - projected * axis[2],
  ];
  // 접선 길이는 전방과 줄 축이 이루는 각의 sin이다. 정규화하면 줄이 전방에 가까울 때
  // (멀리 있는 정면 표적) 거의 0인 접선이 그대로 최대 속도가 되어 옆·아래로 튄다.
  // 길이를 그대로 곱해 줄이 전방과 수직일 때 speed가 최대가 되게 한다.
  return [tangent[0] * speed, tangent[1] * speed, tangent[2] * speed];
}

let rapierInitialized = false;

async function ensureRapierInit(): Promise<void> {
  if (rapierInitialized) return;
  await RAPIER.init();
  rapierInitialized = true;
}

export class PhysicsWorld implements TargetQuery {
  private world: RAPIER.World;
  private eventQueue: RAPIER.EventQueue;
  private player!: RAPIER.RigidBody;
  private playerCollider!: RAPIER.Collider;
  private groundColliderHandles = new Set<number>();
  private buildingColliderHandles = new Set<number>();
  private chunkBodies = new Map<number, RAPIER.RigidBody[]>();
  private anchor: {
    body: RAPIER.RigidBody;
    joint: RAPIER.ImpulseJoint;
    point: Vec3;
    length: number;
  } | null = null;

  private prevPosition: Vec3 = [0, 0, 0];
  private currPosition: Vec3 = [0, 0, 0];
  private groundedThisStep = false;

  static async create(): Promise<PhysicsWorld> {
    await ensureRapierInit();
    return new PhysicsWorld();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -gameConfig.physics.gravity, z: 0 });
    this.world.timestep = gameConfig.physics.fixedTimestepSec;
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  // 무한 도로는 구간 단위로 콜라이더를 붙였다 뗀다. 한 구간의 body를 모아 두고 회수 시 함께 제거한다.
  addChunk(chunkIndex: number, road: BoxSpec, buildings: BoxSpec[]): void {
    if (this.chunkBodies.has(chunkIndex)) return;
    const bodies: RAPIER.RigidBody[] = [];

    const roadBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(...road.center),
    );
    const roadCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...road.halfExtents).setActiveEvents(
        RAPIER.ActiveEvents.COLLISION_EVENTS,
      ),
      roadBody,
    );
    this.groundColliderHandles.add(roadCollider.handle);
    bodies.push(roadBody);

    for (const building of buildings) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(...building.center),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(...building.halfExtents)
          .setRestitution(gameConfig.physics.buildingRestitution)
          .setFriction(gameConfig.physics.buildingFriction),
        body,
      );
      this.buildingColliderHandles.add(collider.handle);
      bodies.push(body);
    }

    this.chunkBodies.set(chunkIndex, bodies);
  }

  removeChunk(chunkIndex: number): void {
    const bodies = this.chunkBodies.get(chunkIndex);
    if (!bodies) return;
    for (const body of bodies) {
      for (let i = 0; i < body.numColliders(); i++) {
        const handle = body.collider(i).handle;
        this.groundColliderHandles.delete(handle);
        this.buildingColliderHandles.delete(handle);
      }
      this.world.removeRigidBody(body);
    }
    this.chunkBodies.delete(chunkIndex);
  }

  createPlayer(position: Vec3): void {
    const radius = gameConfig.physics.playerRadius;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...position)
        .lockRotations()
        .setCcdEnabled(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(radius).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.player = body;
    this.playerCollider = collider;
    this.prevPosition = position;
    this.currPosition = position;
  }

  setPlayerPosition(position: Vec3): void {
    this.player.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
    this.prevPosition = position;
    this.currPosition = position;
  }

  setPlayerVelocity(velocity: Vec3): void {
    this.player.setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
  }

  applyVelocityDelta(delta: Vec3): void {
    const v = this.player.linvel();
    this.setPlayerVelocity([v.x + delta[0], v.y + delta[1], v.z + delta[2]]);
  }

  getPlayerPosition(): Vec3 {
    const t = this.player.translation();
    return [t.x, t.y, t.z];
  }

  getPlayerVelocity(): Vec3 {
    const v = this.player.linvel();
    return [v.x, v.y, v.z];
  }

  // 고정 60Hz accumulator가 호출하는 한 스텝. ARCHITECTURE 5절: 렌더링은 직전·현재 상태를 보간한다.
  step(): void {
    this.prevPosition = this.currPosition;
    this.world.step(this.eventQueue);
    this.currPosition = this.getPlayerPosition();

    this.groundedThisStep = false;
    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      if (!started) return;
      if (this.groundColliderHandles.has(handle1) || this.groundColliderHandles.has(handle2)) {
        this.groundedThisStep = true;
      }
    });
  }

  didTouchGroundThisStep(): boolean {
    return this.groundedThisStep;
  }

  isOutsideRoad(): boolean {
    return isOutsideRoad(
      this.getPlayerPosition(),
      gameConfig.world.roadWidthM,
      gameConfig.physics.playerRadius,
    );
  }

  // 렌더링용 보간 위치 (alpha: 0=직전, 1=현재).
  interpolatedPosition(alpha: number): Vec3 {
    return [
      this.prevPosition[0] + (this.currPosition[0] - this.prevPosition[0]) * alpha,
      this.prevPosition[1] + (this.currPosition[1] - this.prevPosition[1]) * alpha,
      this.prevPosition[2] + (this.currPosition[2] - this.prevPosition[2]) * alpha,
    ];
  }

  attach(point: Vec3, length: number): void {
    this.detach();
    const anchorBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(...point),
    );
    const joint = this.world.createImpulseJoint(
      RAPIER.JointData.rope(length, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      this.player,
      anchorBody,
      true,
    );
    this.anchor = { body: anchorBody, joint, point, length };
  }

  detach(): void {
    if (!this.anchor) return;
    this.world.removeImpulseJoint(this.anchor.joint, true);
    this.world.removeRigidBody(this.anchor.body);
    this.anchor = null;
  }

  get isAttached(): boolean {
    return this.anchor !== null;
  }

  // 진단용 읽기 전용 부착 정보. Rapier 객체는 노출하지 않는다.
  get attachment(): { point: Vec3; length: number; distance: number } | null {
    if (!this.anchor) return null;
    const [px, py, pz] = this.getPlayerPosition();
    const [ax, ay, az] = this.anchor.point;
    return {
      point: this.anchor.point,
      length: this.anchor.length,
      distance: Math.hypot(px - ax, py - ay, pz - az),
    };
  }

  // TargetQuery 구현 (web.ts의 표적 선택이 사용).
  raycastBuilding(origin: Vec3, direction: Vec3, maxDistance: number): TargetHit | null {
    const ray = new RAPIER.Ray(
      { x: origin[0], y: origin[1], z: origin[2] },
      toRapierVec(direction),
    );
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      true,
      undefined,
      undefined,
      this.playerCollider,
      undefined,
      (collider) => this.buildingColliderHandles.has(collider.handle),
    );
    if (!hit) return null;
    const point = ray.pointAt(hit.timeOfImpact);
    return { point: [point.x, point.y, point.z], distance: hit.timeOfImpact };
  }

  isVisible(origin: Vec3, target: Vec3): boolean {
    const dx = target[0] - origin[0];
    const dy = target[1] - origin[1];
    const dz = target[2] - origin[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < 1e-6) return true;
    const direction: Vec3 = [dx / distance, dy / distance, dz / distance];
    const hit = this.raycastBuilding(origin, direction, distance + 0.05);
    if (!hit) return false;
    return Math.abs(hit.distance - distance) < 0.2;
  }

  dispose(): void {
    this.detach();
    this.world.free();
    this.eventQueue.free();
  }
}

function toRapierVec([x, y, z]: Vec3) {
  return { x, y, z };
}
