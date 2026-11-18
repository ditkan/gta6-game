// main.js — boots Port Azura: Heat: renderer, scene and sunset, the city,
// traffic, pedestrians, police, combat, missions and the HUD; owns the input,
// the third-person camera, the game states (menu, playing, paused, busted,
// wasted, story complete) and the save game. Every other module is a system
// this file wires together.

import * as THREE from 'three';
import { PLAYER } from './config.js';
import { makeRng, clamp, dist2d } from './rng.js';
import { buildCity } from './city.js';
import { Vehicle, TrafficSystem } from './vehicles.js';
import { Pedestrians, makePersonMesh } from './people.js';
import { Player } from './player.js';
import { PoliceSystem } from './police.js';
import { Combat } from './combat.js';
import { MissionDirector } from './missions.js';
import { HUD } from './hud.js';
import { SoundEngine } from './audio.js';
import { SaveSystem } from './save.js';
import { applyShot } from './shots.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const seed = Number(params.get('seed') ?? 7) || 7;
const rng = makeRng(seed);

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1600);
camera.position.set(-60, 4, 44);

// ------------------------------------------------------------------ world
const sound = new SoundEngine();
const city = buildCity(scene, rng);
const hud = new HUD();
const player = new Player(scene, rng);
player.placeAt(-40, 20, Math.PI / 2);
const traffic = new TrafficSystem(scene, city, rng);
traffic.spawnParked(16);
const peds = new Pedestrians(scene, city, rng);
const police = new PoliceSystem(scene, city, rng, sound);
const combat = new Combat(scene, sound);

const game = {
  scene, city, player, police, traffic, peds, hud, sound, rng, combat,
  specials: [],
  state: { cash: 120, packagesFound: [], sideJobs: 0, earned: 0 },
  mode: shotName ? 'playing' : 'menu',   // menu | playing | paused | endcard
  freezeDirector: false,
  cameraOverride: null,
  shotObjective: null,
  requestSave: () => saveGame(false),
  onStoryComplete: () => {
    showEndcard('win', 'STORY COMPLETE',
      `Marco and Lucia own the Port Azura run now.\nFinal score: $${(game.state.earned ?? 0).toLocaleString('en-US')} earned across the city.\nThe city is yours: courier runs at the garage, briefcases to find, stars to earn.`);
  },
  // A standing character a mission places in the world (a passenger, say).
  spawnPedAt(x, z) {
    const mesh = makePersonMesh(rng, { shirt: 0xf5b81d, pants: 0x2c3550 });
    mesh.position.set(x, 0, z);
    mesh.rotation.y = -Math.PI / 2;
    scene.add(mesh);
    return mesh;
  },
  removeExtra(obj) {
    scene.remove(obj);
  },
  spawnSpecial(style, paint, x, z, angle, opts) {
    const v = new Vehicle(scene, style, paint, x, z, angle, opts);
    game.specials.push(v);
    return v;
  },
  removeSpecial(v) {
    const i = game.specials.indexOf(v);
    if (i >= 0) game.specials.splice(i, 1);
    v.dispose(scene);
  },
  allVehicles() {
    return [...traffic.cars, ...police.cruisers, ...game.specials];
  },
};
game.director = new MissionDirector(game);
const director = game.director;
window.__game = game;

// ------------------------------------------------------------------ input
const keys = new Set();
let mouseDown = false;
let pointerLocked = false;
let camYaw = Math.PI * 0.75;
let camPitch = 0.32;
const clockState = { minutes: 17 * 60 + 42 };

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (game.mode === 'playing') {
    if (e.code === 'Enter' && director.dialogueActive) director.advanceDialogue();
    if (e.code === 'KeyF') tryEnterExitCar();
    if (e.code === 'KeyE') director.tryInteract();
    if (e.code === 'KeyM') { sound.setMuted(!sound.muted); hud.toast(sound.muted ? 'Sound off' : 'Sound on'); }
    if (e.code === 'Escape') pauseGame();
  } else if (game.mode === 'paused' && e.code === 'Escape') resumeGame();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousedown', (e) => {
  if (game.mode !== 'playing') return;
  sound.unlock();
  if (!pointerLocked && !shotName) canvas.requestPointerLock();
  if (e.button === 0) mouseDown = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});
