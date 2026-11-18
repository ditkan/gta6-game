import * as THREE from 'three';
import { makeRng, clamp, dist2d } from './rng.js';
import { POIS, PLAYER_SPAWN, districtAt } from './config.js';
import { buildCity } from './city.js';
import { Traffic, Car } from './vehicles.js';
import { Pedestrians, makePerson, animatePerson } from './people.js';
import { Player } from './player.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { Director } from './missions.js';
import { Hud } from './hud.js';
import { SoundEngine } from './audio.js';
import { loadSave, writeSave, defaultSave, clearSave } from './save.js';
import { stageShot } from './shots.js';

// ---------------------------------------------------------------- boot
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 7);
const shotName = params.get('shot');
const rng = makeRng(seed);

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 3000);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const cityParts = buildCity(scene, rng);
const traffic = new Traffic(scene, rng, cityParts.colliders);
const pedestrians = new Pedestrians(scene, rng, cityParts.colliders);
const player = new Player(scene, rng);
const hud = new Hud();
const audio = new SoundEngine();

const game = {
  mode: 'menu',
  scene, camera, rng,
  city: { colliders: cityParts.colliders, poi: POIS, districtAt },
  traffic, pedestrians, player, hud, audio,
  police: null, combat: null, director: null,
  npcs: {},
  briefcases: [],
  saveData: defaultSave(),
  clockMinutes: 17 * 60 + 30,
  camYaw: PLAYER_SPAWN.angle, camPitch: 0.22,
  camOverride: null,
  time: 0,
};
game.police = new Police(scene, rng, cityParts.colliders, traffic.cars);
game.combat = new Combat(scene, game);
game.director = new Director(game);
const director = game.director;
const police = game.police;

// NPCs: Lucia at her café corner, Paco at the garage.
function addNpc(id, x, z, angle, opts) {
  const mesh = makePerson(rng, opts);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = angle;
  scene.add(mesh);
  game.npcs[id] = { x, z, mesh, phase: rng.range(0, 6) };
  return game.npcs[id];
}
addNpc('lucia', 5.5, 40, -0.8, { skin: 0x8a5a33, shirt: 0xe76f51, pants: 0x2b2d42, hat: false });
addNpc('paco', -128, 83, 2.4, { skin: 0xf2c49b, shirt: 0x457b9d, pants: 0x4a4e69 });

// Hidden briefcases: $150 each, saved when found.
const CASE_SPOTS = [
  [-22, 17], [-120, 206], [195, 196], [-205, 196], [52, -38],
  [-97, 128], [142, 8], [-38, -97], [97, -142], [22, 142],
];
const caseGeo = new THREE.BoxGeometry(0.62, 0.24, 0.44);
for (const [x, z] of CASE_SPOTS) {
  const mesh = new THREE.Mesh(caseGeo, new THREE.MeshLambertMaterial({ color: 0x9a7a4a, emissive: 0x332200 }));
  mesh.position.set(x, 0.35, z);
  scene.add(mesh);
  game.briefcases.push({ x, z, mesh, taken: game.saveData.briefcases.includes(`${x},${z}`), id: `${x},${z}` });
}

// Objective marker beam.
const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(1.1, 1.1, 70, 12, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false }));
beam.visible = false;
scene.add(beam);
const ring = new THREE.Mesh(
  new THREE.RingGeometry(1.9, 2.4, 28),
  new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
ring.rotation.x = -Math.PI / 2;
ring.visible = false;
scene.add(ring);

// ---------------------------------------------------------------- saves
game.requestSave = () => {
  game.saveData.cash = player.cash;
  game.saveData.missionIndex = director.missionIndex;
  writeSave(game.saveData);
};
player.placeAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z, PLAYER_SPAWN.angle);
const existingSave = loadSave();
if (existingSave) {
  document.getElementById('btn-continue').classList.remove('hidden');
  game.saveData = existingSave;
  for (const b of game.briefcases) b.taken = existingSave.briefcases.includes(b.id);
}
audio.setMuted(game.saveData.muted === true);

// ---------------------------------------------------------------- crimes & consequences
let panicTimer = 0;
game.onCrime = (kind) => {
  panicTimer = 3.5;
  if (kind === 'shotFired') { if (police.level < 1) police.setWanted(1); }
  else if (kind === 'assault') { if (police.level < 1) police.setWanted(1); }
  else if (kind === 'pedDown') { police.setWanted(clamp(Math.max(police.level + 1, 2), 0, 5)); }
  else if (kind === 'copDown') { police.setWanted(clamp(Math.max(police.level + 1, 3), 0, 5)); }
  else if (kind === 'carStolen') { if (police.level < 1) police.setWanted(1); }
};
police.onShootPlayer = (dmg) => {
  if (player.mode === 'car' && player.vehicle) {
    player.vehicle.damage(2.5);
    player.hurt(dmg * 0.35);
  } else {
    player.hurt(dmg);
  }
};
police.onBusted = () => endRun('busted');
game.onStoryComplete = () => {
  hud.banner('STORY COMPLETE<small>Marco Serra owns the sunset — free roam and courier work remain</small>', 5);
};

