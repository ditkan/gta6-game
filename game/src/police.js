// police.js — the Azura PD: the wanted level (crimes raise it, staying clean
// and out of sight decays it), cruiser spawns scaled by the stars, pursuit
// driving that rams and pins, officers who shoot at high heat, and the
// BUSTED meter when they corner Marco on foot.

import { WANTED, PALETTE, WORLD } from './config.js';
import { clamp, dist2d } from './rng.js';
import { Vehicle, laneCross } from './vehicles.js';

const CRIME_POINTS = {
  theft: 1,
  hitPed: 1,
  killPed: 1.5,
  shootPed: 1,
  ramPolice: 1,
  shootPolice: 1.5,
  hitCar: 0.35,
  missionHeat: 1,
};

export class PoliceSystem {
  constructor(scene, city, rng, sound) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.sound = sound;
    this.stars = 0;              // float; the HUD shows ceil()
    this.cruisers = [];
    this.timeSinceCrime = 99;
    this.decayClock = 0;
    this.busted01 = 0;            // 0..1 BUSTED meter
    this.shotClock = 0;
    this.flashClock = 0;
    this.onBusted = null;
  }

  get level() { return this.stars <= 0 ? 0 : Math.min(WANTED.maxStars, Math.ceil(this.stars)); }
  get active() { return this.level > 0; }

  reportCrime(kind) {
    const pts = CRIME_POINTS[kind] ?? 0.5;
    this.stars = clamp(this.stars + pts, 0, WANTED.maxStars);
    this.timeSinceCrime = 0;
  }

  setWanted(stars) {
    this.stars = clamp(stars, 0, WANTED.maxStars);
    this.timeSinceCrime = 0;
  }

  clearWanted() {
    this.stars = 0;
    this.timeSinceCrime = 99;
    this.busted01 = 0;
  }

  spawnCruiser(playerX, playerZ) {
    const lines = WORLD.roadLines;
    const axis = this.rng.chance(0.5) ? 'x' : 'z';
    const line = this.rng.pick(lines);
    const dir = this.rng.chance(0.5) ? 1 : -1;
    const cross = laneCross(axis, line, dir);
    const along = clamp((axis === 'x' ? playerX : playerZ) + this.rng.range(80, 120) * (this.rng.chance(0.5) ? 1 : -1), -228, 228);
    const x = axis === 'x' ? along : cross;
    const z = axis === 'x' ? cross : along;
    const cruiser = new Vehicle(this.scene, 'sedan', PALETTE.policePaint, x, z, 0, { police: true });
    cruiser.driver = 'police';
    this.cruisers.push(cruiser);
    return cruiser;
  }

  update(dt, ctx) {
    const { player, colliders, onPlayerShot } = ctx;
    const px = player.mode === 'car' ? player.vehicle.x : player.x;
    const pz = player.mode === 'car' ? player.vehicle.z : player.z;
    this.timeSinceCrime += dt;

    // Decay: a star drops after a clean, unseen stretch.
    const seenByCop = this.cruisers.some((c) => dist2d(c.x, c.z, px, pz) < 46);
    if (this.stars > 0 && this.timeSinceCrime > 6 && !seenByCop) {
      this.decayClock += dt;
      if (this.decayClock > WANTED.decaySeconds) {
        this.decayClock = 0;
        this.stars = Math.max(0, Math.ceil(this.stars) - 1);
        if (this.stars === 0) this.clearWanted();
      }
    } else {
      this.decayClock = 0;
    }

    // Spawn / retire cruisers to match the heat.
    const cap = this.holdSpawns ? this.cruisers.length : WANTED.policeCap[this.level];
    if (this.level > 0 && this.cruisers.length < cap) {
      this.spawnCruiser(px, pz);
      if (this.cruisers.length < cap - 1) this.spawnCruiser(px, pz);
    }
    for (let i = this.cruisers.length - 1; i >= 0; i--) {
      const c = this.cruisers[i];
      if (this.level === 0 && dist2d(c.x, c.z, px, pz) > 90) {
        c.dispose(this.scene);
        this.cruisers.splice(i, 1);
      } else if (dist2d(c.x, c.z, px, pz) > 420) {
        c.dispose(this.scene);
        this.cruisers.splice(i, 1);
      }
    }

    // Sirens and lightbars.
    const anyNear = this.cruisers.some((c) => dist2d(c.x, c.z, px, pz) < 70);
    this.sound.siren(this.level > 0 && anyNear);
    this.flashClock += dt;
    const phase = Math.floor(this.flashClock / 0.26) % 2 === 0;
    for (const c of this.cruisers) {
      if (c.mesh.userData.lightRed) c.mesh.userData.lightRed.visible = phase;
      if (c.mesh.userData.lightBlue) c.mesh.userData.lightBlue.visible = !phase;
    }

    // Pursuit driving: aim ahead of the player's motion, ram to pin.
    const pSpeed = player.mode === 'car' ? Math.abs(player.vehicle.speed) : player.speed;
    for (const c of this.cruisers) {
      if (c.wrecked || c.frozen) continue;
      const lead = clamp(pSpeed * 0.4, 0, 9);
      const tx = px + (player.mode === 'car' ? player.vehicle.forwardX() * lead : Math.sin(player.angle) * lead);
      const tz = pz + (player.mode === 'car' ? player.vehicle.forwardZ() * lead : Math.cos(player.angle) * lead);
      c.driveToward(dt, tx, tz, WANTED.policeSpeed[this.level], colliders);
    }

    // BUSTED pressure: cornered on foot, or pinned in a stopped car.
    let pressure = false;
    for (const c of this.cruisers) {
      const d = dist2d(c.x, c.z, px, pz);
      if (player.mode === 'foot' && d < WANTED.bustedRange && pSpeed < 2.2) pressure = true;
      if (player.mode === 'car' && d < 4.6 && pSpeed < 1.2) pressure = true;
    }
    if (pressure && this.level > 0) {
      this.busted01 = clamp(this.busted01 + dt / WANTED.bustedFillTime, 0, 1);
      if (this.busted01 >= 1 && this.onBusted) this.onBusted();
    } else {
      this.busted01 = clamp(this.busted01 - dt * 0.7, 0, 1);
    }

    // Officers open fire at three stars and up.
    if (this.level >= 3 && !player.dead) {
      this.shotClock -= dt;
      if (this.shotClock <= 0) {
        this.shotClock = this.rng.range(0.9, 1.6);
        const shooters = this.cruisers.filter((c) => !c.wrecked && dist2d(c.x, c.z, px, pz) < 34);
        if (shooters.length) {
          const c = this.rng.pick(shooters);
          const hit = this.rng.chance(0.55);
          if (onPlayerShot) onPlayerShot(c, hit);
          if (hit) player.damage(this.rng.range(3.5, 7));
        }
      }
    }
  }

  // Every vehicle the rest of the game must treat as solid/traffic.
  allVehicles() {
    return this.cruisers;
  }

  disposeAll() {
    for (const c of this.cruisers) c.dispose(this.scene);
    this.cruisers = [];
    this.sound.siren(false);
  }
}
