import { AVENUES, STREETS, BEACH_Z, SEA_Z, POIS } from './config.js';
import { clamp } from './rng.js';

const $ = (id) => document.getElementById(id);

// All DOM overlay work: objective, stars, bars, dialogue, banners, and the
// circular minimap (drawn on a 2D canvas, player-centred, north up).
export class Hud {
  constructor() {
    this.root = $('hud');
    this.objectiveText = $('objective-text');
    this.objectiveSub = $('objective-sub');
    this.starsEl = $('stars');
    this.clockEl = $('clock');
    this.cashEl = $('cash');
    this.weaponEl = $('weapon');
    this.hpFill = $('hp-fill');
    this.carFill = $('car-fill');
    this.carRow = $('car-row');
    this.speedEl = $('speed');
    this.districtEl = $('district');
    this.bannerEl = $('banner');
    this.toastEl = $('toast');
    this.dialogueEl = $('dialogue');
    this.dialogueName = $('dialogue-name');
    this.dialogueText = $('dialogue-text');
    this.vignette = $('vignette');
    this.map = $('minimap').getContext('2d');
    this.bannerTimer = 0;
    this.toastTimer = 0;
    this.lastStars = -1;
    this.lastCash = -1;
  }
  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }
  setObjective(text, sub = '') {
    if (this.objectiveText.textContent !== text) this.objectiveText.textContent = text;
    if (this.objectiveSub.textContent !== sub) this.objectiveSub.textContent = sub;
  }
  banner(html, seconds = 2.6) {
    this.bannerEl.innerHTML = html;
    this.bannerEl.classList.remove('hidden');
    this.bannerTimer = seconds;
  }
  toast(text, seconds = 2.4) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.toastTimer = seconds;
  }
  dialogue(name, text) {
    if (name === null) { this.dialogueEl.classList.add('hidden'); return; }
    this.dialogueEl.classList.remove('hidden');
    this.dialogueName.textContent = name;
    this.dialogueText.textContent = text;
  }
  update(dt, game) {
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.bannerEl.classList.add('hidden'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.toastEl.classList.add('hidden'); }
    const p = game.player;
    const level = game.police.level;
    if (level !== this.lastStars) {
      this.lastStars = level;
      this.starsEl.innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="${i < level ? 'on' : ''}">★</span>`).join('');
    }
    const mins = Math.floor(game.clockMinutes);
    const hh = String(Math.floor(mins / 60) % 24).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    this.clockEl.textContent = `${hh}:${mm}`;
    if (p.cash !== this.lastCash) {
      this.lastCash = p.cash;
      this.cashEl.textContent = '$' + p.cash.toLocaleString('en-US');
    }
    this.weaponEl.textContent = p.mode === 'car' ? 'PISTOL · DRIVE-BY' : 'PISTOL · ∞';
    this.hpFill.style.width = `${clamp(p.health, 0, 100)}%`;
    if (p.mode === 'car' && p.vehicle) {
      this.carRow.style.display = 'flex';
      this.carFill.style.width = `${clamp((p.vehicle.hp / p.vehicle.maxHp) * 100, 0, 100)}%`;
      this.speedEl.textContent = `${Math.round(Math.abs(p.vehicle.speed) * 3.6)} km/h`;
    } else {
      this.carRow.style.display = 'none';
      this.speedEl.textContent = '';
    }
    const district = game.city.districtAt(p.x, p.z);
    if (this.districtEl.textContent !== district) this.districtEl.textContent = district;
    const danger = Math.max(game.police.bustMeter / 2.6, p.health < 30 ? 0.7 : 0);
    this.vignette.style.boxShadow = `inset 0 0 120px rgba(200,0,0,${(danger * 0.55).toFixed(2)})`;
    this.drawMinimap(game);
  }
  drawMinimap(game) {
    const ctx = this.map;
    const S = 220, C = S / 2, scale = 0.6;
    const p = game.player;
    const px = p.x, pz = p.z;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(C, C, C - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#262a31';
    ctx.fillRect(0, 0, S, S);
    const toX = (wx) => C + (wx - px) * scale;
    const toY = (wz) => C + (wz - pz) * scale;
    // Water and sand to the south.
    ctx.fillStyle = '#d9be8a';
    ctx.fillRect(0, toY(BEACH_Z), S, Math.max(0, toY(SEA_Z) - toY(BEACH_Z)));
    ctx.fillStyle = '#1d7f8c';
    ctx.fillRect(0, toY(SEA_Z), S, S - toY(SEA_Z));
    // Roads.
    ctx.strokeStyle = '#101216';
    ctx.lineWidth = 14 * scale;
    ctx.beginPath();
    for (const x of AVENUES) { ctx.moveTo(toX(x), 0); ctx.lineTo(toX(x), S); }
    for (const z of STREETS) { ctx.moveTo(0, toY(z)); ctx.lineTo(S, toY(z)); }
    ctx.stroke();
    ctx.strokeStyle = '#3c4048';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const x of AVENUES) { ctx.moveTo(toX(x), 0); ctx.lineTo(toX(x), S); }
    for (const z of STREETS) { ctx.moveTo(0, toY(z)); ctx.lineTo(S, toY(z)); }
    ctx.stroke();
    // POIs.
    ctx.fillStyle = '#ffb340';
    for (const key of Object.keys(POIS)) {
      const poi = POIS[key];
      ctx.beginPath(); ctx.arc(toX(poi.x), toY(poi.z), 2.4, 0, Math.PI * 2); ctx.fill();
    }
    // Hidden briefcases still out there.
    ctx.fillStyle = '#f5f5f5';
    for (const b of game.briefcases) {
      if (b.taken) continue;
      ctx.fillRect(toX(b.x) - 1.6, toY(b.z) - 1.6, 3.2, 3.2);
    }
    // Traffic.
    ctx.fillStyle = 'rgba(200,205,215,0.75)';
    for (const car of game.traffic.cars) {
      if (Math.abs(car.x - px) > 190 || Math.abs(car.z - pz) > 190) continue;
      ctx.fillRect(toX(car.x) - 1.6, toY(car.z) - 1.6, 3.2, 3.2);
    }
    // Police: flashing blue/red.
    const flash = Math.floor(performance.now() / 220) % 2 === 0;
    for (const c of game.police.cruisers) {
      ctx.fillStyle = flash ? '#3a7bff' : '#ff3a3a';
      ctx.beginPath(); ctx.arc(toX(c.x), toY(c.z), 3.4, 0, Math.PI * 2); ctx.fill();
    }
    // Objective marker: a pulsing gold ring.
    const marker = game.director.marker;
    if (marker) {
      const pulse = 5 + Math.sin(performance.now() / 240) * 1.6;
      ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(toX(marker.x), toY(marker.z), pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath(); ctx.arc(toX(marker.x), toY(marker.z), 2.2, 0, Math.PI * 2); ctx.fill();
    }
    // Player arrow.
    ctx.translate(C, C);
    ctx.rotate(Math.atan2(p.fx, -p.fz));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(5.4, 6); ctx.lineTo(0, 3); ctx.lineTo(-5.4, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
