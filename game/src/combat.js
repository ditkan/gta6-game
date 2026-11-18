import * as THREE from 'three';
import { dist2d } from './rng.js';

// Marco's pistol and fists. Shooting is a hitscan along the camera's aim:
// the nearest pedestrian, car or cruiser inside a narrow cone takes it.
export class Combat {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.cooldown = 0;
    this.punchCooldown = 0;
    this.tracers = [];
    this.weapon = 'PISTOL'; // Marco always carries; fists are Q
    this.lastShotAt = null; // {x, z} panic point for pedestrians
  }
  update(dt) {
    this.cooldown -= dt;
    this.punchCooldown -= dt;
    for (const t of [...this.tracers]) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09);
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this.tracers.splice(this.tracers.indexOf(t), 1);
      }
    }
  }
  tracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 1 }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.09 });
  }
  // origin {x,y,z}, dir normalised {x,y,z}. Returns true when fired.
  shoot(origin, dir) {
    if (this.cooldown > 0) return false;
    this.cooldown = 0.19;
    const g = this.game;
    const player = g.player;
    this.lastShotAt = { x: player.x, z: player.z };
    g.audio.shot();
    const range = 70;
    let bestT = range, hitKind = null, hitObj = null;
    const testSphere = (cx, cy, cz, r, kind, obj) => {
      const ox = cx - origin.x, oy = cy - origin.y, oz = cz - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0.5 || t > bestT) return;
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      if (Math.hypot(px - cx, py - cy, pz - cz) < r) { bestT = t; hitKind = kind; hitObj = obj; }
    };
    for (const ped of g.pedestrians.peds) {
      if (ped.dead) continue;
      testSphere(ped.x, 1.05, ped.z, 0.85, 'ped', ped);
    }
    for (const npc of g.director.extras) {
      if (npc.dead) continue;
      testSphere(npc.x, 1.05, npc.z, 0.85, 'extra', npc);
    }
    const cars = [...g.traffic.cars, ...g.police.cruisers];
    for (const car of cars) {
      if (car === player.vehicle) continue;
      testSphere(car.x, 0.85, car.z, 2.3, 'car', car);
    }
    const end = {
      x: origin.x + dir.x * bestT,
      y: Math.max(0.3, origin.y + dir.y * bestT),
      z: origin.z + dir.z * bestT,
    };
    this.tracer(origin, end);
    if (hitKind === 'ped') {
      const killed = g.pedestrians.hurt(hitObj, 34);
      if (killed) g.onCrime('pedDown');
    } else if (hitKind === 'extra') {
      hitObj.hp -= 34;
      if (hitObj.hp <= 0 && !hitObj.dead) { hitObj.dead = true; hitObj.mesh.rotation.x = -Math.PI / 2; hitObj.mesh.position.y = 0.25; }
      g.onCrime('shotFired');
    } else if (hitKind === 'car') {
      const wasPolice = hitObj.type === 'cruiser';
      hitObj.damage(16);
      if (hitObj.dead && wasPolice) g.onCrime('copDown');
      else g.onCrime('shotFired');
    } else {
      g.onCrime('shotFired');
    }
    return true;
  }
  punch() {
    if (this.punchCooldown > 0) return;
    this.punchCooldown = 0.38;
    const g = this.game;
    const p = g.player;
    g.audio.punch();
    const tx = p.x + p.fx * 1.6, tz = p.z + p.fz * 1.6;
    for (const ped of g.pedestrians.peds) {
      if (!ped.dead && dist2d(ped.x, ped.z, tx, tz) < 1.5) {
        const killed = g.pedestrians.hurt(ped, 18);
        if (killed) g.onCrime('pedDown');
        else g.onCrime('assault');
        return;
      }
    }
    for (const car of g.traffic.cars) {
      if (dist2d(car.x, car.z, tx, tz) < 2.6) {
        car.damage(4);
        g.onCrime('assault');
        return;
      }
    }
  }
}
