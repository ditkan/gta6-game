// The entry program for make.fun's gta6-01 bounty: copies game/ and
// screenshots/ into the output directory and writes the dossier the scorer
// expects, using the kit's own library (vendor/makefun-game.ts) so the
// bytes match what the gate recomputes.
//   node main.ts                      -> ./out
//   MAKEFUN_OUTPUT_DIR=dir node main.ts
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const root = dirname(fileURLToPath(import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR || join(root, 'out');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'game'), join(out, 'game'), { recursive: true });
cpSync(join(root, 'screenshots'), join(out, 'screenshots'), { recursive: true });

const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(out, 'dossier.json'), dossier);
console.log(`Port Azura: Heat handed in at ${out} (dossier ${dossier.length} bytes)`);
