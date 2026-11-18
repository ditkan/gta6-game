// city.js — builds Port Azura itself: the road grid, city blocks with
// procedurally textured buildings, named places of interest (Lucia's garage,
// Azura PD, the hospital, Banco Azura, Hotel Verano, Café Sol), palm-lined
// sidewalks, the beach and the sea. Also owns the collision boxes and the
// road-network helpers the traffic and the minimap read.

import * as THREE from 'three';
import { WORLD, PALETTE, DISTRICTS } from './config.js';
import { clamp } from './rng.js';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildingTexture(rng, tone, floors, cols) {
  return canvasTexture(128, 256, (g) => {
    g.fillStyle = tone;
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(0, 0, 128, 10);
    const fh = 256 / floors;
    const cw = 128 / cols;
    for (let f = 0; f < floors; f++) {
      for (let col = 0; col < cols; col++) {
        const lit = rng.chance(0.5);
        g.fillStyle = lit ? '#ffd98c' : '#46536a';
        g.fillRect(col * cw + 3, f * fh + 4, cw - 6, fh - 8);
        g.fillStyle = 'rgba(255,255,255,0.14)';
        g.fillRect(col * cw + 3, f * fh + 4, cw - 6, 3);
      }
    }
  });
}

function signTexture(text, bg, fg) {
  return canvasTexture(512, 96, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = fg;
    g.font = '900 52px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 52);
  });
}

