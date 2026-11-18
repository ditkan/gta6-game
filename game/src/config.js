// config.js — every shared constant for Port Azura: world size, road grid,
// physics tuning, wanted tuning and the sunset palette. One place to tune.

export const WORLD = {
  halfSize: 264,          // ground plane extends this far from the centre
  roadLines: [-200, -160, -120, -80, -40, 0, 40, 80, 120, 160, 200], // road centre lines on both axes
  roadHalfWidth: 7,       // asphalt half width; sidewalks beyond it
  blockSize: 40,
  seaLevel: 0,
  beachX: 226,            // sand starts here, water beyond x = 244
  waterX: 244,
};

export const PLAYER = {
  walkSpeed: 6.2,
  sprintSpeed: 10.5,
  radius: 0.55,
  maxHealth: 100,
  punchRange: 1.9,
  punchDamage: 34,
  shotDamage: 40,
  shotRange: 90,
  shotCooldown: 0.22,
};

export const CAR = {
  accel: 15.5,
  brake: 26,
  reverseMax: 9,
  drag: 0.55,
  grip: 3.4,              // how fast heading follows steering
  maxSteer: 0.62,
  radius: 1.55,
  maxHealth: 100,
};

export const WANTED = {
  maxStars: 5,
  decaySeconds: 26,       // lose a star after this long unseen & clean
  bustedFillTime: 2.4,    // seconds in a cop's grip before BUSTED
  bustedRange: 7.5,
  policeCap: [0, 2, 3, 4, 6, 8],   // cruisers by star count
  policeSpeed: [0, 15.5, 17.5, 19.5, 21.5, 23.5],
};

export const PALETTE = {
  sky: 0x2e4a7a,
  skyHorizon: 0xffb37a,
  fog: 0xe8a06a,
  sun: 0xffd9a0,
  asphalt: 0x35373d,
  sidewalk: 0x9b8f7d,
  sand: 0xe6cf9e,
  water: 0x1d6f8e,
  grass: 0x5d8a4a,
  buildingTones: [0xd9c9a8, 0xc7b299, 0xe8dcc0, 0xbfae94, 0xd4b48c, 0xc9c2b4, 0xe3b7a0, 0xa8bfc4],
  carPaints: [0xc23b2e, 0x2e6fc2, 0xe8b13a, 0x3fae6a, 0xe6e2da, 0x30323a, 0x8e44ad, 0xe67e22, 0x16a3a3, 0xd6336c],
  policePaint: 0xf2f2f0,
  taxiPaint: 0xf5b81d,
};

export const DISTRICTS = [
  { name: 'Marina District', x: 150, z: 150 },
  { name: 'Old Port', x: 170, z: -160 },
  { name: 'Palm Heights', x: -150, z: 150 },
  { name: 'Downtown Azura', x: -20, z: -20 },
  { name: 'Verano Flats', x: -160, z: -160 },
  { name: 'Azura Beach', x: 235, z: 0 },
];

export const SAVE_KEY = 'port-azura-heat-save-v1';
