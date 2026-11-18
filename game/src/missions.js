import { POIS } from './config.js';
import { dist2d } from './rng.js';
import { makePerson, animatePerson } from './people.js';

// The Director runs the story: Lucia's six jobs, Paco's repeatable courier
// runs, dialogue, step objectives, timers, markers, payouts and failures.
// States: 'idle' (free roam / next job waiting), 'intro' (dialogue running),
// 'active' (a job's steps are being checked).
export class Director {
  constructor(game) {
    this.game = game;
    this.state = 'idle';
    this.missionIndex = 0;
    this.stepIndex = 0;
    this.dialogueActive = false;
    this.dialogue = [];
    this.dialoguePos = 0;
    this.dialogueDone = null;
    this.extras = [];
    this.marker = null;
    this.steps = [];
    this.missionTitle = '';
    this.payout = 0;
    this.timeLeft = null;
    this.targetCar = null;
    this.isCourier = false;
    this.beepTimer = 0;
    this.collectorRoute = null;
  }
  get poi() { return this.game.city.poi; }

  // ---- interaction & dialogue ---------------------------------------------
  tryInteract() {
    const g = this.game;
    if (this.state !== 'idle' || this.dialogueActive) return false;
    const p = g.player;
    const lucia = g.npcs.lucia;
    if (dist2d(p.x, p.z, lucia.x, lucia.z) < 13) {
      if (this.missionIndex >= 6) this.startCourier('lucia');
      else this.startStory(this.missionIndex);
      return true;
    }
    const paco = g.npcs.paco;
    if (dist2d(p.x, p.z, paco.x, paco.z) < 7) {
      this.startCourier('paco');
      return true;
    }
    return false;
  }
  startDialogue(lines, done) {
    this.state = 'intro';
    this.dialogue = lines;
    this.dialoguePos = 0;
    this.dialogueActive = true;
    this.dialogueDone = done;
    const [name, text] = lines[0];
    this.game.hud.dialogue(name, text);
    this.game.audio.blip(520, 0.08, 'triangle', 0.08);
  }
  advanceDialogue() {
    if (!this.dialogueActive) return;
    this.dialoguePos++;
    if (this.dialoguePos >= this.dialogue.length) {
      this.dialogueActive = false;
      this.game.hud.dialogue(null);
      const done = this.dialogueDone;
      this.dialogueDone = null;
      if (done) done();
    } else {
      const [name, text] = this.dialogue[this.dialoguePos];
      this.game.hud.dialogue(name, text);
      this.game.audio.blip(520, 0.08, 'triangle', 0.08);
    }
  }

  // ---- mission lifecycle ------------------------------------------------------
  beginMission(def, isCourier) {
    this.missionTitle = def.title;
    this.payout = def.payout;
    this.steps = def.steps;
    this.isCourier = isCourier;
    this.stepIndex = 0;
    this.state = 'active';
    if (def.onStart) def.onStart();
    this.enterStep();
    this.game.hud.banner(def.title.toUpperCase(), 2.2);
  }
  enterStep() {
    const step = this.steps[this.stepIndex];
    if (!step) return;
    // A step may carry its own countdown (Hot Parcel's delivery); Bay Run
    // sets one on its first checkpoint that keeps running for the rest.
    if (step.time !== undefined) this.timeLeft = step.time;
    else if (this.stepIndex === 0) this.timeLeft = null;
    if (step.onStart) step.onStart();
    this.refreshObjective();
  }
  refreshObjective() {
    const step = this.steps[this.stepIndex];
    if (!step) return;
    let sub = '';
    if (this.timeLeft !== null) sub = `⏱ ${Math.ceil(this.timeLeft)}s`;
    else if (step.sub) sub = step.sub;
    this.game.hud.setObjective(step.text, sub);
    const m = typeof step.marker === 'function' ? step.marker() : step.marker;
    this.marker = m || null;
  }
  completeMission() {
    const g = this.game;
    g.player.cash += this.payout;
    g.saveData.cash = g.player.cash;
    g.saveData.lifetime += this.payout;
    g.audio.cash();
    g.hud.banner(`JOB DONE<small>+ $${this.payout.toLocaleString('en-US')} — ${this.missionTitle}</small>`, 3.2);
    this.cleanup();
    if (this.isCourier) {
      g.saveData.couriersDone++;
    } else {
      this.missionIndex++;
      g.saveData.missionIndex = this.missionIndex;
      if (this.missionIndex >= 6) {
        g.saveData.storyDone = true;
        g.onStoryComplete();
      }
    }
    this.state = 'idle';
    this.isCourier = false;
    g.requestSave();
    this.idleObjective();
  }
  failMission(reason) {
    const g = this.game;
    g.hud.toast(reason, 3.4);
    g.audio.denied();
    this.cleanup();
    this.state = 'idle';
    this.isCourier = false;
    this.idleObjective();
  }
  onPlayerDown() {
    if (this.state === 'active' || this.state === 'intro') {
      this.game.hud.dialogue(null);
      this.dialogueActive = false;
      this.cleanup();
      this.state = 'idle';
      this.isCourier = false;
    }
  }
  cleanup() {
    for (const e of this.extras) this.game.scene.remove(e.mesh);
    this.extras = [];
    this.marker = null;
    this.timeLeft = null;
    this.targetCar = null;
    this.collectorRoute = null;
  }
  idleObjective() {
    if (this.missionIndex >= 6) this.game.hud.setObjective('Free roam — see Lucia or Paco for courier work', `${this.game.saveData.couriersDone} courier runs done`);
    else this.game.hud.setObjective('Meet Lucia at Café Sol', 'She always has work for a wheelman');
  }