function roadTexture() {
  const tex = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#404248';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#f5efe4';
    g.fillRect(0, 0, 4, 128);
    g.fillRect(124, 0, 4, 128);
    g.fillStyle = '#ffd23e';
    g.fillRect(61, 6, 6, 46);
    g.fillRect(61, 76, 6, 46);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function buildCity(scene, rng) {
  const city = {
    colliders: [],
    parkingSpots: [],
    poi: {},
    updateFns: [],
  };
  const group = new THREE.Group();
  scene.add(group);

  // ---- sky, fog, lights -------------------------------------------------
  const skyGeo = new THREE.SphereGeometry(900, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x35507e) },
      mid: { value: new THREE.Color(0xd96f4e) },
      low: { value: new THREE.Color(0xffc98a) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP;' +
      'void main(){ float h = normalize(vP).y; vec3 c = h > 0.22 ? mix(mid, top, smoothstep(0.22, 0.75, h)) : mix(low, mid, smoothstep(-0.04, 0.22, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  group.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(PALETTE.fog, 190, 720);

  const hemi = new THREE.HemisphereLight(0xffd9b0, 0x4a3b52, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 1.9);
  sun.position.set(-260, 210, -140);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -130;
  sun.shadow.camera.right = 130;
  sun.shadow.camera.top = 130;
  sun.shadow.camera.bottom = -130;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  city.sun = sun;

  // Clouds: soft flattened puffs drifting very slowly.
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xfff2df, transparent: true, opacity: 0.82, fog: false });
  const clouds = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const puff = new THREE.Group();
    const n = rng.int(2, 4);
    for (let j = 0; j < n; j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(rng.range(14, 30), 10, 8), cloudMat);
      s.position.set(j * rng.range(12, 20) - n * 8, rng.range(-2, 2), rng.range(-6, 6));
      s.scale.y = 0.32;
      puff.add(s);
    }
    puff.position.set(rng.range(-600, 600), rng.range(120, 190), rng.range(-600, 600));
    clouds.add(puff);
  }
  group.add(clouds);
  city.updateFns.push((dt) => { clouds.position.x += dt * 0.7; if (clouds.position.x > 80) clouds.position.x = -80; });

  // ---- ground, roads, sidewalks ----------------------------------------
  const H = WORLD.halfSize;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(H * 2 + 160, H * 2 + 160),
    new THREE.MeshLambertMaterial({ color: 0x77705f }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  group.add(ground);

  const roadTex = roadTexture();
  const walkMat = new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk });
  const lines = WORLD.roadLines;
  const span = H * 2 + 24;
  for (const L of lines) {
    for (const axis of ['x', 'z']) {
      const tex = roadTex.clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, span / 14);
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      const geo = axis === 'x'
        ? new THREE.PlaneGeometry(span, WORLD.roadHalfWidth * 2)
        : new THREE.PlaneGeometry(WORLD.roadHalfWidth * 2, span);
      const road = new THREE.Mesh(geo, mat);
      road.rotation.x = -Math.PI / 2;
      if (axis === 'x') road.position.set(0, 0.02, L);
      else road.position.set(L, 0.02, 0);
      road.receiveShadow = true;
      group.add(road);
      for (const side of [-1, 1]) {
        const walk = new THREE.Mesh(new THREE.PlaneGeometry(span, 3.4), walkMat);
        walk.rotation.x = -Math.PI / 2;
        const off = side * (WORLD.roadHalfWidth + 1.7);
        if (axis === 'x') walk.position.set(0, 0.03, L + off);
        else walk.position.set(L + off, 0.03, 0);
        walk.receiveShadow = true;
        group.add(walk);
      }
    }
  }

  // ---- city blocks: buildings, lots, parks ------------------------------
  const tones = PALETTE.buildingTones.map((c) => '#' + c.toString(16).padStart(6, '0'));
  const facadeCache = [];
  for (let i = 0; i < 8; i++) {
    facadeCache.push(new THREE.MeshLambertMaterial({
      map: buildingTexture(rng, tones[i % tones.length], rng.int(6, 12), rng.int(4, 6)),
    }));
  }
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x6b5a49 });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  function addBuilding(x, z, w, d, h, matIdx) {
    const mesh = new THREE.Mesh(boxGeo, [facadeCache[matIdx], facadeCache[matIdx], roofMat, roofMat, facadeCache[matIdx], facadeCache[matIdx]]);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    city.colliders.push({ x0: x - w / 2 - 0.3, z0: z - d / 2 - 0.3, x1: x + w / 2 + 0.3, z1: z + d / 2 + 0.3 });
    return mesh;
  }

  function addSign(x, y, z, ry, text, bg, fg, w = 16) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * 0.1875),
      new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg) }),
    );
    sign.position.set(x, y, z);
    sign.rotation.y = ry;
    group.add(sign);
    return sign;
  }

  // Downtown blocks (near centre) grow taller.
  for (let bi = 0; bi < lines.length - 1; bi++) {
    for (let bj = 0; bj < lines.length - 1; bj++) {
      const cx = (lines[bi] + lines[bi + 1]) / 2;
      const cz = (lines[bj] + lines[bj + 1]) / 2;
      const downtown = Math.max(0, 1 - Math.hypot(cx, cz) / 240);
      const roll = rng.next();
      if (roll < 0.14) {
        // Parking lot: flat slab plus marked spots the game fills with cars.
        const lot = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshLambertMaterial({ color: 0x44464c }));
        lot.rotation.x = -Math.PI / 2;
        lot.position.set(cx, 0.04, cz);
        lot.receiveShadow = true;
        group.add(lot);
        for (let sIdx = 0; sIdx < 4; sIdx++) {
          city.parkingSpots.push({ x: cx - 9 + sIdx * 6, z: cz - 8, angle: 0 });
          city.parkingSpots.push({ x: cx - 9 + sIdx * 6, z: cz + 8, angle: Math.PI });
        }
      } else if (roll < 0.24) {
        // Pocket park: grass and palms, no colliders but the palms.
        const park = new THREE.Mesh(new THREE.PlaneGeometry(27, 27), new THREE.MeshLambertMaterial({ color: PALETTE.grass }));
        park.rotation.x = -Math.PI / 2;
        park.position.set(cx, 0.04, cz);
        park.receiveShadow = true;
        group.add(park);
        for (let p = 0; p < 5; p++) addPalm(group, city, cx + rng.range(-11, 11), cz + rng.range(-11, 11), rng);
      } else {
        const count = rng.int(1, 2);
        for (let b = 0; b < count; b++) {
          const w = rng.range(11, 15);
          const d = rng.range(11, 15);
          const h = rng.range(10, 22) + downtown * rng.range(14, 42);
          const ox = count === 1 ? 0 : (b === 0 ? -8 : 8);
          const oz = count === 1 ? 0 : rng.range(-6, 6);
          addBuilding(cx + ox, cz + oz, w, d, h, rng.int(0, facadeCache.length - 1));
        }
      }
    }
  }

  // ---- named places of interest -----------------------------------------
  function poiBuilding(key, x, z, w, d, h, sign, bg, fg, signFace = Math.PI / 2) {
    const mesh = addBuilding(x, z, w, d, h, rng.int(0, facadeCache.length - 1));
    addSign(x + (w / 2 + 0.15) * Math.sin(signFace), h * 0.78, z + (d / 2 + 0.15) * Math.cos(signFace), signFace, sign, bg, fg, Math.min(20, w + 4));
    city.poi[key] = { x, z };
    return mesh;
  }
  poiBuilding('garage', -52, 34, 20, 14, 8, "LUCIA'S GARAGE", '#173f35', '#7fe7dc');
  poiBuilding('police', 34, -52, 22, 16, 13, 'AZURA PD', '#1c2f57', '#ffffff');
  poiBuilding('hospital', -52, -94, 24, 16, 15, 'HOSPITAL', '#e8e4da', '#d43a2e');
  poiBuilding('bank', 34, 74, 22, 18, 17, 'BANCO AZURA', '#3a2c14', '#ffd23e');
  poiBuilding('hotel', 154, 34, 20, 20, 46, 'HOTEL VERANO', '#571c3f', '#ffb3d9');
  poiBuilding('cafe', -94, 34, 14, 12, 7, 'CAFÉ SOL', '#6e3410', '#ffe9b8');
  poiBuilding('port', 194, -154, 30, 18, 11, 'PORT AZURA', '#274b63', '#bfe6ff');
  poiBuilding('safehouse', -154, 154, 13, 11, 8, 'CASA SERRA', '#40342a', '#f5efe4');

  // Port cranes: two simple gantry silhouettes at the Old Port.
  const craneMat = new THREE.MeshLambertMaterial({ color: 0xc45a28 });
  for (const [cx, cz] of [[186, -186], [214, -120]]) {
    const crane = new THREE.Group();
    for (const dx of [-9, 9]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 26, 1.6), craneMat);
      leg.position.set(dx, 13, 0);
      leg.castShadow = true;
      crane.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(30, 2, 2.4), craneMat);
    beam.position.y = 26;
    beam.castShadow = true;
    crane.add(beam);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 2), craneMat);
    jib.position.set(6, 20, 0);
    crane.add(jib);
    crane.position.set(cx, 0, cz);
    group.add(crane);
    city.colliders.push({ x0: cx - 11, z0: cz - 2, x1: cx + 11, z1: cz + 2 });
  }

  // ---- beach, pier, sea ---------------------------------------------------
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(40, H * 2 + 120), new THREE.MeshLambertMaterial({ color: PALETTE.sand }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(WORLD.beachX + 16, 0.01, 0);
  sand.receiveShadow = true;
  group.add(sand);

  const waterTex = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#1d6f8e';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(255,255,255,0.13)';
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      const y = i * 15 + 4;
      g.moveTo(0, y);
      g.bezierCurveTo(40, y - 4, 84, y + 4, 128, y);
      g.stroke();
    }
  });
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(10, 40);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(340, H * 2 + 320),
    new THREE.MeshLambertMaterial({ map: waterTex, transparent: true, opacity: 0.94 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(WORLD.waterX + 168, 0.12, 0);
  group.add(water);
  city.updateFns.push((dt) => { waterTex.offset.y += dt * 0.014; waterTex.offset.x += dt * 0.004; });

  const pierMat = new THREE.MeshLambertMaterial({ color: 0x8a6b4a });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(46, 1.2, 8), pierMat);
  pier.position.set(WORLD.waterX + 18, 0.7, 40);
  pier.castShadow = true;
  group.add(pier);
  city.colliders.push({ x0: WORLD.waterX - 4, z0: 35.5, x1: WORLD.waterX + 42, z1: 44.5 });
  city.poi.marina = { x: WORLD.beachX - 6, z: 40 };

  // Palms and lamps along the beach and the main streets.
  for (let z = -230; z <= 230; z += 23) addPalm(group, city, WORLD.beachX - 3, z + rng.range(-3, 3), rng);
  for (const L of [-120, 0, 120]) {
    for (let t = -230; t <= 230; t += 46) {
      addPalm(group, city, L + WORLD.roadHalfWidth + 2.6, t, rng);
      addLamp(group, t, L - WORLD.roadHalfWidth - 2.6);
    }
  }

  // ---- helpers the rest of the game reads --------------------------------
  city.isRoad = (x, z) => lines.some((L) => Math.abs(x - L) < WORLD.roadHalfWidth + 0.4 || Math.abs(z - L) < WORLD.roadHalfWidth + 0.4);
  city.districtAt = (x, z) => {
    let best = DISTRICTS[3];
    let bestD = Infinity;
    for (const d of DISTRICTS) {
      const dd = (d.x - x) ** 2 + (d.z - z) ** 2;
      if (dd < bestD) { bestD = dd; best = d; }
    }
    return best.name;
  };
  city.update = (dt, elapsed) => { for (const fn of city.updateFns) fn(dt, elapsed); };
  return city;
}

