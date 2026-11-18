// vehicles.js — procedural car meshes (sedan, coupe, van, pickup, taxi and
// the Azura PD cruiser), an arcade car physics step shared by the player,
// traffic and police, and the traffic system that keeps Port Azura's roads
// moving and its parking lots full of stealable cars.

import * as THREE from 'three';
import { CAR, PALETTE, WORLD } from './config.js';
import { angleDelta, clamp, dist2d } from './rng.js';
import { moveWithColliders } from './city.js';

const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a2432 });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x14151a });
const trimMat = new THREE.MeshLambertMaterial({ color: 0x23242a });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.3, 10);

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function makeCarMesh(style, paintHex, opts = {}) {
  const car = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: paintHex });
  const wheels = [];
  const wheelPos = [[-0.82, 1.32], [0.82, 1.32], [-0.82, -1.32], [0.82, -1.32]];
  for (const [wx, wz] of wheelPos) {
    const wheel = new THREE.Mesh(wheelGeo, tyreMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.37, wz);
    car.add(wheel);
    wheels.push(wheel);
  }
  if (style === 'van') {
    car.add(box(1.95, 1.5, 4.5, paint, 0, 1.15, 0));
    car.add(box(1.85, 0.62, 0.9, glassMat, 0, 1.28, 1.95));
    car.add(box(1.98, 0.3, 4.54, trimMat, 0, 0.42, 0));
  } else if (style === 'pickup') {
    car.add(box(1.9, 0.62, 4.4, paint, 0, 0.72, 0));
    car.add(box(1.7, 0.62, 1.5, paint, 0, 1.3, 0.55));
    car.add(box(1.6, 0.5, 1.3, glassMat, 0, 1.32, 0.6));
    car.add(box(1.86, 0.4, 1.7, trimMat, 0, 0.95, -1.45));
  } else {
    const lower = style === 'coupe' ? 0.5 : 0.58;
    car.add(box(1.82, lower, 4.25, paint, 0, 0.68, 0));
    const cabin = box(1.62, 0.52, style === 'coupe' ? 1.7 : 2.0, glassMat, 0, 1.18, style === 'coupe' ? -0.3 : -0.15);
    car.add(cabin);
    car.add(box(1.86, 0.16, 4.3, trimMat, 0, 0.42, 0));
    if (style === 'coupe') car.add(box(1.7, 0.07, 0.5, paint, 0, 1.02, -1.95)); // spoiler
  }
  car.add(box(0.34, 0.12, 0.06, headMat, -0.6, 0.72, 2.14));
  car.add(box(0.34, 0.12, 0.06, headMat, 0.6, 0.72, 2.14));
  car.add(box(0.34, 0.1, 0.06, tailMat, -0.6, 0.74, -2.14));
  car.add(box(0.34, 0.1, 0.06, tailMat, 0.6, 0.74, -2.14));

  if (opts.taxi) {
    const sign = box(0.8, 0.22, 0.4, new THREE.MeshBasicMaterial({ color: 0xffe066 }), 0, 1.56, -0.15);
    car.add(sign);
  }
  if (opts.police) {
    car.add(box(1.84, 0.55, 1.1, trimMat, -0.0, 0.7, 0.1)); // black band
    const red = box(0.55, 0.16, 0.34, new THREE.MeshBasicMaterial({ color: 0xff2a20 }), -0.32, 1.52, -0.15);
    const blue = box(0.55, 0.16, 0.34, new THREE.MeshBasicMaterial({ color: 0x2255ff }), 0.32, 1.52, -0.15);
    car.add(red);
    car.add(blue);
    car.userData.lightRed = red;
    car.userData.lightBlue = blue;
  }
  car.userData.wheels = wheels;
  return car;
}

let nextVehicleId = 1;

export class Vehicle {
  constructor(scene, style, paintHex, x, z, angle, opts = {}) {
    this.id = nextVehicleId++;
    this.mesh = makeCarMesh(style, paintHex, opts);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = angle;
    scene.add(this.mesh);
    this.x = x;
    this.z = z;
    this.angle = angle;
    this.speed = 0;
    this.steer = 0;
    this.health = CAR.maxHealth;
    this.style = style;
    this.isPolice = Boolean(opts.police);
    this.isTaxi = Boolean(opts.taxi);
    this.driver = null;        // 'traffic' | 'police' | 'player' | null (parked)
    this.onCrash = null;       // (intensity) => void
    this.smoke = null;
    this.wheelSpin = 0;
  }

