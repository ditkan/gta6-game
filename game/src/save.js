import { SAVE_KEY } from './config.js';

// Progress lives in one localStorage record: cash, story position, courier
// count, hidden briefcases found and the mute flag.
export function defaultSave() {
  return {
    cash: 0,
    lifetime: 0,
    missionIndex: 0,
    couriersDone: 0,
    briefcases: [],
    storyDone: false,
    muted: false,
  };
}
export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    return Object.assign(defaultSave(), data);
  } catch {
    return null;
  }
}
export function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* private mode etc.: the game simply runs unsaved */
  }
}
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