  // ---- per-frame ----------------------------------------------------------------
  update(dt) {
    const g = this.game;
    // Extras idle/flee animation.
    for (const e of [...this.extras]) {
      if (e.dead) continue;
      if (e.flee) {
        e.flee -= dt;
        e.x += Math.sin(e.angle) * 4.2 * dt;
        e.z += Math.cos(e.angle) * 4.2 * dt;
        e.phase += dt * 11;
        if (e.flee <= 0) {
          g.scene.remove(e.mesh);
          this.extras.splice(this.extras.indexOf(e), 1);
          continue;
        }
      } else {
        e.phase += dt * 1.6;
      }
      e.mesh.position.set(e.x, 0, e.z);
      e.mesh.rotation.y = e.angle;
      animatePerson(e.mesh, e.phase, e.flee ? 1.2 : 0.12);
    }
    // The collector's sedan drives its loop until wrecked.
    if (this.collectorRoute && this.targetCar && !this.targetCar.dead && this.targetCar.driver === 'mission') {
      const car = this.targetCar;
      const route = this.collectorRoute;
      const wp = route[car.wpIndex || 0];
      const d = dist2d(car.x, car.z, wp.x, wp.z);
      if (d < 8) car.wpIndex = ((car.wpIndex || 0) + 1) % route.length;
      const want = Math.atan2(wp.x - car.x, wp.z - car.z);
      let delta = (want - car.angle) % (Math.PI * 2);
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      car.step(dt, { throttle: car.speed < 10.5 ? 0.8 : 0, steer: Math.max(-1, Math.min(1, delta * 1.7)) }, g.city.colliders);
    }
    if (this.state !== 'active') return;
    const step = this.steps[this.stepIndex];
    if (!step) return;
    if (typeof step.marker === 'function') this.marker = step.marker();
    if (this.timeLeft !== null) {
      this.timeLeft -= dt;
      this.beepTimer -= dt;
      if (this.beepTimer <= 0 && this.missionTitle === 'Hot Parcel') { g.audio.beep(); this.beepTimer = 1.1; }
      if (this.timeLeft <= 0) { this.failMission('Out of time — the job is blown. Lucia will offer it again.'); return; }
      if (Math.floor(this.timeLeft * 2) !== Math.floor((this.timeLeft + dt) * 2)) this.refreshObjective();
    }
    if (step.check && step.check(dt)) {
      if (step.onDone) step.onDone();
      this.stepIndex++;
      if (this.stepIndex >= this.steps.length) this.completeMission();
      else this.enterStep();
    }
  }

