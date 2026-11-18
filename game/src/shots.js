// shots.js — screenshot staging for the entry's screenshots/ folder. Opening
// the game with ?shot=<name>&seed=<n> skips the menu, freezes the mission
// director, and poses a real in-game scene (cover, chase, mission, city)
// that a headless browser captures. Staged vehicles are frozen so the
// composition holds while the rest of the city lives around them. The game
// itself is untouched by this: no query string, no staging.

export function applyShot(game, name) {
  const { player, police, hud } = game;
  game.freezeDirector = true;
  hud.show();

  if (name === 'cover') {
    // Marco and the gold coupe at the marina, palms and the sea behind.
    const coupe = game.spawnSpecial('coupe', 0xe8b13a, 206, 53, -2.2, {});
    coupe.frozen = true;
    player.placeAt(202.6, 50.6, 2.65);
    hud.setObjective('Steal the gold coupe at the marina');
    game.state.cash = 250;
    game.cameraOverride = { pos: [196.5, 1.8, 43.8], look: [205.5, 1.4, 52.5] };
  } else if (name === 'chase') {
    // Three stars on a downtown street: Marco's coupe ahead, cruisers close.
    const coupe = game.spawnSpecial('coupe', 0xc23b2e, 64, 3.2, Math.PI / 2, {});
    coupe.speed = 17;
    coupe.frozen = true;
    player.enterCar(coupe);
    police.setWanted(3);
    police.holdSpawns = true;
    const c1 = police.spawnCruiser(0, 0);
    c1.x = 49; c1.z = 4.8; c1.angle = Math.PI / 2; c1.speed = 17.5; c1.frozen = true; c1.syncMesh();
    const c2 = police.spawnCruiser(0, 0);
    c2.x = 42.5; c2.z = -1.9; c2.angle = Math.PI / 2; c2.speed = 18; c2.frozen = true; c2.syncMesh();
    hud.setObjective('Lose the heat!');
    game.state.cash = 1450;
    game.cameraOverride = { pos: [47.5, 4.4, -9.5], look: [68, 1.2, 3.5] };
  } else if (name === 'mission') {
    // The armoured-van job on the coast road, beacon up at the port.
    const van = game.spawnSpecial('van', 0x707a8a, 203, -98, Math.PI, {});
    van.speed = 12;
    van.frozen = true;
    player.enterCar(van);
    police.setWanted(2);
    police.holdSpawns = true;
    const c1 = police.spawnCruiser(0, 0);
    c1.x = 203; c1.z = -80; c1.angle = Math.PI; c1.speed = 13; c1.frozen = true; c1.syncMesh();
    game.director.marker.visible = true;
    game.director.marker.position.set(206, 17, -154);
    hud.setObjective('Take the van to Port Azura');
    game.state.cash = 2900;
    game.shotObjective = { x: 206, z: -154 };
    game.cameraOverride = { pos: [194.5, 4.6, -117], look: [204, 1.3, -95] };
  } else {
    // 'city': the downtown crossing at golden hour, traffic flowing.
    player.placeAt(-8, 14, -0.7);
    hud.setObjective('Meet Lucia at Café Sol');
    game.state.cash = 250;
    game.cameraOverride = { pos: [-26, 9.5, 30], look: [30, 6, -30] };
  }
}
