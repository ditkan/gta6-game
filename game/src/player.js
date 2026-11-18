// player.js — Marco Serra, the wheelman you play: on-foot movement with a
// walk/run animation, entering and leaving cars, health and regeneration.
// The camera and the driving inputs live in main.js; this class owns the man.

import { PLAYER, WORLD } from './config.js';
import { angleDelta, clamp, dist2d } from './rng.js';
import { moveWithColliders } from './city.js';
import { makePersonMesh, animateWalk } from './people.js';

export class Player {
  constructor(scene, rng) {
    this.mesh = makePersonMesh(rng, { shirt: 0x0f766e, pants: 0x22242a, skin: 0xc68863, hair: 0x14100c });
    this.mesh.scale.setScalar(1.04);
    scene.add(this.mesh);
    this.x = -40;
    this.z = 20;
    this.angle = Math.PI / 2;
    this.speed = 0;
    this.health = PLAYER.maxHealth;
    this.mode = 'foot';           // 'foot' | 'car'
    this.vehicle = null;
    this.phase = 0;
    this.verticalV = 0;
    this.y = 0;
    this.timeSinceDamage = 99;
    this.shotCooldown = 0;
  }

  get dead() { return this.health <= 0; }

  placeAt(x, z, angle = this.angle) {
    this.x = x;
    this.z = z;
    this.angle = angle;
    this.syncMesh();
  }

  // move: {x, z} camera-relative wish direction (-1..1), sprint, jump.
  updateOnFoot(dt, move, colliders) {
    const moving = Math.abs(move.x) > 0.01 || Math.abs(move.z) > 0.01;
    const target = moving ? (move.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed) : 0;
    this.speed += clamp(target - this.speed, -dt * 30, dt * 18);
    if (moving) {
      const want = Math.atan2(move.x, move.z);
      this.angle += clamp(angleDelta(this.angle, want), -dt * 11, dt * 11);
      const dx = Math.sin(this.angle) * this.speed * dt * clamp(1 - Math.abs(angleDelta(this.angle, want)) / 1.6, 0.25, 1);
      const dz = Math.cos(this.angle) * this.speed * dt * clamp(1 - Math.abs(angleDelta(this.angle, want)) / 1.6, 0.25, 1);
      const res = moveWithColliders(colliders, this.x, this.z, dx, dz, PLAYER.radius);
      this.x = res.x;
      this.z = res.z;
    }
    if (move.jump && this.y <= 0.01) this.verticalV = 4.6;
    this.verticalV -= 12.5 * dt;
    this.y = Math.max(0, this.y + this.verticalV * dt);
    this.phase += this.speed * dt * 2.5;
    this.timeSinceDamage += dt;
    if (this.timeSinceDamage > 5 && this.health > 0) {
      this.health = Math.min(PLAYER.maxHealth, this.health + dt * 3.2);
    }
    this.shotCooldown = Math.max(0, this.shotCooldown - dt);
    this.syncMesh();
  }

  syncMesh() {
    if (this.mode === 'car') {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.set(this.x, this.y + Math.abs(Math.sin(this.phase)) * 0.045, this.z);
    this.mesh.rotation.y = this.angle;
    animateWalk(this.mesh, this.phase, this.speed > PLAYER.walkSpeed + 0.5 ? 1.3 : 1);
  }

  enterCar(vehicle) {
    this.mode = 'car';
    this.vehicle = vehicle;
    vehicle.driver = 'player';
    this.mesh.visible = false;
  }

  exitCar(colliders) {
    const v = this.vehicle;
    if (!v) return;
    v.driver = null;
    // Step out on the left side of the car, clear of its body.
    const sideX = Math.cos(v.angle);
    const sideZ = -Math.sin(v.angle);
    let px = v.x + sideX * -2.1;
    let pz = v.z + sideZ * -2.1;
    const res = moveWithColliders(colliders, v.x, v.z, px - v.x, pz - v.z, PLAYER.radius);
    px = res.x;
    pz = res.z;
    this.mode = 'foot';
    this.vehicle = null;
    this.placeAt(px, pz, v.angle);
    void dist2d;
    void WORLD;
  }

  damage(amount) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.timeSinceDamage = 0;
  }

  healFull() {
    this.health = PLAYER.maxHealth;
    this.timeSinceDamage = 99;
  }
}
