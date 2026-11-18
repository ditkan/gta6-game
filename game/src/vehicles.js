import * as THREE from 'three';
import { VEHICLE_TYPES, CAR_COLORS, AVENUES, STREETS } from './config.js';
import { clamp, angleDelta, dist2d } from './rng.js';
import { collideCircle } from './city.js';

// One car: a low-poly body merged into a handful of meshes (paint, glass,
// wheels), arcade physics, and a step() that both the player and the AI
// drivers feed with {throttle, steer}.
function mergeGeoms(geos) {
  let vCount = 0, iCount = 0;
  for (const g of geos) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}
const darkMat = new THREE.MeshLambertMaterial({ color: 0x1c1e24 });
const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fd4e8 });
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });

function carMesh(type, colorHex) {
  const spec = VEHICLE_TYPES[type];
  const L = spec.len, W = spec.wid;
  const paint = new THREE.MeshLambertMaterial({ color: colorHex });
  const g = new THREE.Group();
  const paintParts = [box(W, 0.62, L, 0, 0.55, 0)];
  const glassParts = [];
  if (type === 'van' || type === 'armoured') {
    paintParts.push(box(W * 0.96, 1.05, L * 0.72, 0, 1.3, -L * 0.08));
    glassParts.push(box(W * 0.9, 0.55, 0.1, 0, 1.25, L * 0.3));
  } else if (type === 'pickup') {
    paintParts.push(box(W * 0.92, 0.62, L * 0.34, 0, 1.12, L * 0.16));
    glassParts.push(box(W * 0.86, 0.4, L * 0.3, 0, 1.16, L * 0.16));
  } else {
    glassParts.push(box(W * 0.84, 0.55, L * 0.46, 0, 1.08, -L * 0.03));
    paintParts.push(box(W * 0.8, 0.09, L * 0.4, 0, 1.4, -L * 0.03));
  }
  g.add(new THREE.Mesh(mergeGeoms(paintParts), paint));
  if (glassParts.length) g.add(new THREE.Mesh(mergeGeoms(glassParts), glassMat));
  const wheelGeos = [];
  for (const [wx, wz] of [[-W / 2, L / 2 - 0.85], [W / 2, L / 2 - 0.85], [-W / 2, -L / 2 + 0.85], [W / 2, -L / 2 + 0.85]]) {
    const w = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 9);
    w.rotateZ(Math.PI / 2);
    w.translate(wx, 0.36, wz);
    wheelGeos.push(w);
  }
  g.add(new THREE.Mesh(mergeGeoms(wheelGeos), darkMat));
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.7, L + 0.7), shadowMat);
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.03;
  g.add(shadow);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(W * 0.66, 0.13, 0.06), headMat);
  strip.position.set(0, 0.62, L / 2 + 0.02);
  g.add(strip);
  if (type === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.3), new THREE.MeshBasicMaterial({ color: 0xffd23e }));
    sign.position.set(0, 1.56, -L * 0.03);
    g.add(sign);
  }
  if (type === 'cruiser') {
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.17, 0.36), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    red.position.set(-0.28, 1.52, -L * 0.03);
    g.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.17, 0.36), new THREE.MeshBasicMaterial({ color: 0x2a5cff }));
    blue.position.set(0.28, 1.52, -L * 0.03);
    g.add(blue);
    g.userData.lightbar = [red, blue];
  }
  return g;
}

