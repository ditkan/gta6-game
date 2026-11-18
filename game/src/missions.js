// missions.js — the story of Port Azura: Heat. Lucia Serra runs the garage
// and feeds Marco work: five story jobs (steal, deliver, wreck, race, and
// one last armoured-van run), repeatable courier runs between them, and ten
// hidden briefcases stashed around the city. Owns the objective marker, the
// dialogue queue, mission timers and failure/restart.

import * as THREE from 'three';
import { dist2d } from './rng.js';

const PACKAGE_SPOTS = [
  { x: 232, z: 60 }, { x: -200, z: -207 }, { x: 120, z: 127 }, { x: -47, z: -33 },
  { x: 87, z: 127 }, { x: -167, z: 167 }, { x: 47, z: -167 }, { x: -87, z: 207 },
  { x: 207, z: -47 }, { x: 7, z: 87 },
];

export class MissionDirector {
  constructor(game) {
    this.game = game;
    this.state = 'idle';            // idle | intro | active | outro
    this.mission = null;            // current mission definition
    this.missionIndex = 0;          // next story mission
    this.stepIndex = 0;
    this.steps = [];
    this.dialogue = [];
    this.missionTimeLeft = null;
    this.missionVehicles = [];
    this.extras = [];
    this.targetCar = null;
    this.sideJob = false;
    this.packages = [];
    this.buildPackages();
    this.buildMarker();
  }

  get storyDone() { return this.missionIndex >= STORY.length; }
  get dialogueActive() { return this.state === 'intro' || this.state === 'outro'; }
  get busy() { return this.state === 'active' || this.dialogueActive; }