window.addEventListener('mousemove', (e) => {
  if (!pointerLocked || game.mode !== 'playing') return;
  camYaw -= e.movementX * 0.0026;
  camPitch = clamp(camPitch + e.movementY * 0.0022, -0.12, 1.05);
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------- car stealing
const crimeCooldowns = new Map();
function reportCrime(kind, x, z) {
  const now = performance.now();
  const key = kind;
  if (now - (crimeCooldowns.get(key) ?? -9999) < 1400) return;
  crimeCooldowns.set(key, now);
  police.reportCrime(kind);
  void x; void z;
}

function nearestVehicle(maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const v of game.allVehicles()) {
    if (v === player.vehicle) continue;
    const d = dist2d(player.x, player.z, v.x, v.z);
    if (d < bestD) { best = v; bestD = d; }
  }
  return best;
}

function tryEnterExitCar() {
  if (director.dialogueActive) return;
  if (player.mode === 'car') {
    player.exitCar(city.colliders);
    sound.engine(0, false);
    return;
  }
  const v = nearestVehicle(3.4);
  if (!v) return;
  const wasParked = v.driver === null;
  const wasTraffic = v.driver === 'traffic';
  if (v.isPolice) {
    const i = police.cruisers.indexOf(v);
    if (i >= 0) police.cruisers.splice(i, 1);
  }
  player.enterCar(v);
  camYaw = v.angle + Math.PI;
  if (wasParked || wasTraffic) {
    // A theft is a crime when anyone is around to see it.
    const witnessed = peds.list.some((p) => p.state !== 'dead' && dist2d(p.x, p.z, v.x, v.z) < 19) || police.cruisers.length > 0;
    if (witnessed) {
      reportCrime('theft', v.x, v.z);
      hud.toast(wasTraffic ? 'Vehicle stolen — driver not included' : 'Vehicle stolen');
    }
  }
}

// ------------------------------------------------------------ combat wiring
peds.onHit = (ped, byPlayerCar) => {
  if (!byPlayerCar) return;
  if (ped.state === 'dead') reportCrime('killPed', ped.x, ped.z);
  else reportCrime('hitPed', ped.x, ped.z);
  peds.scare(ped.x, ped.z, 13);
};

const combatCtx = {
  get peds() { return peds.list; },
  get vehicles() { return game.allVehicles(); },
  get colliders() { return city.colliders; },
  damagePed: (ped, amount, fx, fz) => peds.damage(ped, amount, fx, fz),
  onCrime: (kind, x, z) => reportCrime(kind, x, z),
  onPedDown: () => {},
  onVehicleHit: (v) => { if (v.isPolice) peds.scare(v.x, v.z, 10); },
};

police.onBusted = () => {
  if (game.mode !== 'playing') return;
  const fine = 150 + police.level * 50;
  game.state.cash = Math.max(0, game.state.cash - fine);
  director.onPlayerGone('busted');
  showEndcard('busted', 'BUSTED', `The Azura PD walk Marco out of the station $${fine} lighter.\nTry not to get cornered next time.`);
  police.clearWanted();
  police.disposeAll();
  if (player.mode === 'car') player.exitCar(city.colliders);
  player.placeAt(47, -52, -Math.PI / 2);
  player.healFull();
  saveGame(false);
};

function onPlayerWasted() {
  const fee = 100;
  game.state.cash = Math.max(0, game.state.cash - fee);
  director.onPlayerGone('wasted');
  showEndcard('wasted', 'WASTED', `Marco wakes up at Azura General, $${fee} poorer and no wiser.`);
  police.clearWanted();
  police.disposeAll();
  if (player.mode === 'car') player.exitCar(city.colliders);
  player.placeAt(-40, -94, Math.PI / 2);
  player.healFull();
  saveGame(false);
}

// ------------------------------------------------------------------- menus
const $ = (id) => document.getElementById(id);
function refreshContinue() { $('btn-continue').disabled = !SaveSystem.has(); }
function startGame(fresh) {
  sound.unlock();
  sound.music(true);
  if (fresh) {
    SaveSystem.clear();
    game.state.cash = 120;
    game.state.packagesFound = [];
    game.state.sideJobs = 0;
    game.state.earned = 0;
    director.missionIndex = 0;
    director.restorePackages([]);
    player.placeAt(-40, 20, Math.PI / 2);
  } else {
    loadGame();
  }
  $('menu').classList.add('hidden');
  hud.show();
  game.mode = 'playing';
  hud.banner('PORT AZURA', 'Meet Lucia at Café Sol', 2600);
}
function pauseGame() {
  if (game.mode !== 'playing') return;
  game.mode = 'paused';
  $('pause-stats').textContent =
    `Cash $${game.state.cash.toLocaleString('en-US')} · Score $${(game.state.earned ?? 0).toLocaleString('en-US')}\nStory jobs: ${director.missionIndex}/${6} · Courier runs: ${game.state.sideJobs} · Briefcases: ${game.state.packagesFound.length}/10`;
  $('pause').classList.remove('hidden');
  document.exitPointerLock?.();
}
function resumeGame() {
  $('pause').classList.add('hidden');
  game.mode = 'playing';
}
function showEndcard(kind, title, text) {
  game.mode = 'endcard';
  const t = $('endcard-title');
  t.textContent = title;
  t.className = kind;
  $('endcard-text').textContent = text;
  $('endcard').classList.remove('hidden');
  document.exitPointerLock?.();
}
$('btn-new').addEventListener('click', () => { sound.uiClick(); startGame(true); });
$('btn-continue').addEventListener('click', () => { sound.uiClick(); startGame(false); });
$('btn-how').addEventListener('click', () => { sound.uiClick(); $('how').classList.toggle('hidden'); });
$('btn-resume').addEventListener('click', () => { sound.uiClick(); resumeGame(); });
$('btn-save').addEventListener('click', () => { sound.uiClick(); saveGame(true); resumeGame(); });
$('btn-quit').addEventListener('click', () => {
  sound.uiClick();
  $('pause').classList.add('hidden');
  hud.hide();
  $('menu').classList.remove('hidden');
  game.mode = 'menu';
  refreshContinue();
});
$('endcard') && $('btn-endcard').addEventListener('click', () => {
  sound.uiClick();
  $('endcard').classList.add('hidden');
  game.mode = 'playing';
});

// -------------------------------------------------------------------- save
function saveGame(announce) {
  const data = {
    cash: game.state.cash,
    missionIndex: director.missionIndex,
    packagesFound: game.state.packagesFound,
    sideJobs: game.state.sideJobs,
    earned: game.state.earned ?? 0,
    player: { x: player.x, z: player.z, angle: player.angle },
  };
  if (SaveSystem.store(data) && announce) hud.toast('Game saved');
  refreshContinue();
}
function loadGame() {
  const data = SaveSystem.load();
  if (!data) return;
  game.state.cash = data.cash ?? 120;
  game.state.packagesFound = data.packagesFound ?? [];
  game.state.sideJobs = data.sideJobs ?? 0;
  game.state.earned = data.earned ?? 0;
  director.missionIndex = data.missionIndex ?? 0;
  director.restorePackages(game.state.packagesFound);
  if (data.player) player.placeAt(data.player.x, data.player.z, data.player.angle);
}
game.requestSave = () => saveGame(false);

// ------------------------------------------------------------------- loop
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(-60, 4, 44);
let last = performance.now();
let shotFrames = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const playing = game.mode === 'playing';
  const frozen = director.dialogueActive;

  // ----- simulation
  if (playing && !frozen) {
    stepGame(dt);
  } else if (playing && frozen) {
    // The world idles during dialogue; only ambient systems move.
    traffic.update(dt, player.x, player.z, city.colliders, game.allVehicles());
    peds.update(dt, { playerX: player.x, playerZ: player.z, vehicles: game.allVehicles(), colliders: city.colliders });
  }
  city.update(dt, now / 1000);

  // ----- camera
  updateCamera(dt, playing);
  city.sun.position.set(camTarget.x - 260, 210, camTarget.z - 140);
  city.sun.target.position.copy(camTarget);

  // ----- HUD
  if (game.mode !== 'menu') syncHud();
  renderer.render(scene, camera);

  if (shotName) {
    shotFrames++;
    if (shotFrames === 110) window.__SHOT_READY = true;
  }
}