export class Car {
  constructor(scene, type, x, z, angle, colorHex) {
    this.type = type;
    this.spec = VEHICLE_TYPES[type];
    this.x = x; this.z = z; this.angle = angle;
    this.speed = 0;
    this.driver = null; // null = parked, 'traffic', 'player', 'police', 'mission'
    this.hp = this.spec.hp;
    this.maxHp = this.spec.hp;
    this.dead = false;
    this.crashAmount = 0;
    this.mesh = carMesh(type, colorHex);
    this.lightbar = this.mesh.userData.lightbar || null;
    this.smoke = null;
    scene.add(this.mesh);
    this.syncMesh();
  }
  get fx() { return Math.sin(this.angle); }
  get fz() { return Math.cos(this.angle); }
  // Arcade drive step. input: {throttle: -1..1, steer: -1..1, handbrake}
  step(dt, input, colliders) {
    if (this.dead) { this.speed = 0; return; }
    const top = this.spec.topSpeed;
    const throttle = clamp(input.throttle || 0, -1, 1);
    if (throttle > 0) {
      this.speed += this.spec.accel * throttle * dt * (1 - Math.max(0, this.speed) / (top * 1.12));
    } else if (throttle < 0) {
      if (this.speed > 0.5) this.speed -= 26 * dt; // braking
      else this.speed = Math.max(this.speed + this.spec.accel * 0.55 * throttle * dt, -8); // reverse
    }
    if (throttle === 0 || input.handbrake) {
      const drag = input.handbrake ? 14 : 0.5;
      const s = Math.sign(this.speed);
      this.speed -= s * Math.min(Math.abs(this.speed), drag * dt);
    }
    this.speed = clamp(this.speed, -8, top);
    const steer = clamp(input.steer || 0, -1, 1);
    if (Math.abs(this.speed) > 0.05) {
      const turnRate = this.spec.grip * steer * Math.min(1, Math.abs(this.speed) / 7) * (this.speed < 0 ? -1 : 1);
      this.angle += turnRate * dt * (input.handbrake ? 1.5 : 1);
    }
    this.x += this.fx * this.speed * dt;
    this.z += this.fz * this.speed * dt;
    const pos = { x: this.x, z: this.z };
    collideCircle(pos, 1.7, colliders);
    const shove = Math.hypot(pos.x - this.x, pos.z - this.z);
    this.x = pos.x; this.z = pos.z;
    if (shove > 0.4) {
      this.crashAmount = Math.min(1, Math.abs(this.speed) / 14);
      this.damage(Math.abs(this.speed) * 1.1);
      this.speed *= 0.35;
    } else {
      this.crashAmount = 0;
    }
    this.syncMesh();
  }
  damage(amount) {
    if (this.dead) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.speed = 0;
    }
  }
  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.angle;
    if (this.lightbar) {
      const t = performance.now() / 130;
      this.lightbar[0].visible = Math.sin(t) > 0;
      this.lightbar[1].visible = Math.sin(t) <= 0;
    }
    if ((this.hp < this.maxHp * 0.45 || this.dead) && !this.smoke) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 7, 6),
        new THREE.MeshBasicMaterial({ color: this.dead ? 0x222222 : 0x777777, transparent: true, opacity: 0.55 }));
      s.position.set(0, 1.5, this.spec.len * 0.32);
      this.mesh.add(s);
      this.smoke = s;
    }
    if (this.smoke) {
      const grow = 1 + Math.sin(performance.now() / 300) * 0.25;
      this.smoke.scale.set(grow, grow * 1.4, grow);
    }
  }
}