  // ---- the six story jobs -----------------------------------------------------
  startStory(index) {
    const g = this.game;
    const poi = this.poi;
    const builders = [
      () => ({ // 1 — The Gold Coupe
        title: 'The Gold Coupe', payout: 750,
        intro: [
          ['Lucia', 'Marco Serra. Back in Port Azura and already smelling of trouble.'],
          ['Lucia', 'A collector keeps a gold coupe at the marina and owes me money. Take the car. Bring it to my garage.'],
          ['Marco', 'Steal it, drive it, no scratches I did not make. On it.'],
        ],
        onStart: () => {
          this.targetCar = g.spawnSpecial('coupe', -188, 178, -Math.PI / 2, 0xf7b500);
        },
        steps: [
          { text: 'Steal the gold coupe at the marina', marker: () => this.targetCar ? { x: this.targetCar.x, z: this.targetCar.z } : poi.marina,
            check: () => g.player.vehicle === this.targetCar,
            onDone: () => { g.police.setWanted(1); g.hud.toast('Marina cameras caught that — one star', 2.6); } },
          { text: "Deliver the coupe to Lucia's Garage", marker: poi.garage,
            check: () => g.player.vehicle === this.targetCar && dist2d(g.player.x, g.player.z, poi.garage.x, poi.garage.z) < 10 },
        ],
      }),
      () => ({ // 2 — Hot Parcel
        title: 'Hot Parcel', payout: 900,
        intro: [
          ['Lucia', 'A parcel is sitting on the Old Port dock and it beeps. Do not shake it.'],
          ['Lucia', 'Take it to the dead drop in Palm Heights. The clock starts when you touch it.'],
          ['Marco', 'A beeping parcel. Wonderful.'],
        ],
        steps: [
          { text: 'Pick up the parcel at the Old Port dock', marker: poi.dock,
            check: () => dist2d(g.player.x, g.player.z, poi.dock.x, poi.dock.z) < 8,
            onDone: () => { g.police.setWanted(1); g.hud.toast('The dock guard called it in — move!', 2.6); } },
          { text: 'Deliver the parcel to Palm Heights', sub: 'The drop is the north-west corner kerb', marker: { x: -180, z: -135 }, time: 150,
            check: () => dist2d(g.player.x, g.player.z, -180, -135) < 9 },
        ],
      }),
      () => ({ // 3 — The Collector
        title: 'The Collector', payout: 1200,
        intro: [
          ['Lucia', 'The coupe man sent his own collector after me. Black sedan, downtown loop, full of himself.'],
          ['Lucia', 'Wreck his car, take his briefcase, bring it here. He can walk home and think.'],
          ['Marco', 'Diplomacy, Azura style.'],
        ],
        onStart: () => {
          this.targetCar = g.spawnSpecial('sedan', 90, 45, Math.PI / 2, 0x14151a);
          this.targetCar.driver = 'mission';
          this.collectorRoute = [
            { x: 90, z: 45 }, { x: 90, z: -45 }, { x: 0, z: -45 }, { x: 0, z: 45 },
          ];
          this.targetCar.wpIndex = 1;
        },
        steps: [
          { text: "Wreck the collector's sedan", sub: 'Ram it or shoot it until he runs', marker: () => ({ x: this.targetCar.x, z: this.targetCar.z }),
            check: () => this.targetCar.dead || this.targetCar.hp <= this.targetCar.maxHp * 0.3,
            onDone: () => {
              this.targetCar.driver = null;
              this.targetCar.speed = 0;
              const driver = this.addExtra(this.targetCar.x + 2, this.targetCar.z, { shirt: 0x14151a });
              driver.flee = 9;
              driver.angle = Math.atan2(driver.x - g.player.x, driver.z - g.player.z);
              g.police.setWanted(Math.max(1, g.police.level));
              g.hud.toast('He dropped the briefcase — grab it', 2.6);
            } },
          { text: 'Grab the briefcase from the wreck', marker: () => ({ x: this.targetCar.x, z: this.targetCar.z }),
            check: () => g.player.mode === 'foot' && dist2d(g.player.x, g.player.z, this.targetCar.x, this.targetCar.z) < 3.4 },
          { text: 'Bring the briefcase to Lucia at Café Sol', marker: poi.cafe,
            check: () => dist2d(g.player.x, g.player.z, poi.cafe.x, poi.cafe.z) < 10 },
        ],
      }),
      () => { // 4 — Bay Run
        const cps = [
          { x: -180, z: 135 }, { x: -90, z: 180 }, { x: 0, z: 135 },
          { x: 90, z: 180 }, { x: 180, z: 135 }, { x: 180, z: 45 },
        ];
        return {
          title: 'Bay Run', payout: 1500,
          intro: [
            ['Lucia', 'My cousin races the bay road at dusk and the whole PD watches. Six flags, Marco.'],
            ['Lucia', 'Hit every flag with two stars on you and the run is yours. Try not to swim.'],
            ['Marco', 'Six flags. Two stars. One sunset.'],
          ],
          onStart: () => { g.police.setWanted(2, 120); },
          steps: cps.map((cp, i) => ({
            text: `Hit the bay checkpoints (${i + 1} of 6)`,
            sub: 'Stay in a car and keep the heat off your paint',
            marker: cp, time: i === 0 ? 170 : undefined,
            check: () => g.player.mode === 'car' && dist2d(g.player.x, g.player.z, cp.x, cp.z) < 10,
          })),
        };
      },
      () => ({ // 5 — The Getaway
        title: 'The Getaway', payout: 2000,
        intro: [
          ['Lucia', 'My cousin Benny lifted a watch off the wrong wrist at Hotel Verano. He is hiding in the lobby.'],
          ['Lucia', 'Pick him up in a car, take him to Casa Serra, and do not stop for the Azura PD.'],
          ['Marco', 'Babysitting, but at speed.'],
        ],
        onStart: () => {
          const benny = this.addExtra(poi.hotel.x + 4, poi.hotel.z + 4, { shirt: 0xef476f });
          benny.name = 'Benny';
        },
        steps: [
          { text: 'Pick up Benny at Hotel Verano', sub: 'Be in a car at the hotel front', marker: poi.hotel,
            check: () => g.player.mode === 'car' && dist2d(g.player.x, g.player.z, poi.hotel.x, poi.hotel.z) < 20,
            onDone: () => {
              this.clearExtras();
              g.police.setWanted(2, 90);
              g.hud.toast('Benny: "DRIVE, MARCO, DRIVE!"', 2.8);
            } },
          { text: 'Get Benny to Casa Serra', marker: poi.home,
            check: () => g.player.mode === 'car' && dist2d(g.player.x, g.player.z, poi.home.x, poi.home.z) < 11 },
        ],
      }),
      () => ({ // 6 — The Big Score
        title: 'The Big Score', payout: 5000,
        intro: [
          ['Lucia', 'Last one, Marco. Banco Azura moves its cash in an armoured van, parked by the bank right now.'],
          ['Lucia', 'Take the van to the Old Port dock. Every cop in Azura will come. Earn it.'],
          ['Marco', 'One van, one dock, one legend.'],
        ],
        onStart: () => {
          this.targetCar = g.spawnSpecial('armoured', 54, 5, Math.PI / 2, 0x3f6212);
        },
        steps: [
          { text: "Steal Banco Azura's armoured van", marker: () => ({ x: this.targetCar.x, z: this.targetCar.z }),
            check: () => g.player.vehicle === this.targetCar,
            onDone: () => { g.police.setWanted(4, 120); g.hud.toast('Four stars — the whole PD is coming', 3); } },
          { text: 'Deliver the van to the Old Port dock', marker: poi.dock,
            check: () => g.player.vehicle === this.targetCar && dist2d(g.player.x, g.player.z, poi.dock.x, poi.dock.z) < 11 },
        ],
      }),
    ];
    const def = builders[index]();
    this.startDialogue(def.intro, () => this.beginMission(def, false));
  }