function endRun(kind) {
  if (game.mode !== 'playing') return;
  game.mode = 'over';
  director.onPlayerDown();
  police.clear();
  const card = document.getElementById('endcard');
  const title = document.getElementById('endcard-title');
  const text = document.getElementById('endcard-text');
  if (kind === 'busted') {
    const fine = Math.round(player.cash * 0.15);
    player.cash -= fine;
    title.textContent = 'BUSTED';
    text.textContent = `Azura PD finally pinned Marco. $${fine.toLocaleString('en-US')} in fines and fees, and any job on the table is gone. He walks out of the station at dusk.`;
    player.placeAt(POIS.police.x + 6, POIS.police.z + 6, 0);
  } else {
    const bill = Math.round(player.cash * 0.1);
    player.cash -= bill;
    title.textContent = 'WASTED';
    text.textContent = `Marco wakes up at St. Marina Hospital with a $${bill.toLocaleString('en-US')} bill and a new respect for cover. The job, if there was one, is gone.`;
    player.placeAt(POIS.hospital.x + 6, POIS.hospital.z + 6, 0);
  }
  if (player.mode === 'car') player.exitCar(cityParts.colliders);
  player.dead = false;
  player.health = 100;
  game.requestSave();
  card.classList.remove('hidden');
  document.exitPointerLock?.();
}
document.getElementById('btn-again').addEventListener('click', () => {
  document.getElementById('endcard').classList.add('hidden');
  game.mode = 'playing';
  director.idleObjective();
});

// ---------------------------------------------------------------- flow
function startGame(useSave) {
  audio.ensure();
  audio.startPad();
  if (!useSave) {
    game.saveData = defaultSave();
    director.missionIndex = 0;
  } else {
    game.saveData = existingSave || loadSave() || defaultSave();
    director.missionIndex = game.saveData.missionIndex || 0;
  }
  player.cash = game.saveData.cash || 0;
  player.dead = false;
  player.health = 100;
  player.placeAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z, PLAYER_SPAWN.angle);
  game.camYaw = PLAYER_SPAWN.angle;
  document.getElementById('menu').classList.add('hidden');
  hud.show();
  game.mode = 'playing';
  director.idleObjective();
  hud.toast(useSave ? 'Welcome back to Port Azura' : 'WASD to move — talk to Lucia at Café Sol', 3.4);
  game.requestSave();
}
document.getElementById('btn-new').addEventListener('click', () => startGame(false));
document.getElementById('btn-continue').addEventListener('click', () => startGame(true));
document.getElementById('btn-resume').addEventListener('click', () => togglePause(false));
document.getElementById('btn-restart').addEventListener('click', () => { clearSave(); location.reload(); });
function togglePause(on) {
  if (on && game.mode === 'playing') {
    game.mode = 'paused';
    document.getElementById('pause-stats').innerHTML =
      `Cash $${player.cash.toLocaleString('en-US')} · Lifetime $${(game.saveData.lifetime || 0).toLocaleString('en-US')}<br>` +
      `Story jobs done: ${director.missionIndex} of 6 · Courier runs: ${game.saveData.couriersDone}<br>` +
      `Briefcases found: ${game.briefcases.filter((b) => b.taken).length} of ${game.briefcases.length}`;
    document.getElementById('pause').classList.remove('hidden');
    document.exitPointerLock?.();
  } else if (!on && game.mode === 'paused') {
    game.mode = 'playing';
    document.getElementById('pause').classList.add('hidden');
  }
}