const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6b4a });
const frondMat = new THREE.MeshLambertMaterial({ color: 0x3f7d3a, side: THREE.DoubleSide });
const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 5.6, 6);
const frondGeo = new THREE.PlaneGeometry(3.6, 0.9);

export function addPalm(group, city, x, z, rng) {
  const palm = new THREE.Group();
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 2.8;
  trunk.rotation.z = rng.range(-0.06, 0.06);
  trunk.castShadow = true;
  palm.add(trunk);
  for (let i = 0; i < 6; i++) {
    const frond = new THREE.Mesh(frondGeo, frondMat);
    frond.position.y = 5.6;
    frond.rotation.y = (i / 6) * Math.PI * 2;
    frond.rotation.z = -0.5;
    frond.translateX(1.6);
    palm.add(frond);
  }
  palm.position.set(x, 0, z);
  group.add(palm);
  if (city) city.colliders.push({ x0: x - 0.4, z0: z - 0.4, x1: x + 0.4, z1: z + 0.4 });
  return palm;
}

const lampPoleMat = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffca7a });
const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6.4, 6);
const bulbGeo = new THREE.SphereGeometry(0.32, 8, 6);

export function addLamp(group, x, z) {
  const lamp = new THREE.Group();
  const pole = new THREE.Mesh(poleGeo, lampPoleMat);
  pole.position.y = 3.2;
  pole.castShadow = true;
  lamp.add(pole);
  const bulb = new THREE.Mesh(bulbGeo, lampGlowMat);
  bulb.position.y = 6.5;
  lamp.add(bulb);
  lamp.position.set(x, 0, z);
  group.add(lamp);
  return lamp;
}

// Axis-separated AABB resolution shared by the player and every car: tries to
// move (x, z) by (dx, dz) with a circular radius against the collider list.
export function moveWithColliders(colliders, x, z, dx, dz, radius) {
  let nx = x + dx;
  for (const c of colliders) {
    if (nx + radius > c.x0 && nx - radius < c.x1 && z + radius > c.z0 && z - radius < c.z1) {
      nx = dx > 0 ? c.x0 - radius : c.x1 + radius;
    }
  }
  let nz = z + dz;
  for (const c of colliders) {
    if (nx + radius > c.x0 && nx - radius < c.x1 && nz + radius > c.z0 && nz - radius < c.z1) {
      nz = dz > 0 ? c.z0 - radius : c.z1 + radius;
    }
  }
  const hitX = Math.abs(nx - (x + dx)) > 0.001;
  const hitZ = Math.abs(nz - (z + dz)) > 0.001;
  return { x: clamp(nx, -WORLD.halfSize - 30, WORLD.waterX + 6), z: clamp(nz, -WORLD.halfSize - 30, WORLD.halfSize + 30), hit: hitX || hitZ, hitX, hitZ };
}
