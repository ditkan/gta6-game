# gta6-game

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/ditkan/gta6-game/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/ditkan/gta6-game/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Port Azura: Heat** — a complete open-world crime game in the spirit of GTA 6,
played offline in a desktop browser from the static files in `game/`
(three.js vendored, no build step, no network request).

You are Marco Serra, a wheelman back in the sun-soaked city of Port Azura.
Lucia at Café Sol feeds you work: a six-job story chain — steal a gold coupe
from the marina, run a beeping parcel across town, wreck a collector's sedan
for its briefcase, race six flags around the bay under a two-star heat, drive
getaway for Lucia's cousin Benny, and take Banco Azura's armoured van to the
port for the score that ends the story. Payouts feed a lifetime score shown
in the pause menu and on the story-complete card. Between jobs: repeatable
courier runs that pay more — and run hotter — the more of them you finish,
ten hidden briefcases, and free roam.

The full loop is in: a city on foot and by car across six named districts
(Downtown Azura, Marina District, Old Port, Palm Heights, Verano Flats, Azura
Beach), moving traffic and pedestrians, cars to steal (sedans, coupes, vans,
pickups, taxis, police cruisers), a five-star wanted system with pursuing
Azura PD cruisers that ram, pin, shoot and bust you, pistol and melee combat,
a HUD with a live circular minimap, named places (Lucia's Garage, Azura PD,
the hospital, Banco Azura, Hotel Verano, Café Sol, Casa Serra), a start
screen, pause, BUSTED / WASTED / story-complete states, a localStorage save,
and a fully synthesised WebAudio soundscape — engine, sirens, gunfire and a
sunset pad. Everything is original: city, people, names, story, art and sound.

Controls: WASD drive/move, mouse camera, Shift sprint, Space jump/handbrake,
F enter/exit car, E talk/take a job, left mouse shoot, Q punch, Esc pause,
M mute, Enter advances dialogue.

## Run it

```sh
node serve.ts            # then open http://localhost:8123
node main.ts             # hands the entry in: writes out/ (game/, screenshots/, dossier.json)
MAKEFUN_OUTPUT_DIR=out node main.ts
```

Screenshots in `shots.json` are real captures of the staged scenes in
`game/src/shots.js` (`?shot=cover|chase|mission|city&seed=7`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=y4s98gyk&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