  get wrecked() { return this.health <= 0; }
  forwardX() { return Math.sin(this.angle); }
  forwardZ() { return Math.cos(this.angle); }

  // Arcade step. input: { throttle: -1..1, steer: -1..1 }.
  // A frozen vehicle (screenshot staging) holds its pose exactly.
  step(dt, input, colliders) {
    if (this.frozen) { this.syncMesh(0); return { hit: false, hitX: false, hitZ: false }; }
    const topSpeed = this.wrecked ? 4 : 27;
    if (input.throttle > 0) this.speed += CAR.accel * input.throttle * dt * (this.speed < 0 ? 2.2 : 1);
    else if (input.throttle < 0) {
      this.speed += (this.speed > 0.5 ? -CAR.brake : CAR.accel * input.throttle) * dt;
    }
    this.speed -= this.speed * CAR.drag * dt * 0.35;
    if (Math.abs(this.speed) < 0.04 && input.throttle === 0) this.speed = 0;
    this.speed = clamp(this.speed, -CAR.reverseMax, topSpeed);

    this.steer += clamp(input.steer - this.steer, -dt * 6, dt * 6);
    const steerAuthority = clamp(Math.abs(this.speed) / 6, 0, 1) * (this.speed < 14 ? 1 : 14 / this.speed);
    this.angle += this.steer * CAR.maxSteer * CAR.grip * steerAuthority * dt * Math.sign(this.speed || 1);

    const dx = this.forwardX() * this.speed * dt;
    const dz = this.forwardZ() * this.speed * dt;
    const before = Math.abs(this.speed);
    const res = moveWithColliders(colliders, this.x, this.z, dx, dz, CAR.radius);
    this.x = res.x;
    this.z = res.z;
    if (res.hit && before > 3.5) {
      const impact = before;
      this.speed = -this.speed * 0.22;
      this.damage((impact - 3) * 2.4);
      if (this.onCrash) this.onCrash(clamp(impact / 16, 0.25, 1));
    }
    this.syncMesh(dt);
    return res;
  }

  // Steering helper for AI drivers: aims the car at a point.
  driveToward(dt, tx, tz, targetSpeed, colliders) {
    const want = Math.atan2(tx - this.x, tz - this.z);
    const delta = angleDelta(this.angle, want);
    const steer = clamp(delta * 1.6, -1, 1);
    const throttle = this.speed < targetSpeed ? 0.85 : -0.25;
    return this.step(dt, { throttle, steer }, colliders);
  }

  damage(amount) {
    this.health = Math.max(0, this.health - amount);
    if (this.health < 45 && !this.smoke) {
      const smoke = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x555560, transparent: true, opacity: 0.55 }),
      );
      smoke.position.set(0, 1.3, 1.6);
      this.mesh.add(smoke);
      this.smoke = smoke;
    }
    if (this.smoke) {
      const s = 1 + (45 - this.health) / 22;
      this.smoke.scale.set(s, s * 1.4, s);
    }
  }

  repair() {
    this.health = CAR.maxHealth;
    if (this.smoke) {
      this.mesh.remove(this.smoke);
      this.smoke = null;
    }
  }

  syncMesh(dt = 0) {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.angle;
    this.wheelSpin += this.speed * dt * 2.4;
    for (const wheel of this.mesh.userData.wheels) wheel.rotation.x = this.wheelSpin;
    const fl = this.mesh.userData.wheels[0];
    if (fl) {
      this.mesh.userData.wheels[0].rotation.y = this.steer * 0.45;
      this.mesh.userData.wheels[1].rotation.y = this.steer * 0.45;
    }
  }

  dispose(scene) {
    scene.remove(this.mesh);
  }
}

// Lane centre for a car travelling on a road: axis 'x' means the road runs
// east-west at z = line; axis 'z' means it runs north-south at x = line.
export function laneCross(axis, line, dir) {
  return axis === 'x' ? line + 3.2 * dir : line - 3.2 * dir;
}