// Traffic: parked cars to steal and moving cars that follow the grid with
// right-hand lanes, turning at intersections, braking for the car ahead.
export class Traffic {
  constructor(scene, rng, colliders) {
    this.scene = scene;
    this.rng = rng;
    this.colliders = colliders;
    this.cars = [];
    this.spawnInitial();
  }
  addCar(car) { this.cars.push(car); return car; }
  spawnInitial() {
    const types = ['sedan', 'coupe', 'van', 'pickup', 'taxi'];
    for (let i = 0; i < 30; i++) {
      const onAve = this.rng.chance(0.5);
      const line = onAve ? this.rng.pick(AVENUES) : this.rng.pick(STREETS);
      const along = this.rng.range(-235, 225);
      const side = this.rng.chance(0.5) ? 1 : -1;
      const x = onAve ? line + side * 5.4 : along;
      const z = onAve ? along : line + side * 5.4;
      if (z > 190) continue;
      const angle = onAve ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      const type = this.rng.pick(types);
      this.addCar(new Car(this.scene, type, x, z, angle, this.rng.pick(CAR_COLORS)));
    }
    for (let i = 0; i < 18; i++) this.spawnMover(true);
  }
  spawnMover(anywhere = false) {
    const onAve = this.rng.chance(0.5);
    const line = onAve ? this.rng.pick(AVENUES) : this.rng.pick(STREETS);
    const dir = this.rng.chance(0.5) ? 1 : -1;
    const lane = 3.4;
    let x, z, angle;
    if (onAve) {
      x = line + (dir > 0 ? -lane : lane);
      z = anywhere ? this.rng.range(-230, 200) : this.rng.pick(STREETS);
      angle = dir > 0 ? 0 : Math.PI;
    } else {
      z = line + (dir > 0 ? lane : -lane);
      x = anywhere ? this.rng.range(-230, 230) : this.rng.pick(AVENUES);
      angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    const type = this.rng.pick(['sedan', 'sedan', 'coupe', 'van', 'pickup', 'taxi']);
    const car = new Car(this.scene, type, x, z, angle, type === 'taxi' ? 0xf2b821 : this.rng.pick(CAR_COLORS));
    car.driver = 'traffic';
    car.cruise = this.rng.range(8.5, 12.5);
    car.target = null;
    this.addCar(car);
    return car;
  }
  planTarget(car) {
    const fx = car.fx, fz = car.fz;
    let tx = car.x + fx * 46, tz = car.z + fz * 46;
    if (this.rng.chance(0.4)) {
      const turnLeft = this.rng.chance(0.5);
      car.pendingTurn = turnLeft ? { x: -fz, z: fx } : { x: fz, z: -fx };
    } else {
      car.pendingTurn = null;
    }
    car.target = { x: tx, z: tz };
  }
  update(dt, playerPos) {
    for (const car of this.cars) {
      if (car.driver !== 'traffic' || car.dead) continue;
      if (playerPos && dist2d(car.x, car.z, playerPos.x, playerPos.z) > 300) {
        const fresh = this.spawnMover();
        car.x = fresh.x; car.z = fresh.z; car.angle = fresh.angle; car.speed = 0; car.target = null;
        this.cars.splice(this.cars.indexOf(fresh), 1);
        this.scene.remove(fresh.mesh);
      }
      if (!car.target) this.planTarget(car);
      const t = car.target;
      const d = dist2d(car.x, car.z, t.x, t.z);
      if (d < 9) {
        if (car.pendingTurn) {
          const cross = car.pendingTurn;
          car.pendingTurn = null;
          const alongAve = Math.abs(cross.x) > 0.7; // now travelling east-west
          if (alongAve) {
            const street = STREETS.reduce((a, b) => (Math.abs(b - car.z) < Math.abs(a - car.z) ? b : a), STREETS[0]);
            car.z = street + (cross.x > 0 ? 3.4 : -3.4);
            car.angle = cross.x > 0 ? Math.PI / 2 : -Math.PI / 2;
          } else {
            const ave = AVENUES.reduce((a, b) => (Math.abs(b - car.x) < Math.abs(a - car.x) ? b : a), AVENUES[0]);
            car.x = ave + (cross.z > 0 ? -3.4 : 3.4);
            car.angle = cross.z > 0 ? 0 : Math.PI;
          }
        }
        car.target = null;
        continue;
      }
      const want = Math.atan2(t.x - car.x, t.z - car.z);
      const steer = clamp(angleDelta(car.angle, want) * 1.6, -1, 1);
      let throttle = car.speed < car.cruise ? 0.75 : 0;
      const aheadX = car.x + car.fx * 9, aheadZ = car.z + car.fz * 9;
      for (const other of this.cars) {
        if (other === car) continue;
        if (dist2d(other.x, other.z, aheadX, aheadZ) < 4.2) { throttle = -0.6; break; }
      }
      if (playerPos && dist2d(playerPos.x, playerPos.z, aheadX, aheadZ) < 4.2) throttle = -0.6;
      car.step(dt, { throttle, steer }, this.colliders);
    }
  }
}
