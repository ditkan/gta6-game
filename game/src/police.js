import { AVENUES, STREETS } from './config.js';
import { clamp, angleDelta, dist2d } from './rng.js';
import { Car } from './vehicles.js';

// Azura PD: a five-star wanted level. Cruisers spawn on streets around the
// player, pursue, ram and pin. Out of sight long enough, the heat cools.
export class Police {
  constructor(scene, rng, colliders, allCars) {
    this.scene = scene;
    this.rng = rng;
    this.colliders = colliders;
    this.allCars = allCars; // shared registry so traffic can brake for them
    this.level = 0;
    this.cruisers = [];
    this.floor = 0;          // mission-imposed minimum level
    this.floorTimer = 0;
    this.sightTimer = 0;     // time since any cruiser last saw the player
    this.bustMeter = 0;
    this.spawnTimer = 0;
    this.shotTimer = 0;
    this.onShootPlayer = null; // callback(damage)
    this.onBusted = null;      // callback()
  }
  setWanted(n, floorSeconds = 0) {
    this.level = clamp(Math.round(n), 0, 5);
    if (floorSeconds > 0) {
      this.floor = this.level;
      this.floorTimer = floorSeconds;
    }
    if (this.level > 0) this.sightTimer = 0;
  }
  addHeat(n) { this.setWanted(this.level + n); }
  clear() {
    this.level = 0; this.floor = 0; this.floorTimer = 0; this.bustMeter = 0;
    for (const c of this.cruisers) {
      this.scene.remove(c.mesh);
      const i = this.allCars.indexOf(c);
      if (i >= 0) this.allCars.splice(i, 1);
    }
    this.cruisers = [];
  }
  spawnSpot(player) {
    // A street point 75–115 m away, biased out of the player's view.
    for (let tries = 0; tries < 12; tries++) {
      const onAve = this.rng.chance(0.5);
      const line = onAve ? this.rng.pick(AVENUES) : this.rng.pick(STREETS);
      const along = clamp((onAve ? player.z : player.x) + this.rng.range(-115, 115), -235, 200);
      const x = onAve ? line : along;
      const z = onAve ? along : line;
      const d = dist2d(x, z, player.x, player.z);
      if (d > 65 && d < 130) return { x, z };
    }
    return { x: player.x + 90, z: player.z };
  }
  spawnCruiser(player) {
    const spot = this.spawnSpot(player);
    const angle = Math.atan2(player.x - spot.x, player.z - spot.z);
    const car = new Car(this.scene, 'cruiser', spot.x, spot.z, angle, 0xf2f2f2);
    car.driver = 'police';
    this.cruisers.push(car);
    this.allCars.push(car);
    return car;
  }
  update(dt, player, audio) {
    if (this.floorTimer > 0) {
      this.floorTimer -= dt;
      if (this.floorTimer <= 0) this.floor = 0;
    }
    const want = this.level === 0 ? 0 : clamp(this.level + 1, 2, 6);
    this.spawnTimer -= dt;
    if (this.level > 0 && this.cruisers.length < want && this.spawnTimer <= 0) {
      this.spawnCruiser(player);
      this.spawnTimer = 1.15;
    }
    // Sight & cooling.
    let nearest = Infinity;
    for (const c of this.cruisers) nearest = Math.min(nearest, dist2d(c.x, c.z, player.x, player.z));
    if (nearest < 55) this.sightTimer = 0; else this.sightTimer += dt;
    if (this.level > this.floor && this.sightTimer > 7) {
      this.sightTimer = 3;
      this.setWanted(this.level - 1);
      if (this.level === 0) this.clear();
    }
    if (audio) audio.siren(this.level > 0 && nearest < 70);

    // Chase behaviour.
    let bustPressure = false;
    for (const c of [...this.cruisers]) {
      if (c.dead) {
        c.driver = 'wreck';
        this.cruisers.splice(this.cruisers.indexOf(c), 1);
        continue;
      }
      const d = dist2d(c.x, c.z, player.x, player.z);
      if (this.level === 0 && d > 120) {
        this.scene.remove(c.mesh);
        const i = this.allCars.indexOf(c);
        if (i >= 0) this.allCars.splice(i, 1);
        this.cruisers.splice(this.cruisers.indexOf(c), 1);
        continue;
      }
      // Aim at a point just behind the player's heading so cruisers ram
      // and pin rather than orbit.
      const pvx = player.mode === 'car' && player.vehicle ? player.vehicle.fx * player.vehicle.speed : 0;
      const pvz = player.mode === 'car' && player.vehicle ? player.vehicle.fz * player.vehicle.speed : 0;
      const tx = player.x + pvx * 0.45, tz = player.z + pvz * 0.45;
      const wantAngle = Math.atan2(tx - c.x, tz - c.z);
      const steer = clamp(angleDelta(c.angle, wantAngle) * 1.9, -1, 1);
      let throttle = 1;
      if (d < 7) throttle = player.speed > 3 ? 0.55 : 0.1;
      if (d > 160) throttle = 1;
      c.step(dt, { throttle, steer }, this.colliders);
      if (c.crashAmount > 0.3 && player.mode === 'car' && d < 5) {
        player.vehicle.damage(4 + c.crashAmount * 8);
      }
      // Bust pressure: close and the player nearly stopped.
      if (d < 8.5 && player.speed < 2.2) bustPressure = true;
    }
    if (bustPressure && this.level > 0 && !player.dead) {
      this.bustMeter += dt;
      if (this.bustMeter > 2.6) {
        this.bustMeter = 0;
        if (this.onBusted) this.onBusted();
      }
    } else {
      this.bustMeter = Math.max(0, this.bustMeter - dt * 1.6);
    }
    // At three stars and up, officers shoot from their cars.
    this.shotTimer -= dt;
    if (this.level >= 3 && nearest < 34 && nearest > 6 && this.shotTimer <= 0 && !player.dead) {
      this.shotTimer = this.rng.range(0.5, 1.1);
      if (this.onShootPlayer) this.onShootPlayer(this.rng.range(2.5, 5.5));
      if (audio) audio.shot();
    }
  }
}