export class TrafficSystem {
  constructor(scene, city, rng) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.cars = [];
    this.styles = ['sedan', 'sedan', 'coupe', 'van', 'pickup'];
  }

  spawnTrafficCar(nearX, nearZ) {
    const lines = WORLD.roadLines;
    const axis = this.rng.chance(0.5) ? 'x' : 'z';
    const line = this.rng.pick(lines);
    const dir = this.rng.chance(0.5) ? 1 : -1;
    const along = clamp((axis === 'x' ? nearX : nearZ) + this.rng.range(-190, 190), -225, 225);
    const cross = laneCross(axis, line, dir);
    const x = axis === 'x' ? along : cross;
    const z = axis === 'x' ? cross : along;
    if (dist2d(x, z, nearX, nearZ) < 26) return null;
    const style = this.rng.pick(this.styles);
    const paint = style === 'van' && this.rng.chance(0.4) ? 0xe6e2da : this.rng.pick(PALETTE.carPaints);
    const car = new Vehicle(this.scene, style, paint, x, z, 0);
    car.driver = 'traffic';
    car.route = { axis, line, dir };
    car.cruise = this.rng.range(8.5, 12.5);
    car.waypoint = this.nextWaypoint(car, true);
    this.cars.push(car);
    return car;
  }

  nextWaypoint(car, first = false) {
    const { axis, line, dir } = car.route;
    const lines = WORLD.roadLines;
    const pos = axis === 'x' ? car.x : car.z;
    const ahead = lines.filter((L) => (L - pos) * dir > (first ? 30 : 12));
    const target = ahead.length ? this.rng.pick(ahead.slice(0, 3)) : pos + dir * 160;
    const cross = laneCross(axis, line, dir);
    return axis === 'x' ? { x: target, z: cross } : { x: cross, z: target };
  }

  // At an intersection a driver may turn onto the crossing road.
  pickTurn(car) {
    const lines = WORLD.roadLines;
    const crossLine = lines.reduce((best, L) => (Math.abs(L - (car.route.axis === 'x' ? car.x : car.z)) < Math.abs(best - (car.route.axis === 'x' ? car.x : car.z)) ? L : best), lines[0]);
    const newAxis = car.route.axis === 'x' ? 'z' : 'x';
    const newDir = this.rng.chance(0.5) ? 1 : -1;
    car.route = { axis: newAxis, line: crossLine, dir: newDir };
    const cross = laneCross(newAxis, crossLine, newDir);
    const along = (newAxis === 'x' ? car.x : car.z) + newDir * 30;
    car.waypoint = newAxis === 'x' ? { x: along, z: cross } : { x: cross, z: along };
  }

  spawnParked(count) {
    const spots = [...this.city.parkingSpots];
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    const chosen = spots.slice(0, count);
    // A few kerbside cars near places of interest, too.
    chosen.push({ x: -33, z: 26, angle: Math.PI / 2 }, { x: 46, z: -40, angle: -Math.PI / 2 }, { x: 140, z: 22, angle: Math.PI / 2 });
    for (const spot of chosen) {
      const style = this.rng.pick(this.styles);
      const taxi = this.rng.chance(0.14);
      const car = new Vehicle(this.scene, taxi ? 'sedan' : style, taxi ? PALETTE.taxiPaint : this.rng.pick(PALETTE.carPaints), spot.x, spot.z, spot.angle, { taxi });
      car.driver = null;
      this.cars.push(car);
    }
  }

  update(dt, playerX, playerZ, colliders, blockers) {
    // Keep the roads around the player populated.
    while (this.cars.filter((c) => c.driver === 'traffic').length < 11) {
      if (!this.spawnTrafficCar(playerX, playerZ)) break;
    }
    for (const car of this.cars) {
      if (car.driver !== 'traffic') continue;
      const d = dist2d(car.x, car.z, playerX, playerZ);
      if (d > 330) {
        // Recycle far-away traffic back near the player.
        const fresh = this.spawnTrafficCar(playerX, playerZ);
        if (fresh) {
          car.x = fresh.x; car.z = fresh.z; car.route = fresh.route; car.waypoint = fresh.waypoint;
          fresh.dispose(this.scene);
          this.cars.splice(this.cars.indexOf(fresh), 1);
        }
        continue;
      }
      // Brake for anything solid ahead.
      let target = car.cruise;
      const fx = car.forwardX();
      const fz = car.forwardZ();
      for (const other of blockers) {
        if (other === car) continue;
        const relX = other.x - car.x;
        const relZ = other.z - car.z;
        const aheadDist = relX * fx + relZ * fz;
        const sideDist = Math.abs(relX * fz - relZ * fx);
        if (aheadDist > 0 && aheadDist < 9 && sideDist < 2.1) { target = Math.min(target, other.speed ?? 0); break; }
      }
      if (dist2d(car.x, car.z, car.waypoint.x, car.waypoint.z) < 9) {
        if (this.rng.chance(0.32)) this.pickTurn(car);
        else car.waypoint = this.nextWaypoint(car);
      }
      car.driveToward(dt, car.waypoint.x, car.waypoint.z, target, colliders);
    }
  }
}
