// hud.js — everything drawn over the 3D view: health and car bars, cash,
// wanted stars, the objective card, toasts, dialogue, banners, the BUSTED
// meter, and the circular minimap with its blips.

import { WORLD } from './config.js';
import { clamp } from './rng.js';

export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), wanted: $('wanted'), stars: [...document.querySelectorAll('#wanted .star')],
      clock: $('clock'), objective: $('objective'), objectiveText: $('objective-text'),
      toast: $('toast'), dialogue: $('dialogue'), dialogueName: $('dialogue-name'), dialogueText: $('dialogue-text'),
      cash: $('cash'), healthFill: $('health-fill'), carFill: $('car-fill'), speedo: $('speedo'),
      minimap: $('minimap'), district: $('district'), busted: $('busted-meter'), bustedFill: $('busted-fill'),
      crosshair: $('crosshair'), prompt: $('prompt'), banner: $('mission-banner'),
      bannerTitle: $('mission-banner-title'), bannerSub: $('mission-banner-sub'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    this.toastTimer = null;
    this.bannerTimer = null;
    this.lastCash = null;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  setHealth(health01) { this.el.healthFill.style.width = `${clamp(health01, 0, 1) * 100}%`; }
  setCarHealth(car01) {
    this.el.carFill.style.width = `${clamp(car01 ?? 0, 0, 1) * 100}%`;
    this.el.carFill.parentElement.parentElement.style.opacity = car01 == null ? 0.25 : 1;
  }
  setSpeedo(kmh, driving) {
    this.el.speedo.classList.toggle('hidden', !driving);
    if (driving) this.el.speedo.textContent = `${Math.round(kmh)} km/h`;
  }
  setCash(cash) {
    if (cash === this.lastCash) return;
    this.lastCash = cash;
    this.el.cash.textContent = '$' + cash.toLocaleString('en-US');
  }
  setWanted(level, losingHeat) {
    this.el.stars.forEach((star, i) => star.classList.toggle('on', i < level));
    this.el.wanted.classList.toggle('flash', Boolean(losingHeat));
  }
  setClock(text) { this.el.clock.textContent = text; }
  setDistrict(name) { if (this.el.district.textContent !== name) this.el.district.textContent = name; }
  setCrosshair(on) { this.el.crosshair.classList.toggle('hidden', !on); }
  setPrompt(text) {
    this.el.prompt.classList.toggle('hidden', !text);
    if (text) this.el.prompt.textContent = text;
  }
  setObjective(text) {
    this.el.objective.classList.toggle('hidden', !text);
    if (text) this.el.objectiveText.textContent = text;
  }
  toast(text, ms = 2600) {
    this.el.toast.textContent = text;
    this.el.toast.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.el.toast.classList.add('hidden'), ms);
  }
  dialogue(name, text) {
    if (!text) {
      this.el.dialogue.classList.add('hidden');
      return;
    }
    this.el.dialogueName.textContent = name;
    this.el.dialogueText.textContent = text;
    this.el.dialogue.classList.remove('hidden');
  }
  banner(title, sub = '', ms = 2800) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub;
    this.el.banner.classList.remove('hidden');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.el.banner.classList.add('hidden'), ms);
  }
  setBusted(frac) {
    this.el.busted.classList.toggle('hidden', frac <= 0.01);
    this.el.bustedFill.style.width = `${frac * 100}%`;
  }

  // Minimap: north-up, ~300 m across, centred on the player. Roads, water,
  // then blips: mission gold, police flashing blue/red, cars grey, player
  // as a white arrow turned to the camera heading.
  drawMinimap(view) {
    const g = this.mapCtx;
    const S = 220;
    const scale = S / 300;
    const cx = S / 2;
    const cy = S / 2;
    const toMap = (x, z) => [cx + (x - view.x) * scale, cy + (z - view.z) * scale];
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#3d4a3a';
    g.fillRect(0, 0, S, S);
    // Sea to the east.
    const [seaX] = toMap(WORLD.waterX, 0);
    g.fillStyle = '#1d6f8e';
    g.fillRect(seaX, 0, S - seaX, S);
    const [sandX] = toMap(WORLD.beachX, 0);
    g.fillStyle = '#e6cf9e';
    g.fillRect(sandX, 0, Math.max(0, seaX - sandX), S);
    // Roads.
    g.strokeStyle = '#22242a';
    g.lineWidth = WORLD.roadHalfWidth * 2 * scale;
    g.beginPath();
    for (const L of WORLD.roadLines) {
      const [rx] = toMap(L, 0);
      g.moveTo(rx, 0); g.lineTo(rx, S);
      const [, rz] = toMap(0, L);
      g.moveTo(0, rz); g.lineTo(S, rz);
    }
    g.stroke();
    // Traffic and parked cars.
    g.fillStyle = 'rgba(230,230,230,0.55)';
    for (const v of view.cars) {
      const [x, y] = toMap(v.x, v.z);
      if (x < -4 || y < -4 || x > S + 4 || y > S + 4) continue;
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    // Police.
    const flash = Math.floor(performance.now() / 280) % 2 === 0;
    for (const c of view.police) {
      const [x, y] = toMap(c.x, c.z);
      g.fillStyle = flash ? '#ff3b30' : '#3b82f6';
      g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    }
    // Objective marker.
    if (view.objective) {
      const [x, y] = toMap(view.objective.x, view.objective.z);
      g.fillStyle = '#ffd23e';
      g.strokeStyle = '#7a5200';
      g.beginPath(); g.arc(clamp(x, 8, S - 8), clamp(y, 8, S - 8), 6, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // Player arrow.
    g.save();
    g.translate(cx, cy);
    g.rotate(view.heading);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#111';
    g.beginPath();
    g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }
}