function stepGame(dt) {
  // Player / driving input.
  const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const side = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  if (player.mode === 'car') {
    const v = player.vehicle;
    v.step(dt, { throttle: fwd, steer: side * (keys.has('Space') ? 1.6 : 1) }, city.colliders);
    if (keys.has('Space')) v.speed -= v.speed * dt * 1.4; // handbrake drag
    player.x = v.x;
    player.z = v.z;
    player.angle = v.angle;
    sound.engine(clamp(Math.abs(v.speed) / 24, 0, 1), true);
  } else {
    sound.engine(0, false);
    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);
    // Wish direction: forward on screen is away from the camera.
    const move = {
      x: -sin * fwd - cos * side,
      z: -cos * fwd + sin * side,
      sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      jump: keys.has('Space'),
    };
    player.updateOnFoot(dt, move, city.colliders);
    // Shooting and punching.
    if (mouseDown && player.shotCooldown <= 0) {
      player.shotCooldown = PLAYER.shotCooldown;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const origin = new THREE.Vector3(player.x, 1.45 + player.y, player.z);
      combat.shoot(origin, dir, combatCtx);
      peds.scare(player.x, player.z, 17);
    }
    if (keys.has('KeyQ')) {
      keys.delete('KeyQ');
      combat.punch(player, combatCtx);
    }
  }

  // Systems.
  traffic.update(dt, player.x, player.z, city.colliders, game.allVehicles());
  peds.update(dt, { playerX: player.x, playerZ: player.z, vehicles: game.allVehicles(), colliders: city.colliders });
  police.update(dt, {
    player,
    colliders: city.colliders,
    onPlayerShot: (cruiser, hit) => {
      const from = new THREE.Vector3(cruiser.x, 1.2, cruiser.z);
      const to = new THREE.Vector3(player.x, 1.2, player.z);
      combat.spawnTracer(from.x, from.y, from.z, to.x + (hit ? 0 : 2.4), to.y, to.z, 0xff9a8a);
      sound.shot();
    },
  });
  combat.update(dt);
  carCarCollisions(dt);
  if (!game.freezeDirector) director.update(dt);

  // Interaction prompt.
  if (player.mode === 'foot') {
    const near = nearestVehicle(3.4);
    const talk = director.interactPrompt();
    hud.setPrompt(talk ?? (near ? `F — ${near.driver === null && !near.isPolice ? 'Steal' : 'Take'} the ${near.style}` : null));
  } else {
    hud.setPrompt(null);
  }

  // Clock: one game minute every two real seconds.
  clockState.minutes = (clockState.minutes + dt * 0.5) % (24 * 60);

  if (player.dead) onPlayerWasted();
}

