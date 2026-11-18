import * as THREE from 'three';
import { AVENUES, STREETS } from './config.js';
import { clamp, dist2d } from './rng.js';
import { collideCircle } from './city.js';

// Low-poly people: capsule-ish bodies from cylinders and spheres, with a
// swinging-arm walk cycle. One factory serves Marco, Lucia, Benny, mission
// extras and the ambient pedestrian crowd.
const SKIN = [0xf2c49b, 0xc98d5f, 0x8a5a33, 0x6e4525, 0xffe0bd];
const SHIRTS = [0x2a9d8f, 0xe76f51, 0xf4a261, 0x457b9d, 0x9b5de5, 0xef476f, 0x06d6a0, 0xf8f4ec, 0x3a506b];
const PANTS = [0x2b2d42, 0x4a4e69, 0x5c677d, 0x22223b, 0x6c5849];

export function makePerson(rng, opts = {}) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: opts.skin ?? rng.pick(SKIN) });
  const shirt = new THREE.MeshLambertMaterial({ color: opts.shirt ?? rng.pick(SHIRTS) });
  const pants = new THREE.MeshLambertMaterial({ color: opts.pants ?? rng.pick(PANTS) });
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.78, 0.19), pants);
    leg.geometry.translate(0, -0.39, 0);
    leg.position.set(s * 0.11, 0.78, 0);
    g.add(leg); legs.push(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.66, 0.15), shirt);
    arm.geometry = arm.geometry.clone();
    arm.geometry.translate(0, -0.3, 0);
    arm.position.set(s * 0.35, 1.38, 0);
    g.add(arm); legs.push(arm);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.27), shirt);
  torso.position.y = 1.09;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), skin);
  head.position.y = 1.62;
  g.add(head);
  if (opts.hat !== false && rng.chance(0.4)) {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.05, 10), new THREE.MeshLambertMaterial({ color: opts.hatColor ?? 0xf2e3c6 }));
    brim.position.y = 1.74;
    g.add(brim);
  }
  g.userData.parts = legs;
  return g;
}

export function animatePerson(mesh, walkPhase, speedNorm, dt) {
  const parts = mesh.userData.parts;
  if (!parts) return;
  const swing = Math.sin(walkPhase) * 0.55 * clamp(speedNorm, 0, 1.4);
  parts[0].rotation.x = swing;       // left leg
  parts[1].rotation.x = -swing;      // right leg
  parts[2].rotation.x = -swing * 0.8; // left arm
  parts[3].rotation.x = swing * 0.8;  // right arm
  void dt;
}
export function layDown(mesh) {
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.25;
}

// Ambient pedestrians strolling the sidewalks.
export class Pedestrians {
  constructor(scene, rng, colliders) {
    this.scene = scene;
    this.rng = rng;
    this.colliders = colliders;
    this.peds = [];
    for (let i = 0; i < 32; i++) this.spawn();
  }
  spawn() {
    const onAve = this.rng.chance(0.5);
    const line = onAve ? this.rng.pick(AVENUES) : this.rng.pick(STREETS);
    const side = this.rng.chance(0.5) ? 1 : -1;
    const along = this.rng.range(-235, 205);
    const x = onAve ? line + side * 9.6 : along;
    const z = onAve ? along : line + side * 9.6;
    if (z > 200) return;
    const mesh = makePerson(this.rng);
    this.scene.add(mesh);
    const ped = {
      x, z, mesh, hp: 30, dead: false, flee: 0,
      angle: onAve ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2),
      speed: this.rng.range(1.1, 1.9), phase: this.rng.range(0, 6),
      axis: onAve ? 'z' : 'x', dir: this.rng.chance(0.5) ? 1 : -1, line, side,
    };
    mesh.position.set(x, 0, z);
    this.peds.push(ped);
  }
  update(dt, playerPos, panicAt) {
    for (const p of this.peds) {
      if (p.dead) continue;
      let speed = p.speed;
      // Flee from gunfire or a car bearing down on them.
      if (panicAt && dist2d(p.x, p.z, panicAt.x, panicAt.z) < 16) p.flee = 2.5;
      if (p.flee > 0) {
        p.flee -= dt;
        const away = Math.atan2(p.x - (panicAt ? panicAt.x : p.x), p.z - (panicAt ? panicAt.z : p.z));
        p.angle = away;
        speed = 4.4;
        p.x += Math.sin(p.angle) * speed * dt;
        p.z += Math.cos(p.angle) * speed * dt;
      } else {
        if (p.axis === 'z') {
          p.z += p.dir * speed * dt;
          p.angle = p.dir > 0 ? 0 : Math.PI;
          if (p.z > 210 || p.z < -240) p.dir *= -1;
        } else {
          p.x += p.dir * speed * dt;
          p.angle = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          if (p.x > 245 || p.x < -245) p.dir *= -1;
        }
      }
      const pos = { x: p.x, z: p.z };
      collideCircle(pos, 0.45, this.colliders);
      p.x = pos.x; p.z = pos.z;
      p.phase += dt * speed * 3.4;
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = p.angle;
      animatePerson(p.mesh, p.phase, speed / 2);
    }
    void playerPos;
  }
  hurt(ped, amount) {
    ped.hp -= amount;
    if (ped.hp <= 0 && !ped.dead) {
      ped.dead = true;
      layDown(ped.mesh);
      return true;
    }
    ped.flee = 3;
    return false;
  }
}
