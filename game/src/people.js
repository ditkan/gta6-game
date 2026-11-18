// people.js — the low-poly citizens of Port Azura: a person mesh factory the
// player character also uses, and the pedestrian system that walks them
// along the streets, makes them flee danger, and knocks them down when a
// car (or a fist, or a bullet) reaches them.

import * as THREE from 'three';
import { WORLD } from './config.js';
import { angleDelta, clamp, dist2d } from './rng.js';
import { moveWithColliders } from './city.js';

const SKIN = [0xf2c79b, 0xc68863, 0x8a5a3b, 0x6e4530, 0xffdbac];
const SHIRTS = [0xe8e2da, 0x2e6fc2, 0xe67e22, 0x3fae6a, 0xd6336c, 0xf5b81d, 0x7fe7dc, 0xb03a2e, 0x5b5ea6, 0xeeeeee];
const PANTS = [0x2c3550, 0x4a3b2c, 0x22242a, 0x707a8a, 0x8a2f43];

export function makePersonMesh(rng, fixed = null) {
  const person = new THREE.Group();
  const skin = fixed?.skin ?? rng.pick(SKIN);
  const shirt = fixed?.shirt ?? rng.pick(SHIRTS);
  const pants = fixed?.pants ?? rng.pick(PANTS);
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });

  const legGeo = new THREE.BoxGeometry(0.17, 0.78, 0.2);
  const legL = new THREE.Mesh(legGeo, pantsMat);
  legL.position.set(-0.11, 0.39, 0);
  const legR = new THREE.Mesh(legGeo, pantsMat);
  legR.position.set(0.11, 0.39, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.66, 0.3), shirtMat);
  torso.position.y = 1.1;
  torso.castShadow = true;
  const armGeo = new THREE.BoxGeometry(0.13, 0.62, 0.16);
  const armL = new THREE.Mesh(armGeo, shirtMat);
  armL.position.set(-0.34, 1.12, 0);
  const armR = new THREE.Mesh(armGeo, shirtMat);
  armR.position.set(0.34, 1.12, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), skinMat);
  head.position.y = 1.66;
  head.castShadow = true;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.215, 10, 6, 0, Math.PI * 2, 0, 1.25), new THREE.MeshLambertMaterial({ color: fixed?.hair ?? 0x2a1c10 }));
  hair.position.y = 1.7;
  person.add(legL, legR, torso, armL, armR, head, hair);
  person.userData.parts = { legL, legR, armL, armR, torso, head };
  return person;
}

// Swing limbs for a walking person; phase advances with distance travelled.
export function animateWalk(person, phase, runFactor = 1) {
  const parts = person.userData.parts;
  const swing = Math.sin(phase) * 0.55 * runFactor;
  parts.legL.rotation.x = swing;
  parts.legR.rotation.x = -swing;
  parts.armL.rotation.x = -swing * 0.8;
  parts.armR.rotation.x = swing * 0.8;
}

export function layDown(person) {
  person.rotation.x = -Math.PI / 2;
  person.position.y = 0.22;
}

let nextPedId = 1;