let collisionClock = 0;
function carCarCollisions(dt) {
  collisionClock -= dt;
  const vehicles = game.allVehicles();
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      const d = dist2d(a.x, a.z, b.x, b.z);
      if (d > 3.15 || d === 0) continue;
      const push = (3.15 - d) / 2;
      const nx = (b.x - a.x) / d;
      const nz = (b.z - a.z) / d;
      if (!a.frozen) { a.x -= nx * push; a.z -= nz * push; }
      if (!b.frozen) { b.x += nx * push; b.z += nz * push; }
      const rel = Math.abs(a.speed - b.speed);
      if (rel > 4) {
        const dmg = (rel - 3) * 1.5;
        a.damage(dmg * 0.6);
        b.damage(dmg * 0.6);
        if ((a.driver === 'player' || b.driver === 'player') && collisionClock <= 0) {
          collisionClock = 0.5;
          sound.crash(clamp(rel / 15, 0.3, 1));
          const other = a.driver === 'player' ? b : a;
          if (other.isPolice) reportCrime('ramPolice', other.x, other.z);
          else reportCrime('hitCar', other.x, other.z);
        }
      }
      if (a.driver !== 'player') a.speed *= 0.55;
      if (b.driver !== 'player') b.speed *= 0.55;
      a.syncMesh();
      b.syncMesh();
    }
  }
}

