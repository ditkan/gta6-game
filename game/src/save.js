// save.js — the save game lives in localStorage: story progress, cash,
// collectibles, position and the car the player was driving.

import { SAVE_KEY } from './config.js';

export const SaveSystem = {
  has() {
    try {
      return Boolean(window.localStorage.getItem(SAVE_KEY));
    } catch {
      return false;
    }
  },

  store(data) {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  },

  load() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  clear() {
    try {
      window.localStorage.removeItem(SAVE_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};