export class Pedestrians {
  constructor(scene, city, rng) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.list = [];
    this.onHit = null;   // (ped, byPlayerCar) => void
    for (let i = 0; i < 26; i++) this.spawn();
  }

  spawn(nearX = 0, nearZ = 0) {
    const mesh = makePersonMesh(this.rng);
    const lines = WORLD.roadLines;
    const alongX = this.rng.chance(0.5);
    const line = this.rng.pick(lines);
    const off = (this.rng.chance(0.5) ? -1 : 1) * (WORLD.roadHalfWidth + 1.7);
    const along = clamp((alongX ? nearX : nearZ) + this.rng.range(-170, 170), -232, 232);
    const x = alongX ? along : line + off;
    const z = alongX ? line + off : along;
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    const ped = {
      id: nextPedId++, mesh, x, z, angle: this.rng.range(0, Math.PI * 2),
      speed: 0, health: 100, state: 'walk', phase: this.rng.range(0, 6),
      target: null, fleeFrom: null, fleeTime: 0, downTime: 0,
    };
    this.list.push(ped);
    return ped;
  }

  scare(x, z, radius = 16) {
    for (const ped of this.list) {
      if (ped.state === 'walk' && dist2d(ped.x, ped.z, x, z) < radius) {
        ped.state = 'flee';
        ped.fleeFrom = { x, z };
        ped.fleeTime = this.rng.range(2.5, 4.5);
      }
    }
  }

  damage(ped, amount, fromX, fromZ) {
    ped.health -= amount;
    if (ped.health <= 0 && ped.state !== 'dead') {
      ped.state = 'dead';
      layDown(ped.mesh);
      return 'dead';
    }
    if (ped.state === 'walk') {
      ped.state = 'flee';
      ped.fleeFrom = { x: fromX, z: fromZ };
      ped.fleeTime = 3.5;
    }
    return 'hurt';
  }

  knockDown(ped, byPlayerCar) {
    if (ped.state === 'dead' || ped.state === 'down') return;
    ped.state = 'down';
    ped.downTime = this.rng.range(3, 6);
    ped.health -= 38;
    layDown(ped.mesh);
    if (this.onHit) this.onHit(ped, byPlayerCar);
    if (ped.health <= 0) ped.state = 'dead';
  }

  update(dt, ctx) {
    const { playerX, playerZ, vehicles, colliders } = ctx;
    for (const ped of this.list) {
      if (ped.state === 'dead') continue;
      if (ped.state === 'down') {
        ped.downTime -= dt;
        if (ped.downTime <= 0 && ped.health > 0) {
          ped.state = 'flee';
          ped.fleeTime = 3;
          ped.fleeFrom = { x: playerX, z: playerZ };
          ped.mesh.rotation.x = 0;
          ped.mesh.position.y = 0;
        }
        continue;
      }
      // Recycle peds who wandered too far from the action.
      if (dist2d(ped.x, ped.z, playerX, playerZ) > 300) {
        const fresh = this.spawn(playerX, playerZ);
        ped.x = fresh.x; ped.z = fresh.z; ped.mesh.position.set(fresh.x, 0, fresh.z);
        this.scene.remove(fresh.mesh);
        this.list.splice(this.list.indexOf(fresh), 1);
      }
      let speedTarget = 1.45;
      if (ped.state === 'flee') {
        ped.fleeTime -= dt;
        if (ped.fleeTime <= 0) ped.state = 'walk';
        speedTarget = 5.6;
        const away = Math.atan2(ped.x - ped.fleeFrom.x, ped.z - ped.fleeFrom.z);
        ped.target = { x: ped.x + Math.sin(away) * 18, z: ped.z + Math.cos(away) * 18 };
      } else if (!ped.target || dist2d(ped.x, ped.z, ped.target.x, ped.target.z) < 2.2) {
        ped.target = {
          x: clamp(ped.x + this.rng.range(-55, 55), -236, WORLD.beachX - 2),
          z: clamp(ped.z + this.rng.range(-55, 55), -236, 236),
        };
      }
      const want = Math.atan2(ped.target.x - ped.x, ped.target.z - ped.z);
      ped.angle += clamp(angleDelta(ped.angle, want), -dt * 4.2, dt * 4.2);
      ped.speed += clamp(speedTarget - ped.speed, -dt * 8, dt * 5);
      const dx = Math.sin(ped.angle) * ped.speed * dt;
      const dz = Math.cos(ped.angle) * ped.speed * dt;
      const res = moveWithColliders(colliders, ped.x, ped.z, dx, dz, 0.45);
      ped.x = res.x;
      ped.z = res.z;
      if (res.hit && ped.state === 'walk') ped.target = null; // pick a new way around
      ped.phase += ped.speed * dt * 2.4;
      ped.mesh.position.set(ped.x, Math.abs(Math.sin(ped.phase)) * 0.05, ped.z);
      ped.mesh.rotation.y = ped.angle;
      animateWalk(ped.mesh, ped.phase, ped.state === 'flee' ? 1.35 : 1);

      // Cars knock pedestrians down.
      for (const v of vehicles) {
        if (Math.abs(v.speed) > 3 && dist2d(ped.x, ped.z, v.x, v.z) < 1.9) {
          this.knockDown(ped, v.driver === 'player');
          break;
        }
      }
    }
  }
}
