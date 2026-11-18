import { clamp, angleDelta, dist2d } from './rng.js';
import { collideCircle } from './city.js';
import { makePerson, animatePerson } from './people.js';

// Marco Serra: walks, sprints, jumps, punches, shoots — and drives whatever
// he can steal. mode is 'foot' or 'car'; when driving, x/z mirror the car.
export class Player {
  constructor(scene, rng) {
    this.mesh = makePerson(rng, { skin: 0xc98d5f, shirt: 0x20706b, pants: 0x2b2d42, hat: false });
    scene.add(this.mesh);
    this.x = 0; this.z = 0; this.angle = 0;
    this.y = 0; this.vy = 0;
    this.speed = 0;
    this.mode = 'foot';
    this.vehicle = null;
    this.health = 100;
    this.maxHealth = 100;
    this.cash = 0;
    this.walkPhase = 0;
    this.regenTimer = 0;
    this.dead = false;
  }
  get fx() { return Math.sin(this.angle); }
  get fz() { return Math.cos(this.angle); }
  placeAt(x, z, angle = 0) {
    if (this.mode === 'car' && this.vehicle) {
      this.vehicle.x = x; this.vehicle.z = z; this.vehicle.angle = angle; this.vehicle.speed = 0;
      this.vehicle.syncMesh();
    }
    this.x = x; this.z = z; this.angle = angle;
    this.y = 0; this.vy = 0;
    this.syncMesh();
  }
  // input: {x: strafe -1..1, z: forward -1..1, sprint, jump} in facing space.
  updateOnFoot(dt, input, colliders) {
    const ix = clamp(input.x || 0, -1, 1);
    const iz = clamp(input.z || 0, -1, 1);
    const mag = Math.hypot(ix, iz);
    let vx = 0, vz = 0;
    if (mag > 0.01) {
      const fx = this.fx, fz = this.fz;
      const rx = -fz, rz = fx; // right hand in facing space
      let mx = fx * iz + rx * ix;
      let mz = fz * iz + rz * ix;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const top = input.sprint ? 8.2 : 5.2;
      vx = mx * top * Math.min(1, mag);
      vz = mz * top * Math.min(1, mag);
      const want = Math.atan2(mx, mz);
      this.angle += angleDelta(this.angle, want) * Math.min(1, dt * 12);
    }
    this.x += vx * dt;
    this.z += vz * dt;
    const pos = { x: this.x, z: this.z };
    collideCircle(pos, 0.5, colliders);
    this.x = pos.x; this.z = pos.z;
    this.speed = Math.hypot(vx, vz);
    // A small hop.
    if (input.jump && this.y <= 0) this.vy = 4.6;
    if (this.y > 0 || this.vy > 0) {
      this.y += this.vy * dt;
      this.vy -= 13 * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; }
    }
    this.walkPhase += dt * this.speed * 2.6;
    this.syncMesh();
  }
  enterCar(car) {
    if (this.mode === 'car' || !car || car.dead) return false;
    this.mode = 'car';
    this.vehicle = car;
    car.driver = 'player';
    this.x = car.x;
    this.z = car.z;
    this.angle = car.angle;
    this.mesh.visible = false;
    return true;
  }
  exitCar(colliders) {
    if (this.mode !== 'car' || !this.vehicle) return;
    const car = this.vehicle;
    car.driver = null;
    car.speed = 0;
    this.mode = 'foot';
    this.vehicle = null;
    // Step out on the left side of the car.
    const lx = -car.fz, lz = car.fx;
    const pos = { x: car.x + lx * 2.1, z: car.z + lz * 2.1 };
    collideCircle(pos, 0.5, colliders || []);
    this.x = pos.x; this.z = pos.z;
    this.angle = car.angle;
    this.mesh.visible = true;
    this.syncMesh();
  }
  nearestCar(cars, maxDist = 3.6) {
    let best = null, bd = maxDist;
    for (const c of cars) {
      if (c.dead) continue;
      const d = dist2d(this.x, this.z, c.x, c.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  hurt(amount) {
    if (this.dead) return;
    this.health -= amount;
    this.regenTimer = 0;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
  }
  heal(amount) { this.health = clamp(this.health + amount, 0, this.maxHealth); }
  update(dt) {
    if (this.mode === 'car' && this.vehicle) {
      this.x = this.vehicle.x;
      this.z = this.vehicle.z;
      this.angle = this.vehicle.angle;
      this.speed = Math.abs(this.vehicle.speed);
    }
    // Slow health regen after a quiet spell.
    this.regenTimer += dt;
    if (!this.dead && this.regenTimer > 8 && this.health > 0) this.heal(2.2 * dt);
  }
  syncMesh() {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.angle;
    if (this.mode === 'foot') animatePerson(this.mesh, this.walkPhase, this.speed / 5);
  }
}