// ---------------------------------------------------------------- input
const keys = {};
let mouseDown = false;
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (game.mode !== 'playing') return;
  if (e.code === 'Enter' && director.dialogueActive) director.advanceDialogue();
  else if (e.code === 'KeyE') {
    if (!director.dialogueActive) director.tryInteract();
  } else if (e.code === 'KeyF') toggleVehicle();
  else if (e.code === 'KeyQ') { if (player.mode === 'foot') game.combat.punch(); }
  else if (e.code === 'KeyM') {
    game.saveData.muted = !game.saveData.muted;
    audio.setMuted(game.saveData.muted);
    game.requestSave();
    hud.toast(game.saveData.muted ? 'Sound off' : 'Sound on', 1.4);
  } else if (e.code === 'Escape' || e.code === 'KeyP') togglePause(true);
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('mousedown', (e) => {
  if (game.mode !== 'playing') return;
  mouseDown = true;
  if (!shotName && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
  void e;
});
window.addEventListener('mouseup', () => { mouseDown = false; });
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || game.mode !== 'playing') return;
  game.camYaw -= e.movementX * 0.0026;
  game.camPitch = clamp(game.camPitch + e.movementY * 0.0022, -0.08, 1.05);
  game.freeLookTimer = 2.5;
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && game.mode === 'playing' && !shotName && game.time > 2) togglePause(true);
});
function toggleVehicle() {
  if (player.mode === 'foot') {
    const car = player.nearestCar(traffic.cars, 3.8);
    if (car) {
      const wasDriven = car.driver === 'traffic';
      if (player.enterCar(car)) {
        audio.door();
        if (director.targetCar !== car) {
          game.onCrime('carStolen');
          hud.toast(wasDriven ? 'Carjacked!' : 'Vehicle stolen', 1.6);
        }
      }
    }
  } else {
    // F is a hard stop and out — the handbrake yank always works.
    player.exitCar(cityParts.colliders);
    audio.door();
  }
}

// ---------------------------------------------------------------- spawning helpers
game.spawnSpecial = (type, x, z, angle, color) => {
  const car = new Car(scene, type, x, z, angle, color);
  traffic.addCar(car);
  return car;
};

