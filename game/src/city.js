import * as THREE from 'three';
import { AVENUES, STREETS, ROAD_HALF, WORLD_EDGE, BEACH_Z, SEA_Z, POIS, districtAt } from './config.js';
import { clamp } from './rng.js';

export { districtAt };

// Canvas textures: a window-grid facade, an asphalt tile with a dashed
// centre line, palm fronds and POI sign boards. All drawn, never loaded.
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 2;
  return t;
}
function facadeTexture(litRatio, rng) {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#d8d5ce'; g.fillRect(0, 0, w, h);
    for (let y = 10; y < h - 12; y += 22) {
      for (let x = 9; x < w - 14; x += 24) {
        const lit = rng.next() < litRatio;
        g.fillStyle = lit ? '#ffd98a' : '#33404f';
        g.fillRect(x, y, 15, 13);
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(x, y, 15, 3);
      }
    }
  });
}
function signTexture(text, bg) {
  return canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#ffffff';
    g.font = 'bold 54px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

const BUILDING_COLORS = [0xe8dcc8, 0xd9c6a5, 0xc7d3d8, 0xe6b8a2, 0xb9c9b4, 0xd8a7b0, 0xf0e6d2, 0xaFC3cf, 0xe3c878, 0xc98d5f];

export function buildCity(scene, rng) {
  const colliders = [];
  const dynamic = { water: null, clouds: [] };

  // ---- sky, light, fog -----------------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float t = clamp(normalize(vP).y, -0.05, 1.0);
          vec3 horizon = vec3(1.0, 0.62, 0.30);
          vec3 mid = vec3(0.85, 0.30, 0.16);
          vec3 top = vec3(0.16, 0.20, 0.45);
          vec3 c = t < 0.22 ? mix(horizon, mid, t / 0.22) : mix(mid, top, (t - 0.22) / 0.78);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
  scene.add(sky);
  scene.fog = new THREE.Fog(0xe88a52, 200, 1100);
  const hemi = new THREE.HemisphereLight(0xffd9b0, 0x2e3d4d, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb37a, 1.6);
  sun.position.set(-260, 190, 320);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x88a6ff, 0.3);
  fill.position.set(200, 300, -200);
  scene.add(fill);

  // ---- ground, roads, beach, sea ------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_EDGE * 2 + 160, WORLD_EDGE * 2 + 160),
    new THREE.MeshLambertMaterial({ color: 0x77705f }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
  scene.add(ground);

  const asphaltTex = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#2f3033'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a3b3f'; g.fillRect(0, 0, 4, h); g.fillRect(w - 4, 0, 4, h);
    g.fillStyle = '#e8b93e'; g.fillRect(w / 2 - 2, 6, 4, 26);
  });
  asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
  const roadMat = new THREE.MeshLambertMaterial({ map: asphaltTex });
  const roadGeoNS = new THREE.PlaneGeometry(ROAD_HALF * 2, WORLD_EDGE * 2 + 40);
  const roadGeoEW = new THREE.PlaneGeometry(WORLD_EDGE * 2 + 40, ROAD_HALF * 2);
  for (const x of AVENUES) {
    const m = new THREE.Mesh(roadGeoNS, roadMat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.0, 0);
    m.material = roadMat;
    scene.add(m);
  }
  for (const z of STREETS) {
    const m = new THREE.Mesh(roadGeoEW, roadMat);
    m.rotation.x = -Math.PI / 2; m.position.set(0, 0.0, z);
    scene.add(m);
  }
  // A shore road along the beach.
  const shore = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_EDGE * 2 + 40, 12), new THREE.MeshLambertMaterial({ color: 0x35322e }));
  shore.rotation.x = -Math.PI / 2; shore.position.set(0, 0.01, BEACH_Z - 2);
  scene.add(shore);
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_EDGE * 2 + 300, SEA_Z - BEACH_Z + 30),
    new THREE.MeshLambertMaterial({ color: 0xe6cf9e }));
  sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.02, (BEACH_Z + SEA_Z) / 2 + 8);
  scene.add(sand);
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x1d7f8c, transparent: true, opacity: 0.92 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_EDGE * 2 + 600, 500), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.set(0, 0.12, SEA_Z + 240);
  scene.add(water);
  dynamic.water = waterMat;
  // Two wooden piers reaching into the bay.
  const pierMat = new THREE.MeshLambertMaterial({ color: 0x8a6a44 });
  for (const px of [-180, 180]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 60), pierMat);
    pier.position.set(px, 0.4, SEA_Z + 16);
    scene.add(pier);
  }

  // ---- buildings -------------------------------------------------------------
  const facades = [facadeTexture(0.16, rng), facadeTexture(0.3, rng), facadeTexture(0.08, rng)];
  const blockList = [];
  for (let i = 0; i < AVENUES.length - 1; i++) {
    for (let j = 0; j < STREETS.length - 1; j++) {
      blockList.push({
        x0: AVENUES[i] + ROAD_HALF, x1: AVENUES[i + 1] - ROAD_HALF,
        z0: STREETS[j] + ROAD_HALF, z1: STREETS[j + 1] - ROAD_HALF,
      });
    }
  }
  // The plaza block by the café and a car park west of it stay building-free.
  const isSpecialBlock = (b) =>
    (b.x0 === -38 && b.z0 === 7) || (b.x0 === -83 && b.z0 === 7);
  const poiBlocks = new Set(['7,7', '7,-38', '-128,52', '52,-83', '-128,-128', '-83,97', '142,97', '142,-83']);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const placements = [];
  for (const b of blockList) {
    const key = `${b.x0},${b.z0}`;
    if (isSpecialBlock(b) || poiBlocks.has(key)) continue;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const downtown = Math.abs(cx) < 80 && cz < 30 && cz > -170;
    if (rng.chance(0.42)) {
      placements.push({ x: cx, z: cz, w: 24, d: 24, h: rng.range(10, downtown ? 46 : 24), b });
    } else {
      for (const [ox, oz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
        if (rng.chance(0.22)) continue;
        placements.push({ x: cx + ox, z: cz + oz, w: 13, d: 13, h: rng.range(7, downtown ? 30 : 17), b });
      }
    }
  }
  const inst = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ map: facades[0] }), placements.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  placements.forEach((p, i) => {
    dummy.position.set(p.x, p.h / 2, p.z);
    dummy.scale.set(p.w, p.h, p.d);
    dummy.rotation.y = 0;
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    inst.setColorAt(i, color.setHex(rng.pick(BUILDING_COLORS)));
    colliders.push({ minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2 });
  });
  inst.instanceMatrix.needsUpdate = true;
  scene.add(inst);
  // A second instanced set with a different facade for variety.
  const inst2 = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ map: facades[1] }), Math.ceil(placements.length / 3));
  let n2 = 0;
  placements.forEach((p, i) => {
    if (i % 3 !== 0 || n2 >= inst2.count) return;
    dummy.position.set(p.x, p.h / 2 + 0.02, p.z);
    dummy.scale.set(p.w + 0.06, p.h, p.d + 0.06);
    dummy.updateMatrix();
    inst2.setMatrixAt(n2, dummy.matrix);
    inst2.setColorAt(n2, color.setHex(0xf5efe2));
    n2++;
  });
  inst2.count = n2;
  inst2.instanceMatrix.needsUpdate = true;
  scene.add(inst2);

  // Plaza: green + a fountain disc where the walk probe roams.
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(31, 31), new THREE.MeshLambertMaterial({ color: 0x4d7d43 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.set(-22.5, 0.03, 22.5);
  scene.add(plaza);
  const fountain = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 0.8, 18), new THREE.MeshLambertMaterial({ color: 0x9fc6cc }));
  fountain.position.set(-22.5, 0.4, 22.5);
  scene.add(fountain);
  colliders.push({ minX: -26, maxX: -19, minZ: 19, maxZ: 26 });
  const carpark = new THREE.Mesh(new THREE.PlaneGeometry(31, 31), new THREE.MeshLambertMaterial({ color: 0x3c3d40 }));
  carpark.rotation.x = -Math.PI / 2; carpark.position.set(-67.5, 0.03, 22.5);
  scene.add(carpark);

  // ---- POI buildings and signs ----------------------------------------------
  const signMat = (text, bg) => new THREE.MeshBasicMaterial({ map: signTexture(text, bg), side: THREE.DoubleSide });
  function poiBuilding(cx, cz, w, d, h, hex, label, bg, signX, signZ) {
    const mat = new THREE.MeshLambertMaterial({ map: facades[2], color: hex });
    const m = new THREE.Mesh(boxGeo, mat);
    m.position.set(cx, h / 2, cz); m.scale.set(w, h, d);
    scene.add(m);
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.6, 6), new THREE.MeshLambertMaterial({ color: 0x22242a }));
    pole.position.set(signX, 2.3, signZ);
    scene.add(pole);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 1.9), signMat(label, bg));
    board.position.set(signX, 5.1, signZ);
    board.rotation.y = Math.PI / 4;
    scene.add(board);
  }
  poiBuilding(23, 22, 16, 14, 11, 0xf3e3bb, POIS.cafe.short, '#8a4b1d', 9, 40);
  poiBuilding(-158, 68, 20, 16, 9, 0xb9c2c9, POIS.garage.short, '#274b63', -142, 82);
  poiBuilding(68, -68, 18, 15, 14, 0x9fb4cc, POIS.police.short, '#1d3557', 52, -52);
  poiBuilding(-113, -113, 20, 16, 13, 0xf0f0ea, POIS.hospital.short, '#7a1f2b', -97, -97);
  poiBuilding(68, 22, 17, 14, 19, 0xd9c98f, POIS.bank.short, '#14532d', 52, 8);
  poiBuilding(158, -68, 19, 15, 16, 0xe8b4a0, POIS.hotel.short, '#6d214f', 142, -52);
  poiBuilding(-113, 113, 13, 11, 7, 0xe6cf9e, POIS.home.short, '#5b4a1f', -97, 128);
  // Dockside warehouse and marina clubhouse.
  poiBuilding(158, 168, 22, 14, 10, 0xa89a80, POIS.dock.short, '#3f3a30', 172, 180);
  poiBuilding(-158, 168, 20, 14, 8, 0xcfe0e4, POIS.marina.short, '#0f4c5c', -172, 180);

  // ---- palms, trees, lamps -----------------------------------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 5.4, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a44 });
  const frondGeo = new THREE.ConeGeometry(3.1, 1.6, 7);
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
  const palmSpots = [];
  for (let x = -240; x <= 240; x += 24) palmSpots.push([x + rng.range(-3, 3), BEACH_Z + 12 + rng.range(-3, 5)]);
  for (const [px, pz] of [[-150, 150], [-60, 150], [30, 150], [120, 150], [-200, -30], [200, -120], [-30, -200], [90, -200]]) palmSpots.push([px, pz]);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  palmSpots.forEach(([x, z], i) => {
    dummy.position.set(x, 2.7, z);
    dummy.rotation.set(rng.range(-0.06, 0.06), 0, rng.range(-0.09, 0.09));
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    const fronds = new THREE.Mesh(frondGeo, frondMat);
    fronds.position.set(x, 5.5, z);
    fronds.scale.y = 0.62;
    fronds.rotation.y = rng.range(0, Math.PI);
    scene.add(fronds);
  });
  trunks.instanceMatrix.needsUpdate = true;
  scene.add(trunks);

  const lampGeo = new THREE.CylinderGeometry(0.09, 0.09, 6.4, 5);
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x2a2c30 });
  const lampSpots = [];
  for (const x of AVENUES) for (let z = -225; z <= 200; z += 45) lampSpots.push([x + 8.2, z + 8]);
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, lampSpots.length);
  lampSpots.forEach(([x, z], i) => {
    dummy.position.set(x, 3.2, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    lamps.setMatrixAt(i, dummy.matrix);
  });
  lamps.instanceMatrix.needsUpdate = true;
  scene.add(lamps);

  // ---- clouds ------------------------------------------------------------------
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xfff4e2, transparent: true, opacity: 0.88, fog: false });
  for (let i = 0; i < 9; i++) {
    const cloud = new THREE.Group();
    const puffs = rng.int(2, 4);
    for (let p = 0; p < puffs; p++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(rng.range(9, 20), 10, 8), cloudMat);
      s.position.set(p * rng.range(8, 14) - puffs * 5, rng.range(-2, 2), rng.range(-4, 4));
      s.scale.y = 0.32;
      cloud.add(s);
    }
    cloud.position.set(rng.range(-600, 600), rng.range(120, 190), rng.range(-500, 400));
    scene.add(cloud);
    dynamic.clouds.push(cloud);
  }

  let t = 0;
  function update(dt) {
    t += dt;
    if (dynamic.water) dynamic.water.opacity = 0.88 + Math.sin(t * 0.7) * 0.05;
    for (const c of dynamic.clouds) {
      c.position.x += dt * 1.1;
      if (c.position.x > 700) c.position.x = -700;
    }
  }
  return { colliders, poi: POIS, update };
}

// Resolve a circle (x, z, r) against AABB colliders and the world edge.
// Mutates and returns the position object {x, z}.
export function collideCircle(pos, r, colliders) {
  for (const c of colliders) {
    const nx = clamp(pos.x, c.minX, c.maxX);
    const nz = clamp(pos.z, c.minZ, c.maxZ);
    const dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * r;
        pos.z = nz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the smallest penetration.
        const left = pos.x - c.minX, right = c.maxX - pos.x;
        const top = pos.z - c.minZ, bottom = c.maxZ - pos.z;
        const m = Math.min(left, right, top, bottom);
        if (m === left) pos.x = c.minX - r;
        else if (m === right) pos.x = c.maxX + r;
        else if (m === top) pos.z = c.minZ - r;
        else pos.z = c.maxZ + r;
      }
    }
  }
  pos.x = clamp(pos.x, -WORLD_EDGE, WORLD_EDGE);
  pos.z = clamp(pos.z, -WORLD_EDGE, SEA_Z - 1.5);
  return pos;
}