  buildMarker() {
    const geo = new THREE.CylinderGeometry(2.3, 2.3, 34, 18, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.33, side: THREE.DoubleSide, depthWrite: false });
    this.marker = new THREE.Mesh(geo, mat);
    this.marker.position.y = 17;
    this.marker.visible = false;
    this.game.scene.add(this.marker);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.7, 2.3, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -16.8;
    this.marker.add(ring);
  }

  buildPackages() {
    const geo = new THREE.BoxGeometry(0.62, 0.3, 0.44);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd23e });
    PACKAGE_SPOTS.forEach((spot, i) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(spot.x, 0.6, spot.z);
      mesh.rotation.y = i * 0.7;
      this.game.scene.add(mesh);
      this.packages.push({ id: i, x: spot.x, z: spot.z, mesh, taken: false });
    });
  }

  restorePackages(foundIds) {
    for (const pkg of this.packages) {
      if (foundIds.includes(pkg.id)) {
        pkg.taken = true;
        pkg.mesh.visible = false;
      }
    }
  }

  // Where the player should head right now (minimap + beacon), or null.
  objectivePos() {
    if (this.state === 'active' && this.steps[this.stepIndex]) {
      const step = this.steps[this.stepIndex];
      if (step.dynamicPos) return step.dynamicPos();
      if (step.x !== undefined) return { x: step.x, z: step.z };
    }
    if (this.state === 'idle' && !this.storyDone) {
      const cafe = this.game.city.poi.cafe;
      return { x: cafe.x + 12, z: cafe.z };
    }
    if (this.state === 'idle' && this.storyDone) {
      const garage = this.game.city.poi.garage;
      return { x: garage.x + 12, z: garage.z };
    }
    return null;
  }

  interactPrompt() {
    const { player, city } = this.game;
    if (this.state !== 'idle' || player.mode !== 'foot') return null;
    if (!this.storyDone) {
      const cafe = city.poi.cafe;
      if (dist2d(player.x, player.z, cafe.x + 12, cafe.z) < 3.6) return 'E — Talk to Lucia';
    } else {
      const garage = city.poi.garage;
      if (dist2d(player.x, player.z, garage.x + 12, garage.z) < 3.6) return 'E — Take a courier run';
    }
    return null;
  }

  tryInteract() {
    if (!this.interactPrompt()) return false;
    if (!this.storyDone) this.startMission(STORY[this.missionIndex], false);
    else this.startCourierRun();
    return true;
  }

  startMission(def, sideJob) {
    const g = this.game;
    this.mission = def;
    this.sideJob = sideJob;
    this.missionVehicles = [];
    this.targetCar = null;
    this.steps = def.buildSteps(this);
    this.stepIndex = 0;
    this.missionTimeLeft = def.timeLimit ?? null;
    this.dialogue = [...def.intro];
    this.state = 'intro';
    this.showDialogueLine();
    g.hud.banner(def.title, sideJob ? 'Courier run' : `Job ${this.missionIndex + 1} of ${STORY.length}`, 2400);
  }

  startCourierRun() {
    const g = this.game;
    const pois = [g.city.poi.bank, g.city.poi.hotel, g.city.poi.port, g.city.poi.hospital, g.city.poi.safehouse, g.city.poi.cafe];
    const a = pois[Math.floor(g.rng.next() * pois.length)];
    let b = pois[Math.floor(g.rng.next() * pois.length)];
    if (b === a) b = pois[(pois.indexOf(a) + 2) % pois.length];
    const dist = dist2d(a.x, a.z, b.x, b.z);
    // Repeat work pays better — and once Marco has a reputation, it runs hotter.
    const reward = Math.round(dist * 0.9) + g.state.sideJobs * 20;
    const hot = g.state.sideJobs >= 2;
    const def = {
      title: 'Courier Run',
      intro: [['LUCIA', `Parcel at the depot, wheels. Drop it across town and the ${reward} is yours.`]],
      outro: [['LUCIA', 'Clean run. You always were my best mistake.']],
      reward,
      timeLimit: Math.round(dist / 8.5 + 50),
      buildSteps: () => [
        { text: 'Collect the parcel', x: a.x + 12, z: a.z, radius: 6.5 },
        {
          text: 'Deliver the parcel', x: b.x + 12, z: b.z, radius: 7,
          start: hot ? (dd) => { dd.game.police.setWanted(Math.max(dd.game.police.level, 1)); dd.game.hud.toast('Someone tipped off the Azura PD'); } : undefined,
        },
      ],
    };
    this.startMission(def, true);
  }

  showDialogueLine() {
    const g = this.game;
    const line = this.dialogue[0];
    if (line) g.hud.dialogue(line[0], line[1]);
    else g.hud.dialogue(null);
  }

  advanceDialogue() {
    const g = this.game;
    if (!this.dialogueActive) return;
    g.sound.uiClick();
    this.dialogue.shift();
    if (this.dialogue.length) {
      this.showDialogueLine();
      return;
    }
    g.hud.dialogue(null);
    if (this.state === 'intro') {
      this.state = 'active';
      const step = this.steps[0];
      if (step?.start) step.start(this);
    } else if (this.state === 'outro') {
      this.completeMission();
    }
  }

  completeMission() {
    const g = this.game;
    const reward = this.mission.reward;
    g.state.cash += reward;
    g.state.earned = (g.state.earned ?? 0) + reward;
    g.sound.cash();
    g.hud.banner('JOB DONE', `+$${reward.toLocaleString('en-US')}`);
    this.cleanupVehicles();
    this.cleanupExtras();
    const wasSide = this.sideJob;
    this.mission = null;
    this.state = 'idle';
    if (!wasSide) {
      this.missionIndex++;
      if (this.storyDone) g.onStoryComplete();
    } else {
      g.state.sideJobs++;
    }
    g.requestSave();
  }

  failMission(reason) {
    const g = this.game;
    if (!this.busy) return;
    g.sound.fail();
    g.hud.banner('JOB FAILED', reason);
    g.hud.dialogue(null);
    this.cleanupVehicles();
    this.cleanupExtras();
    this.mission = null;
    this.state = 'idle';
    this.missionTimeLeft = null;
  }

  onPlayerGone(kind) {
    if (this.state === 'active') this.failMission(kind === 'busted' ? 'The job dies with the arrest.' : 'The job dies with Marco.');
  }

  cleanupVehicles() {
    for (const v of this.missionVehicles) this.game.removeSpecial(v);
    this.missionVehicles = [];
    this.targetCar = null;
  }

  currentStep() { return this.steps[this.stepIndex] ?? null; }

  // Scene dressing a mission spawns (a waiting passenger, say): tracked so a
  // finish, failure or completion never leaves it standing in the street.
  trackExtra(obj) { this.extras.push(obj); }
  untrackExtra(obj) {
    const i = this.extras.indexOf(obj);
    if (i >= 0) this.extras.splice(i, 1);
    this.game.removeExtra(obj);
  }
  cleanupExtras() {
    for (const obj of this.extras) this.game.removeExtra(obj);
    this.extras = [];
  }

  update(dt) {
    const g = this.game;
    const { player, hud } = g;

    // Hidden briefcases.
    if (player.mode === 'foot') {
      for (const pkg of this.packages) {
        if (pkg.taken) continue;
        pkg.mesh.rotation.y += dt * 1.6;
        pkg.mesh.position.y = 0.6 + Math.sin(performance.now() / 300 + pkg.id) * 0.12;
        if (dist2d(player.x, player.z, pkg.x, pkg.z) < 1.7) {
          pkg.taken = true;
          pkg.mesh.visible = false;
          g.state.cash += 100;
          g.state.earned = (g.state.earned ?? 0) + 100;
          g.state.packagesFound.push(pkg.id);
          g.sound.pickup();
          hud.toast(`Hidden briefcase found — $${100} (${g.state.packagesFound.length}/10)`);
          g.requestSave();
        }
      }
    }

    if (this.state !== 'active') {
      this.marker.visible = false;
      if (this.state === 'idle') {
        const pos = this.objectivePos();
        hud.setObjective(this.storyDone ? 'Free roam — see Lucia’s garage for courier runs' : 'Meet Lucia at Café Sol');
        if (pos) {
          this.marker.visible = true;
          this.marker.position.set(pos.x, 17, pos.z);
        }
      }
      return;
    }

    // Mission timer.
    if (this.missionTimeLeft !== null) {
      this.missionTimeLeft -= dt;
      if (this.missionTimeLeft <= 0) {
        this.failMission('Out of time.');
        return;
      }
    }

    const step = this.currentStep();
    if (!step) return;
    if (step.update) step.update(this, dt);
    const pos = step.dynamicPos ? step.dynamicPos() : step;
    if (pos && pos.x !== undefined) {
      this.marker.visible = true;
      this.marker.position.set(pos.x, 17, pos.z);
    } else {
      this.marker.visible = false;
    }
    let text = step.text;
    if (this.missionTimeLeft !== null) {
      const s = Math.max(0, Math.ceil(this.missionTimeLeft));
      text += ` — ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    hud.setObjective(text);

    if (step.check && step.check(this)) {
      g.sound.objective();
      if (step.finish) step.finish(this);
      this.stepIndex++;
      if (this.stepIndex >= this.steps.length) {
        this.dialogue = [...this.mission.outro];
        this.state = 'outro';
        this.showDialogueLine();
        hud.setObjective('');
        this.marker.visible = false;
      } else {
        const next = this.currentStep();
        if (next?.start) next.start(this);
      }
    }
    if (step.failIf && step.failIf(this)) this.failMission(step.failText || 'The job fell apart.');
  }
}

// ---------------------------------------------------------------------------
const STORY = [
  {
    title: 'First Wheels',
    reward: 300,
    intro: [
      ['LUCIA', 'Marco. Four years away and the city still smells like money and sunscreen.'],
      ['MARCO', 'Lucia. Tell me there is work that is not legal.'],
      ['LUCIA', 'A gold coupe sits at the marina, keys in, owner at lunch. Bring it to my garage. Quietly-ish.'],
    ],
    outro: [
      ['LUCIA', 'She purrs. The owner will report it in an hour — you have a head start on being forgotten.'],
      ['LUCIA', 'Three hundred. Spend it slow, wheels.'],
    ],
    buildSteps(d) {
      const car = d.game.spawnSpecial('coupe', 0xe8b13a, 193, 48, -Math.PI / 2, {});
      d.missionVehicles.push(car);
      return [
        {
          text: 'Steal the gold coupe at the marina', x: 193, z: 48, radius: 0,
          check: () => d.game.player.mode === 'car' && d.game.player.vehicle === car,
          start: () => {},
          failIf: () => car.wrecked, failText: 'The coupe is wrecked.',
        },
        {
          text: "Deliver the coupe to Lucia's Garage", x: -40, z: 34, radius: 7.5,
          start: () => d.game.police.reportCrime('theft'),
          check: () => d.game.player.mode === 'car' && d.game.player.vehicle === car &&
            dist2d(car.x, car.z, -40, 34) < 7.5,
          failIf: () => car.wrecked, failText: 'The coupe is wrecked.',
        },
      ];
    },
  },
  {
    title: 'Hot Delivery',
    reward: 450,
    intro: [
      ['LUCIA', 'A parcel at Port Azura warehouse. It beeps. Parcels should not beep.'],
      ['MARCO', 'And I am the man who carries the beeping parcel.'],
      ['LUCIA', 'To Casa Serra, fast. If the alarm trips — and it will — do not stop for anyone in blue.'],
    ],
    outro: [
      ['MARCO', 'Delivered. Whatever that was, it is your problem now.'],
      ['LUCIA', 'Four fifty, and my eternal gratitude. Spend the money first.'],
    ],
    buildSteps(d) {
      const port = d.game.city.poi.port;
      const safe = d.game.city.poi.safehouse;
      return [
        {
          text: 'Pick up the parcel at Port Azura', x: port.x + 12, z: port.z, radius: 6.5,
          check: (dd) => {
            const p = dd.game.player;
            const px = p.mode === 'car' ? p.vehicle.x : p.x;
            const pz = p.mode === 'car' ? p.vehicle.z : p.z;
            return dist2d(px, pz, port.x + 12, port.z) < 6.5;
          },
        },
        {
          text: 'Drop the parcel at Casa Serra — fast', x: safe.x + 12, z: safe.z, radius: 7,
          start: (dd) => { dd.game.police.setWanted(Math.max(dd.game.police.level, 1)); dd.game.hud.toast('The alarm trips — move!'); },
          check: (dd) => {
            const p = dd.game.player;
            const px = p.mode === 'car' ? p.vehicle.x : p.x;
            const pz = p.mode === 'car' ? p.vehicle.z : p.z;
            return dist2d(px, pz, safe.x + 12, safe.z) < 7;
          },
        },
      ];
    },
    timeLimit: 300,
  },
  {
    title: 'The Collector',
    reward: 600,
    intro: [
      ['LUCIA', 'A purple sedan owes me a briefcase and an apology. The driver will run.'],
      ['MARCO', 'So I introduce his car to a wall.'],
      ['LUCIA', 'Introduce them thoroughly. Then take the case from the wreck.'],
    ],
    outro: [
      ['LUCIA', 'The case, the apology — I will frame one of them. Six hundred.'],
    ],
    buildSteps(d) {
      const target = d.game.spawnSpecial('sedan', 0x8e44ad, 128, -87, Math.PI / 2, {});
      target.driver = 'mission';
      d.missionVehicles.push(target);
      d.targetCar = target;
      let fleeClock = 0;
      return [
        {
          text: 'Wreck the purple sedan — ram it until it stops', dynamicPos: () => ({ x: target.x, z: target.z }),
          update: (dd, dt) => {
            fleeClock -= dt;
            if (target.health > 35 && fleeClock <= 0) {
              fleeClock = 1.6;
              const p = dd.game.player;
              const px = p.mode === 'car' ? p.vehicle.x : p.x;
              const pz = p.mode === 'car' ? p.vehicle.z : p.z;
              let ax = target.x + (target.x - px);
              let az = target.z + (target.z - pz);
              // Snap the escape point to the nearest road crossing so he drives streets, not walls.
              const lines = [-200, -160, -120, -80, -40, 0, 40, 80, 120, 160, 200];
              const snap = (v) => lines.reduce((b, L) => (Math.abs(L - v) < Math.abs(b - v) ? L : b), lines[0]);
              if (Math.abs(target.x - px) > Math.abs(target.z - pz)) az = snap(target.z); else ax = snap(target.x);
              target.escortPoint = { x: ax, z: az };
            }
            if (target.health > 35 && target.escortPoint) {
              target.driveToward(dt, target.escortPoint.x, target.escortPoint.z, 13.5, dd.game.city.colliders);
            }
          },
          check: () => target.health <= 35,
        },
        {
          text: 'Take the briefcase from the wreck', dynamicPos: () => ({ x: target.x, z: target.z }),
          check: (dd) => dd.game.player.mode === 'foot' && dist2d(dd.game.player.x, dd.game.player.z, target.x, target.z) < 3.4,
        },
        {
          text: 'Lose the heat, then get to Café Sol', x: -82, z: 34,
          start: (dd) => dd.game.police.setWanted(Math.max(dd.game.police.level, 2)),
          check: (dd) => dd.game.police.level === 0 && dist2d(dd.game.player.x, dd.game.player.z, -82, 34) < 9,
        },
      ];
    },
  },
  {
    title: 'Harbor Run',
    reward: 800,
    timeLimit: 175,
    intro: [
      ['LUCIA', 'Six flags around the bay, one timer, and every officer I could wake up.'],
      ['MARCO', 'You booked me a parade.'],
      ['LUCIA', 'A race, wheels. Hit every flag before the clock eats your fee.'],
    ],
    outro: [
      ['LUCIA', 'The whole bay watched that. Eight hundred — you are becoming a landmark.'],
    ],
    buildSteps(d) {
      const flags = [[200, 160], [80, 207], [-47, 120], [-127, 200], [-200, 47], [-87, -40]];
      return flags.map(([x, z], i) => ({
        text: `Hit flag ${i + 1} of ${flags.length}`, x, z, radius: 9,
        start: i === 0 ? (dd) => dd.game.police.setWanted(Math.max(dd.game.police.level, 2)) : undefined,
        check: (dd) => {
          const p = dd.game.player;
          const px = p.mode === 'car' ? p.vehicle.x : p.x;
          const pz = p.mode === 'car' ? p.vehicle.z : p.z;
          return dist2d(px, pz, x, z) < 9;
        },
      }));
    },
  },
  {
    title: 'The Getaway',
    reward: 900,
    intro: [
      ['LUCIA', 'My cousin Benny is at the Hotel Verano with a suitcase and a tail he did not ask for.'],
      ['MARCO', 'And I am the part where the tail loses him.'],
      ['LUCIA', 'Pick him up, shake the blue off, drop him at the port. Gently, wheels — he bruises.'],
    ],
    outro: [
      ['BENNY', 'I am never flying into this city again. Tell Lucia the suitcase is heavier than her conscience.'],
      ['LUCIA', 'Nine hundred, and Benny owes you his life. He pays his debts slower than I do.'],
    ],
    buildSteps(d) {
      const hotel = d.game.city.poi.hotel;
      const port = d.game.city.poi.port;
      const px = hotel.x + 12;
      const pz = hotel.z;
      let benny = null;
      return [
        {
          text: 'Pick up Benny at the Hotel Verano', x: px, z: pz,
          start: (dd) => {
            benny = dd.game.spawnPedAt(px + 1.5, pz + 2.5);
            dd.trackExtra(benny);
          },
          check: (dd) => {
            const p = dd.game.player;
            return p.mode === 'car' && Math.abs(p.vehicle.speed) < 1.4 &&
              dist2d(p.vehicle.x, p.vehicle.z, px, pz) < 7;
          },
          finish: (dd) => {
            if (benny) { dd.untrackExtra(benny); benny = null; }
            dd.game.hud.toast("Benny's in — go, go, go!");
          },
        },
        {
          text: 'Drop Benny at Port Azura', x: port.x + 12, z: port.z,
          start: (dd) => dd.game.police.setWanted(2),
          check: (dd) => {
            const p = dd.game.player;
            return p.mode === 'car' && dist2d(p.vehicle.x, p.vehicle.z, port.x + 12, port.z) < 9;
          },
        },
      ];
    },
  },
  {
    title: 'The Last Job in Azura',
    reward: 1500,
    intro: [
      ['LUCIA', 'Banco Azura moves its vault cash in one armoured van. Tonight it takes the coast road.'],
      ['MARCO', 'You want me to rob the bank without entering the bank.'],
      ['LUCIA', 'Take the van to the port and this city is ours, Marco. Ours.'],
    ],
    outro: [
      ['LUCIA', 'It is done. Port Azura has a new king, and he owes me a drink.'],
      ['MARCO', 'Drinks are on me, Lucia. They are on me for a year.'],
    ],
    buildSteps(d) {
      const van = d.game.spawnSpecial('van', 0x707a8a, 47, 74, 0, {});
      van.health = 320;
      d.missionVehicles.push(van);
      const port = d.game.city.poi.port;
      return [
        {
          text: 'Steal the armoured van at Banco Azura', x: 47, z: 74,
          check: () => d.game.player.mode === 'car' && d.game.player.vehicle === van,
          failIf: () => van.health <= 0, failText: 'The van is destroyed — the cash burns with it.',
        },
        {
          text: 'Take the van to Port Azura', x: port.x + 12, z: port.z, radius: 9.5,
          start: (dd) => dd.game.police.setWanted(3),
          check: () => d.game.player.mode === 'car' && d.game.player.vehicle === van &&
            dist2d(van.x, van.z, port.x + 12, port.z) < 9.5,
          failIf: () => van.health <= 0, failText: 'The van is destroyed — the cash burns with it.',
        },
      ];
    },
  },
];