// ---------------------------------------------------------------- per-frame updates
function carVsCar() {
  const cars = traffic.cars;
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    if (a.dead) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (b.dead) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 16 || d2 < 0.0001) continue;
      const d = Math.sqrt(d2);
      if (d >= 3.6) continue;
      const nx = dx / d, nz = dz / d;
      const push = (3.6 - d) / 2;
      a.x -= nx * push; a.z -= nz * push;
      b.x += nx * push; b.z += nz * push;
      const rel = Math.abs(a.speed - b.speed);
      if (rel > 3.5) {
        a.damage(rel * 0.7); b.damage(rel * 0.7);
        if (a === player.vehicle || b === player.vehicle) {
          audio.crash(Math.min(1, rel / 16));
          const other = a === player.vehicle ? b : a;
          if (other.type === 'cruiser') police.setWanted(clamp(Math.max(police.level, 2), 0, 5));
          if (director.targetCar === other) { /* wrecking the target is the job */ }
        }
      }
      const swap = (a.speed + b.speed) / 2;
      if (Math.abs(a.speed) > Math.abs(b.speed)) a.speed = swap * 0.7; else b.speed = swap * 0.7;
      a.syncMesh(); b.syncMesh();
    }
  }
}
function runOverPeds() {
  if (player.mode !== 'car' || !player.vehicle || Math.abs(player.vehicle.speed) < 3.5) return;
  const v = player.vehicle;
  for (const ped of pedestrians.peds) {
    if (ped.dead) continue;
    if (dist2d(ped.x, ped.z, v.x + v.fx * 1.8, v.z + v.fz * 1.8) < 1.7) {
      pedestrians.hurt(ped, 100);
      game.onCrime('pedDown');
      audio.crash(0.5);
    }
  }
}
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  // Substep the simulation so game time tracks wall time even when the
  // renderer is slow (software GL): up to ~0.34s per frame in <=0.06s steps.
  const dtRaw = Math.min(clock.getDelta(), 0.34);
  game.time += dtRaw;
  const playing = game.mode === 'playing';
  const steps = playing ? Math.max(1, Math.ceil(dtRaw / 0.06)) : 1;
  const dt = dtRaw / steps;
  for (let sub = 0; sub < steps; sub++) {
  if (playing) {
    game.clockMinutes += dt * 0.9;
    if (game.clockMinutes > 20 * 60) game.clockMinutes = 17 * 60;
    // --- player control
    if (player.mode === 'foot') {
      const camF = { x: Math.sin(game.camYaw), z: Math.cos(game.camYaw) };
      const camR = { x: -camF.z, z: camF.x };
      const iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) + (keys.KeyS || keys.ArrowDown ? -1 : 0);
      const ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) + (keys.KeyA || keys.ArrowLeft ? -1 : 0);
      const dirX = camF.x * iz + camR.x * ix;
      const dirZ = camF.z * iz + camR.z * ix;
      const pf = { x: player.fx, z: player.fz };
      const pr = { x: -pf.z, z: pf.x };
      player.updateOnFoot(dt, {
        x: dirX * pr.x + dirZ * pr.z,
        z: dirX * pf.x + dirZ * pf.z,
        sprint: keys.ShiftLeft || keys.ShiftRight,
        jump: keys.Space,
      }, cityParts.colliders);
    } else if (player.vehicle) {
      const v = player.vehicle;
      const throttle = (keys.KeyW || keys.ArrowUp ? 1 : 0) + (keys.KeyS || keys.ArrowDown ? -1 : 0);
      const steer = (keys.KeyA || keys.ArrowLeft ? 1 : 0) + (keys.KeyD || keys.ArrowRight ? -1 : 0);
      v.step(dt, { throttle, steer, handbrake: keys.Space }, cityParts.colliders);
      if (v.crashAmount > 0.25) audio.crash(v.crashAmount);
      if (v.dead) { player.exitCar(cityParts.colliders); hud.toast('The car is wrecked', 2); }
    }
    player.update(dt);
    if (mouseDown && !director.dialogueActive) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      game.combat.shoot({ x: player.x, y: 1.45, z: player.z }, { x: dir.x, y: dir.y, z: dir.z });
    }
    // --- world
    traffic.update(dt, player);
    carVsCar();
    runOverPeds();
    police.update(dt, player, audio);
    director.update(dt);
    game.combat.update(dt);
    if (panicTimer > 0) panicTimer -= dt;
    pedestrians.update(dt, player, panicTimer > 0 ? (game.combat.lastShotAt || player) : null);
    cityParts.update(dt);
    // NPC idle sway.
    for (const id of Object.keys(game.npcs)) {
      const npc = game.npcs[id];
      npc.phase += dt * 1.4;
      animatePerson(npc.mesh, npc.phase, 0.1);
    }
    // Briefcase pickup.
    for (const b of game.briefcases) {
      b.mesh.visible = !b.taken;
      if (b.taken) continue;
      b.mesh.rotation.y += dt * 1.4;
      if (player.mode === 'foot' && dist2d(player.x, player.z, b.x, b.z) < 1.9) {
        b.taken = true;
        game.saveData.briefcases.push(b.id);
        player.cash += 150;
        audio.pickup();
        hud.toast('Hidden briefcase: + $150', 2.2);
        game.requestSave();
      }
    }
    // Hospital patch-up.
    if (player.mode === 'foot' && player.health < 100 && dist2d(player.x, player.z, POIS.hospital.x, POIS.hospital.z) < 9) {
      player.heal(14 * dt);
    }
    // Audio: engine voice follows the player's car.
    if (player.mode === 'car' && player.vehicle) {
      const v = player.vehicle;
      audio.engine(true, Math.abs(v.speed) / v.spec.topSpeed, Math.abs(v.speed) / v.spec.topSpeed);
    } else {
      audio.engine(false, 0, 0);
    }
    if (player.dead) endRun('wasted');
  }
  }

  // --- objective marker visuals
  const marker = director.marker;
  if (marker && playing) {
    beam.visible = true; ring.visible = true;
    beam.position.set(marker.x, 34, marker.z);
    ring.position.set(marker.x, 0.25, marker.z);
    ring.scale.setScalar(1 + Math.sin(game.time * 3.2) * 0.12);
  } else {
    beam.visible = false; ring.visible = false;
  }

  // --- camera
  if (game.camOverride) {
    const o = game.camOverride;
    camera.position.set(o.x, o.y, o.z);
    camera.lookAt(o.lx, o.ly, o.lz);
  } else if (game.mode === 'menu') {
    const t = game.time * 0.07;
    camera.position.set(PLAYER_SPAWN.x + Math.sin(t) * 26, 9.5, PLAYER_SPAWN.z + Math.cos(t) * 26);
    camera.lookAt(player.x, 1.5, player.z);
  } else {
    const target = player.mode === 'car' && player.vehicle ? player.vehicle : player;
    if (player.mode === 'car' && player.vehicle) {
      // Ease the camera behind the car unless the player is free-looking.
      if (game.freeLookTimer > 0) game.freeLookTimer -= dt;
      else {
        let delta = ((player.vehicle.angle - game.camYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        game.camYaw += delta * Math.min(1, dt * 2.6);
      }
    }
    const dist = player.mode === 'car' ? 11.5 : 8;
    const fx = Math.sin(game.camYaw), fz = Math.cos(game.camYaw);
    const horiz = dist * Math.cos(game.camPitch);
    const cx = target.x - fx * horiz;
    const cz = target.z - fz * horiz;
    const cy = 1.8 + dist * Math.sin(game.camPitch) + (player.mode === 'car' ? 1.2 : 0.6);
    camera.position.set(cx, Math.max(cy, 0.7), cz);
    camera.lookAt(target.x + fx * 3.5, 1.7, target.z + fz * 3.5);
  }

  if (playing || game.mode === 'over') hud.update(dt, game);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- shot mode / go
window.__game = game;
if (shotName) {
  document.getElementById('menu').classList.add('hidden');
  hud.show();
  game.mode = 'playing';
  player.cash = 250;
  stageShot(game, shotName);
  setTimeout(() => { window.__SHOT_READY = true; }, 1600);
}
frame();
