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

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

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
  // 앵커는 좌표 데이터일 뿐이다. 줄 길이를 구속하지 않고(고정 길이 진자가 아니다), 부착 중에는
  // 도로 전방 추진과 부착점 방향의 약한 당김만 더한다. assisting은 부착점을 지나가면 꺼지고
  // 다시 켜지지 않는다(해제 전까지 줄은 그대로 보이지만 보조는 끝난다).
  private anchor: {
    point: Vec3;
    assisting: boolean;
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

  // 부착 중 보조. 부착점을 중심으로 도는 진자 대신 도로 전방(-Z)으로 나아가게 하고, 부착점
  // 방향으로 약하게 당긴다(조준 높이가 상하 궤적에 남는다). 속도만 더하므로 중력·충돌은 그대로다.
  private applySwingAssist(dt: number): void {
    const anchor = this.anchor;
    if (!anchor || !anchor.assisting) return;

    const [px, py, pz] = this.getPlayerPosition();
    // 부착점의 Z에 도달하면 이 부착의 보조는 끝난다. 뒤로 밀려도 다시 켜지 않는다.
    const forwardRemaining = pz - anchor.point[2];
    if (forwardRemaining <= 0) {
      anchor.assisting = false;
      return;
    }
    const fade = Math.min(1, forwardRemaining / gameConfig.physics.assistFadeDistanceM);

    const velocity = this.getPlayerVelocity();
    // 전방 보조는 목표 속도까지만 채운다. 이미 빠르면 감속시키지 않는다.
    const forwardSpeed = -velocity[2];
    const forwardGain = Math.max(
      0,
      Math.min(
        gameConfig.physics.assistForwardAccel * fade * dt,
        gameConfig.physics.assistForwardTargetSpeed - forwardSpeed,
      ),
    );

    const dx = anchor.point[0] - px;
    const dy = anchor.point[1] - py;
    const dz = anchor.point[2] - pz;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1e-6) return;

    this.applyVelocityDelta([
      (dx / distance) * gameConfig.physics.assistLateralAccel * fade * dt,
      (dy / distance) * gameConfig.physics.assistVerticalAccel * fade * dt,
      -forwardGain,
    ]);
  }

  // 고정 60Hz accumulator가 호출하는 한 스텝. ARCHITECTURE 5절: 렌더링은 직전·현재 상태를 보간한다.
  step(): void {
    this.prevPosition = this.currPosition;
    // 적분 전에 더해야 Rapier가 보조를 반영한 속도로 한 스텝을 밟는다.
    this.applySwingAssist(this.world.timestep);
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

  // 부착점은 실제 맞은 지점 그대로다. 줄 길이는 저장하지 않는다(표시 길이는 플레이어 위치에 따라 변한다).
  attach(point: Vec3): void {
    this.anchor = { point, assisting: true };
  }

  // 속도를 다시 설정하지 않는다(PRD PH-05: 해제 시 속도 보존).
  detach(): void {
    this.anchor = null;
  }

  get isAttached(): boolean {
    return this.anchor !== null;
  }

  // 진단용 읽기 전용 부착 정보. Rapier 객체는 노출하지 않는다.
  get attachment(): { point: Vec3; distance: number; assisting: boolean } | null {
    if (!this.anchor) return null;
    const [px, py, pz] = this.getPlayerPosition();
    const [ax, ay, az] = this.anchor.point;
    return {
      point: this.anchor.point,
      distance: Math.hypot(px - ax, py - ay, pz - az),
      assisting: this.anchor.assisting,
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

  // 조준 방향으로 구체를 쓸어 첫 건물 접촉점을 찾는다. 미리 배치한 후보점 배열을 대신하는 조준
  // 보정이다. 첫 접촉점을 반환하고, 접촉점까지의 직선 가시성과 사거리는 selectTarget에서 검사한다.
  sweepBuilding(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    radius: number,
  ): TargetHit | null {
    const hit = this.world.castShape(
      toRapierVec(origin),
      IDENTITY_ROTATION,
      toRapierVec(direction),
      new RAPIER.Ball(radius),
      0,
      maxDistance,
      false,
      undefined,
      undefined,
      this.playerCollider,
      undefined,
      (collider) => this.buildingColliderHandles.has(collider.handle),
    );
    if (!hit) return null;
    // rapier3d-compat 0.20에서 witness1이 건물 쪽 접촉점을 월드 좌표로 준다(witness2는 구체
    // 로컬이다). 타입 정의 주석은 반대로 적혀 있어 실제 값을 찍어 확인했다.
    const point: Vec3 = [hit.witness1.x, hit.witness1.y, hit.witness1.z];
    const distance = Math.hypot(point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]);
    return { point, distance };
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