function updateCamera(dt, playing) {
  const inCar = player.mode === 'car';
  const tx = inCar ? player.vehicle.x : player.x;
  const tz = inCar ? player.vehicle.z : player.z;
  camTarget.set(tx, 1.4, tz);
  if (game.cameraOverride) {
    camera.position.set(...game.cameraOverride.pos);
    camera.lookAt(...game.cameraOverride.look);
    return;
  }
  if (inCar && playing) {
    // Ease the camera behind the car while driving.
    const behind = player.vehicle.angle + Math.PI;
    let d = behind - camYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(player.vehicle.speed) > 3) camYaw += d * clamp(dt * 1.6, 0, 1);
  }
  const dist = inCar ? 10.5 : 7.6;
  const cx = tx - Math.sin(camYaw) * Math.cos(camPitch) * dist;
  const cz = tz - Math.cos(camYaw) * Math.cos(camPitch) * dist;
  const cy = 1.4 + Math.sin(camPitch) * dist + (inCar ? 1.2 : 0.6);
  camPos.x += (cx - camPos.x) * clamp(dt * 7, 0, 1);
  camPos.y += (cy - camPos.y) * clamp(dt * 7, 0, 1);
  camPos.z += (cz - camPos.z) * clamp(dt * 7, 0, 1);
  camera.position.copy(camPos);
  camera.lookAt(camTarget);
}

let lastDistrictName = '';
let lastDistrictToastAt = 0;

function syncHud() {
  hud.setHealth(player.health / PLAYER.maxHealth);
  hud.setCarHealth(player.mode === 'car' ? player.vehicle.health / 100 : null);
  hud.setSpeedo(player.mode === 'car' ? Math.abs(player.vehicle.speed) * 3.6 : 0, player.mode === 'car');
  hud.setCash(game.state.cash);
  hud.setWanted(police.level, police.active && police.timeSinceCrime > 6);
  hud.setBusted(police.busted01);
  hud.setCrosshair(player.mode === 'foot');
  const hh = Math.floor(clockState.minutes / 60);
  const mm = Math.floor(clockState.minutes % 60);
  hud.setClock(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  const px = player.mode === 'car' ? player.vehicle.x : player.x;
  const pz = player.mode === 'car' ? player.vehicle.z : player.z;
  const districtName = city.districtAt(px, pz);
  hud.setDistrict(districtName);
  // Districts announce themselves, GTA-style, when Marco crosses into one.
  if (districtName !== lastDistrictName) {
    const nowMs = performance.now();
    if (lastDistrictName && game.mode === 'playing' && !shotName && nowMs - lastDistrictToastAt > 6000) {
      hud.toast(districtName, 1800);
      lastDistrictToastAt = nowMs;
    }
    lastDistrictName = districtName;
  }
  hud.drawMinimap({
    x: px, z: pz,
    heading: Math.atan2(Math.sin(camYaw) * -1, Math.cos(camYaw) * -1) + Math.PI,
    cars: [...traffic.cars, ...game.specials],
    police: police.cruisers,
    objective: game.shotObjective ?? director.objectivePos(),
  });
}

// ------------------------------------------------------------------- boot
refreshContinue();
if (shotName) {
  document.getElementById('menu').classList.add('hidden');
  hud.show();
  applyShot(game, shotName);
}
requestAnimationFrame(frame);
