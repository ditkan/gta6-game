// Staged scenes for the entry screenshots (?shot=cover|chase|mission|city).
// Each arranges the live game — real player, cars, police and HUD — then
// flags __SHOT_READY so the capture script can take the picture.
export function stageShot(game, name) {
  const g = game;
  const poi = g.city.poi;
  if (name === 'cover') {
    const coupe = g.spawnSpecial('coupe', -154, 185, 0.5, 0xf7b500);
    // Clear the stage: no parked traffic photobombing the coupe.
    for (const c of g.traffic.cars) {
      if (c !== coupe && Math.hypot(c.x - coupe.x, c.z - coupe.z) < 16) { c.x += 42; c.syncMesh(); }
    }
    g.player.placeAt(-160, 178, 0.35);
    g.camYaw = 0.35; g.camPitch = 0.16;
    g.hud.setObjective('Steal the gold coupe at the marina', 'Lucia wants it at her garage');
    g.director.marker = { x: -154, z: 185 };
  } else if (name === 'chase') {
    const car = g.spawnSpecial('coupe', 45, 40, Math.PI, 0xc23b2e);
    g.player.placeAt(45, 40, Math.PI);
    g.player.enterCar(car);
    car.speed = 13;
    g.police.setWanted(4);
    const spots = [[41.5, 58], [48.5, 66], [45, 78]];
    for (const [x, z] of spots) {
      const c = g.police.spawnCruiser(g.player);
      c.x = x; c.z = z; c.angle = Math.PI; c.speed = 12;
      c.syncMesh();
    }
    g.camYaw = Math.PI; g.camPitch = 0.18;
    g.hud.setObjective('Outrun the Azura PD', 'Break their line of sight to cool the heat');
  } else if (name === 'mission') {
    g.player.placeAt(13.5, 50.5, -2.5);
    g.camYaw = -2.5; g.camPitch = 0.13;
    g.director.state = 'intro';
    g.director.dialogueActive = true;
    g.hud.dialogue('Lucia', 'Marco Serra. Back in Port Azura and already smelling of trouble.');
    g.hud.setObjective('Talk to Lucia', 'She always has work for a wheelman');
  } else { // city
    g.player.placeAt(0, -20, 0.4);
    g.camOverride = { x: 86, y: 92, z: 128, lx: -10, ly: 0, lz: -30 };
    g.hud.setObjective('Free roam Port Azura', 'Six districts, one bay, endless trouble');
  }
}
