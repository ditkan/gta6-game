// combat.js — gunfire and fists: a hitscan pistol with tracers, muzzle flash
// and impact puffs, damage against pedestrians, cars and cruisers, and the
// crime reports every violent act files with the wanted system.

import * as THREE from 'three';
import { PLAYER } from './config.js';
import { dist2d } from './rng.js';

export class Combat {
  constructor(scene, sound) {
    this.scene = scene;
    this.sound = sound;
    this.effects = [];
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffdf8a }),
    );
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashTime = 0;
  }

  spawnTracer(x0, y0, z0, x1, y1, z1, color = 0xffe9a8) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.effects.push({ obj: line, life: 0.07, max: 0.07, kind: 'line' });
  }

  spawnPuff(x, y, z, color = 0xcfc4ae) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 7, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 }),
    );
    puff.position.set(x, y, z);
    this.scene.add(puff);
    this.effects.push({ obj: puff, life: 0.3, max: 0.3, kind: 'puff' });
  }

  update(dt) {
    this.flashTime -= dt;
    if (this.flashTime <= 0) this.flash.visible = false;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.life -= dt;
      if (fx.life <= 0) {
        this.scene.remove(fx.obj);
        fx.obj.geometry?.dispose?.();
        fx.obj.material?.dispose?.();
        this.effects.splice(i, 1);
        continue;
      }
      const k = fx.life / fx.max;
      if (fx.kind === 'line') fx.obj.material.opacity = k * 0.9;
      else {
        fx.obj.material.opacity = k * 0.7;
        fx.obj.scale.setScalar(1 + (1 - k) * 1.6);
      }
    }
  }

  // Fire the pistol. origin/dir are THREE.Vector3. ctx carries the world:
  // { peds, vehicles, colliders, onCrime, onPedDown, onVehicleHit }.
  shoot(origin, dir, ctx) {
    this.sound.shot();
    this.flash.position.copy(origin).addScaledVector(dir, 0.5);
    this.flash.visible = true;
    this.flashTime = 0.045;

    const step = 0.7;
    const steps = Math.floor(PLAYER.shotRange / step);
    let hitPoint = origin.clone().addScaledVector(dir, PLAYER.shotRange);
    let hitKind = 'world';
    let hitPed = null;
    let hitVehicle = null;

    outer:
    for (let i = 1; i <= steps; i++) {
      const p = origin.clone().addScaledVector(dir, i * step);
      if (p.y < 0) { hitPoint = p; break; }
      for (const ped of ctx.peds) {
        if (ped.state === 'dead') continue;
        if (Math.abs(p.y - 1.05) < 1.05 && dist2d(p.x, p.z, ped.x, ped.z) < 0.62) {
          hitPoint = p; hitKind = 'ped'; hitPed = ped; break outer;
        }
      }
      for (const v of ctx.vehicles) {
        if (Math.abs(p.y - 0.85) < 0.95 && dist2d(p.x, p.z, v.x, v.z) < 2.05) {
          hitPoint = p; hitKind = 'vehicle'; hitVehicle = v; break outer;
        }
      }
      for (const c of ctx.colliders) {
        if (p.x > c.x0 && p.x < c.x1 && p.z > c.z0 && p.z < c.z1) {
          hitPoint = p; hitKind = 'world'; break outer;
        }
      }
    }

    this.spawnTracer(origin.x, origin.y, origin.z, hitPoint.x, hitPoint.y, hitPoint.z);
    if (hitKind === 'ped') {
      const result = ctx.damagePed(hitPed, PLAYER.shotDamage, origin.x, origin.z);
      this.sound.hitFlesh();
      this.spawnPuff(hitPoint.x, hitPoint.y, hitPoint.z, 0xb03a2e);
      ctx.onCrime(result === 'dead' ? 'killPed' : 'shootPed', hitPed.x, hitPed.z);
      if (result === 'dead' && ctx.onPedDown) ctx.onPedDown(hitPed);
    } else if (hitKind === 'vehicle') {
      hitVehicle.damage(PLAYER.shotDamage * 0.5);
      this.spawnPuff(hitPoint.x, hitPoint.y, hitPoint.z, 0x9aa2ae);
      if (ctx.onVehicleHit) ctx.onVehicleHit(hitVehicle);
      if (hitVehicle.isPolice) ctx.onCrime('shootPolice', hitVehicle.x, hitVehicle.z);
    } else {
      this.spawnPuff(hitPoint.x, Math.max(0.15, hitPoint.y), hitPoint.z);
    }
    return hitKind;
  }

  // A swing of the fist: the nearest standing pedestrian in front goes down.
  punch(player, ctx) {
    this.sound.punch();
    const fx = Math.sin(player.angle);
    const fz = Math.cos(player.angle);
    let best = null;
    let bestD = PLAYER.punchRange;
    for (const ped of ctx.peds) {
      if (ped.state === 'dead' || ped.state === 'down') continue;
      const d = dist2d(player.x, player.z, ped.x, ped.z);
      if (d > bestD) continue;
      const dot = ((ped.x - player.x) * fx + (ped.z - player.z) * fz) / Math.max(d, 0.001);
      if (dot > 0.35) { best = ped; bestD = d; }
    }
    if (best) {
      this.sound.hitFlesh();
      const result = ctx.damagePed(best, PLAYER.punchDamage, player.x, player.z);
      ctx.onCrime(result === 'dead' ? 'killPed' : 'hitPed', best.x, best.z);
      if (result === 'dead' && ctx.onPedDown) ctx.onPedDown(best);
      return true;
    }
    return false;
  }
}
