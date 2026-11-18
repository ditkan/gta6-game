// Port Azura's fixed geography and tuning. Streets form a grid: avenues run
// north-south (constant x), streets run east-west (constant z). The bay and
// Azura Beach sit along the south edge (large positive z).
export const AVENUES = [-225, -180, -135, -90, -45, 0, 45, 90, 135, 180, 225];
export const STREETS = [-225, -180, -135, -90, -45, 0, 45, 90, 135, 180];
export const ROAD_HALF = 7;          // half the width of a road
export const WORLD_EDGE = 250;       // playable bounds on x and z
export const BEACH_Z = 196;          // sand starts here
export const SEA_Z = 238;            // open water starts here

// Named places of interest. x/z is the street-side point you walk or drive
// to; each sits by an intersection so there is always room to arrive.
export const POIS = {
  cafe:     { x: 0,    z: 45,   name: 'Café Sol',       short: 'CAFÉ SOL' },
  garage:   { x: -135, z: 90,   name: "Lucia's Garage", short: 'GARAGE' },
  police:   { x: 45,   z: -45,  name: 'Azura PD',       short: 'AZURA PD' },
  hospital: { x: -90,  z: -90,  name: 'St. Marina Hospital', short: 'HOSPITAL' },
  bank:     { x: 45,   z: 0,    name: 'Banco Azura',    short: 'BANCO AZURA' },
  hotel:    { x: 135,  z: -45,  name: 'Hotel Verano',   short: 'HOTEL VERANO' },
  home:     { x: -90,  z: 135,  name: 'Casa Serra',     short: 'CASA SERRA' },
  dock:     { x: 180,  z: 188,  name: 'Old Port Dock',  short: 'THE DOCK' },
  marina:   { x: -180, z: 188,  name: 'Azura Marina',   short: 'MARINA' },
};

export function districtAt(x, z) {
  if (z >= BEACH_Z - 8) return 'Azura Beach';
  if (x <= -70 && z >= 24) return 'Marina District';
  if (x >= 70 && z >= 24) return 'Old Port';
  if (x <= -70) return 'Palm Heights';
  if (x >= 70) return 'Verano Flats';
  return 'Downtown Azura';
}

// Vehicle archetypes. topSpeed/accel in metres and metres per second.
export const VEHICLE_TYPES = {
  sedan:    { topSpeed: 27, accel: 13.5, grip: 2.6, len: 4.3, wid: 1.9, hp: 130 },
  coupe:    { topSpeed: 31, accel: 16,   grip: 2.9, len: 4.1, wid: 1.85, hp: 120 },
  van:      { topSpeed: 22, accel: 10,   grip: 2.2, len: 5.2, wid: 2.1, hp: 190 },
  pickup:   { topSpeed: 25, accel: 12,   grip: 2.4, len: 5.0, wid: 2.0, hp: 170 },
  taxi:     { topSpeed: 27, accel: 13.5, grip: 2.6, len: 4.3, wid: 1.9, hp: 130 },
  cruiser:  { topSpeed: 32, accel: 17,   grip: 3.0, len: 4.5, wid: 1.95, hp: 210 },
  armoured: { topSpeed: 21, accel: 9,    grip: 2.1, len: 5.6, wid: 2.2, hp: 420 },
};
export const CAR_COLORS = [0xc23b2e, 0x2e6fc2, 0xe8e4da, 0x30343c, 0x3fae6a, 0xe0a52c, 0x7a4fc0, 0xbfc5cc, 0x843c28, 0x2a9d8f];
export const SAVE_KEY = 'port-azura-heat-save-v1';
export const PLAYER_SPAWN = { x: -16, z: 45, angle: Math.PI / 2 };
