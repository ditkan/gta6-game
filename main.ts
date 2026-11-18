// Port Azura: Heat — entry program for make.fun's "Make GTA 6" bounty (gta6-01).
//
// The game itself is the static site in game/ (open game/index.html in a desktop
// browser, no build step, no network). This program is the hand-in: it copies
// game/ and screenshots/ into the output directory and writes dossier.json with
// the kit's vendored library, exactly as the gate expects. Run it with:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// With no MAKEFUN_OUTPUT_DIR it writes to /output, the grader's mount point.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(root, 'game'), join(outDir, 'game'), { recursive: true });

mkdirSync(join(outDir, 'screenshots'), { recursive: true });
const shotsDir = join(root, 'screenshots');
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });
}

// The caps below are the gate's own (see the competition rules): the dossier
// text the judge reads is capped, screenshots are at most 4 files of 256 KiB,
// and game/ holds at most 993 entries and 48 MiB with no path over 1000 bytes.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