  // ---- repeatable courier work ---------------------------------------------------
  startCourier(from) {
    const g = this.game;
    const poi = this.poi;
    const spots = [
      { key: 'marina', label: 'the marina' }, { key: 'dock', label: 'the Old Port dock' },
      { key: 'hotel', label: 'Hotel Verano' }, { key: 'hospital', label: 'the hospital' },
      { key: 'bank', label: 'Banco Azura' }, { key: 'home', label: 'Casa Serra' },
      { key: 'garage', label: "Lucia's Garage" },
    ];
    const done = g.saveData.couriersDone;
    const a = spots[Math.floor(Math.random() * spots.length)];
    let b = spots[Math.floor(Math.random() * spots.length)];
    if (b.key === a.key) b = spots[(spots.indexOf(a) + 3) % spots.length];
    const pa = poi[a.key], pb = poi[b.key];
    const payout = 220 + done * 45 + Math.round(dist2d(pa.x, pa.z, pb.x, pb.z) / 20);
    const speaker = from === 'lucia' ? 'Lucia' : 'Paco';
    const def = {
      title: 'Courier Run', payout,
      intro: [
        [speaker, `Package at ${a.label}. It goes to ${b.label}. $${payout}, no questions.`],
        ['Marco', 'Consider it moved.'],
      ],
      steps: [
        { text: `Pick up the package at ${a.label}`, marker: pa,
          check: () => dist2d(g.player.x, g.player.z, pa.x, pa.z) < 8,
          onDone: () => { if (done >= 2) { g.police.setWanted(1); g.hud.toast('Somebody is watching these drops — one star', 2.6); } } },
        { text: `Deliver the package to ${b.label}`, marker: pb,
          check: () => dist2d(g.player.x, g.player.z, pb.x, pb.z) < 9 },
      ],
    };
    this.startDialogue(def.intro, () => this.beginMission(def, true));
  }

  addExtra(x, z, opts = {}) {
    const mesh = makePerson(this.game.rng, opts);
    this.game.scene.add(mesh);
    mesh.position.set(x, 0, z);
    const extra = { x, z, mesh, hp: 40, dead: false, flee: 0, angle: 0, phase: Math.random() * 6, name: opts.name || '' };
    this.extras.push(extra);
    return extra;
  }
  clearExtras() {
    for (const e of this.extras) this.game.scene.remove(e.mesh);
    this.extras = [];
  }
}
