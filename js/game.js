// STARRUNNER core: rendering, flight model, obstacles, sectors, scoring.
import * as THREE from 'three';
import { Trench, HW, TH } from './trench.js';
import { Particles, PostFX, glowSprite } from './fx.js';
import { buildShip, CANNON_X } from './ship.js';

const BX = 8.0;                 // lateral flight bound (ship centre)
const BY0 = 3.4, BY1 = TH - 5.5; // vertical flight bounds
const SHW = 1.9, SHH = 0.55, SHD = 1.6; // ship half extents (x, y, z) for collisions
const LATERAL = 36;             // max lateral speed (units/s)

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const pad2 = n => String(n).padStart(2, '0');

export const SECTORS = [
  { name: 'OUTER CHANNEL', tip: 'Crossbeams ahead. Fly over or under them.' },
  { name: 'BULKHEAD RUN', tip: 'Bulkheads and slabs. Weave left, right, high and low.' },
  { name: 'GUN DECK', tip: 'Wall turrets online. Lock on and shoot them first.' },
  { name: 'BLAST DOORS', tip: 'Thread the glowing openings in the blast doors.' },
  { name: 'SWEEPER LINE', tip: 'Moving barriers. Read their rhythm, then commit.' },
  { name: 'MINEFIELD', tip: 'Seeker mines drift toward you. Clear a path.' },
  { name: 'DEEP CORE', tip: 'Everything at once. Hold your nerve.' },
];
export function sectorInfo(n) {
  if (n <= SECTORS.length) return SECTORS[n - 1];
  return { name: `DEEP CORE · LAYER ${n - SECTORS.length + 1}`, tip: 'Faster. Tighter. Keep going.' };
}

export const DIFFS = {
  cadet: { label: 'CADET', speed: 0.86, dmg: 0.6, gap: 1.18, fire: 0.7 },
  pilot: { label: 'PILOT', speed: 1.0, dmg: 1.0, gap: 1.0, fire: 1.0 },
  ace: { label: 'ACE', speed: 1.16, dmg: 1.4, gap: 0.88, fire: 1.3 },
};

const ACCENTS = [0xffb347, 0x59d8ff, 0xff5a4a, 0x9dff6a, 0xd48cff, 0xfff27a, 0xff7ad9, 0x7affe4];

function params(n, diff) {
  const k = n - 1;
  return {
    speed: Math.min(245, 90 + 14 * k) * diff.speed,
    gapSec: Math.max(0.74, 1.5 - 0.1 * k) * diff.gap,
    length: 3000 + 450 * k,
    turretChance: n >= 3 ? Math.min(0.8, (n === 3 ? 0.6 : 0.35) + 0.06 * (n - 3)) : 0,
    turretRate: Math.max(0.6, 2.3 - 0.22 * (n - 3)) / diff.fire,
    boltSpeed: 150 + 10 * k,
    hole: Math.max(6.6, 10 - 0.45 * Math.max(0, n - 4)),
    moverSpeed: 0.8 + 0.1 * n,
    homing: 3 + n * 0.8,
  };
}

export class Game {
  constructor(canvas, sound, input, hud) {
    this.sound = sound;
    this.input = input;
    this.hud = hud;
    this.state = 'menu';
    this.time = 0;
    this.diffKey = 'pilot';
    this.diff = DIFFS.pilot;
    this.settings = { quality: 'high', blur: true, invertY: false, autofire: false };

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x010204);
    scene.fog = new THREE.Fog(0x03050a, 80, 600);

    this.camera = new THREE.PerspectiveCamera(66, 1, 0.1, 3200);
    this.post = new PostFX(r);

    // lights: low sun raking the left wall, cool sky fill
    this.hemi = new THREE.HemisphereLight(0x9fb0c8, 0x14161c, 0.75);
    scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xe8eef8, 3.0));
    sun.shadow.camera.left = -110; sun.shadow.camera.right = 110;
    sun.shadow.camera.top = 140; sun.shadow.camera.bottom = -140;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 700;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
    scene.add(sun, sun.target);
    this.shipLight = new THREE.PointLight(0xffa060, 40, 16, 2);
    scene.add(this.shipLight);
    this.boomLight = new THREE.PointLight(0xffa060, 0, 90, 2);
    scene.add(this.boomLight);

    this.trench = new Trench(scene);
    this.buildSky();
    this.buildSpeedLines();

    this.ship = buildShip();
    this.ship.position.set(0, 14, 0);
    scene.add(this.ship);
    this.particles = new Particles(scene);

    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.mats = {
      obstacle: new THREE.MeshStandardMaterial({ color: 0x80868e, map: this.trench.greebleTex, roughness: 0.68, metalness: 0.4 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.55 }),
      hazard: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.3, 0.08).multiplyScalar(3.5) }),
      cyan: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.9, 1).multiplyScalar(3) }),
      yellow: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.78, 0.2).multiplyScalar(3) }),
      mine: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.8 }),
      pickup: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1, 0.9).multiplyScalar(2.5) }),
    };
    this.geos = {
      icosa: new THREE.IcosahedronGeometry(1.1, 0),
      spike: new THREE.ConeGeometry(0.22, 1.1, 6),
      octa: new THREE.OctahedronGeometry(1, 0),
      ring: new THREE.TorusGeometry(1.7, 0.08, 6, 32),
      dome: new THREE.SphereGeometry(1.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      boltCore: new THREE.CylinderGeometry(0.09, 0.09, 1, 6).rotateX(Math.PI / 2),
      boltGlow: new THREE.CylinderGeometry(0.32, 0.32, 1, 8).rotateX(Math.PI / 2),
    };
    this.boltMats = {
      pCore: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.3, 0.14).multiplyScalar(6) }),
      pGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.15, 0.05).multiplyScalar(1.4), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
      eCore: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1, 0.4).multiplyScalar(6) }),
      eGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 1, 0.2).multiplyScalar(1.4), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
    this.gateTex = this.makeGateTexture();

    this.objs = [];
    this.bolts = [];
    this.ebolts = [];
    this.debris = [];
    this.boltPool = { p: [], e: [] };

    this.speed = 70;
    this.vx = this.vy = 0;
    this.roll = this.pitch = 0;
    this.target = new THREE.Vector2(0, 14);
    this.shake = 0;
    this.aberr = 0;
    this.flash = new THREE.Color(0, 0, 0);
    this.fireCd = 0;
    this.fireSide = 1;
    this.lock = null;
    this.alarmT = 0;
    this.fovKick = 0;

    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.look = new THREE.Vector3();

    this.applySettings(this.settings);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- setup
  buildSky() {
    const n = 3200, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      let x, y, z, l;
      do { x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1; l = Math.hypot(x, y, z); } while (l > 1 || l < 0.1);
      y = Math.abs(y) * 0.9 + 0.05;
      const R = 2600 / Math.hypot(x, y, z);
      pos.set([x * R, y * R, z * R], i * 3);
      const b = Math.pow(Math.random(), 3) * 1.6 + 0.25;
      const t = Math.random();
      col.set([b * (t < 0.2 ? 0.8 : 1), b * 0.95, b * (t > 0.8 ? 0.8 : 1.1)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // distant moon, lit by the sun into a crescent
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(240, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0x9c8c7e, roughness: 1, fog: false }));
    this.moonOffset = new THREE.Vector3(-700, 950, -2100);
    this.scene.add(this.moon);
  }

  buildSpeedLines() {
    const n = 140;
    this.lineData = [];
    const pos = new Float32Array(n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9fb4d0, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lines.frustumCulled = false;
    for (let i = 0; i < n; i++) this.lineData.push({ x: rand(-HW + 1, HW - 1), y: rand(0.5, TH), z: -rand(0, 400) });
    this.scene.add(this.lines);
  }

  makeGateTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(120,230,255,0.0)');
    grd.addColorStop(0.5, 'rgba(120,230,255,0.25)');
    grd.addColorStop(1, 'rgba(120,230,255,0.6)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 256);
    g.fillStyle = 'rgba(200,250,255,0.5)';
    for (let y = 0; y < 256; y += 8) g.fillRect(0, y, 64, 1);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }

  applySettings(s) {
    Object.assign(this.settings, s);
    const q = this.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.5) : 1;
    const shadows = q !== 'low';
    const map = q === 'high' ? 2048 : 1024;
    if (this.renderer.shadowMap.enabled !== shadows || this.sun.shadow.mapSize.x !== map) {
      this.renderer.shadowMap.enabled = shadows;
      this.sun.castShadow = shadows;
      this.sun.shadow.mapSize.set(map, map);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      this.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => (m.needsUpdate = true)); });
    }
    this.usePost = q !== 'low';
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = (this.pixelRatio || 1) * (this.resScale || 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.baseFov = w / h < 1 ? 82 : w / h < 1.4 ? 72 : 64;
    this.camera.updateProjectionMatrix();
    this.post.setSize(Math.floor(w * pr), Math.floor(h * pr), this.settings.quality === 'high' ? 4 : 2);
  }

  // Dynamic resolution: trade pixels for a steady frame rate on weaker GPUs.
  adaptResolution(dt) {
    if (document.hidden || this.state === 'paused') { this.perfT = this.perfN = 0; return; }
    this.perfT = (this.perfT || 0) + dt;
    this.perfN = (this.perfN || 0) + 1;
    if (this.perfT < 1.5) return;
    const avg = this.perfT / this.perfN;
    this.perfT = this.perfN = 0;
    const s = this.resScale || 1;
    let next = s;
    if (avg > 1 / 48) next = Math.max(0.55, s * 0.85);
    else if (avg < 1 / 57 && s < 1) next = Math.min(1, s * 1.08);
    if (Math.abs(next - s) > 0.01) { this.resScale = next; this.resize(); }
  }

  // ---------------------------------------------------------------- run control
  start(diffKey) {
    this.clearWorld();
    this.diffKey = diffKey;
    this.diff = DIFFS[diffKey] || DIFFS.pilot;
    this.state = 'playing';
    this.score = 0;
    this.shield = 100;
    this.combo = 0;
    this.kills = 0;
    this.closeCalls = 0;
    this.sector = 1;
    this.invuln = 1.5;
    this.distance = 0;
    const z = this.ship.position.z;
    this.bounds = [{ n: 1, startZ: z, endZ: z - params(1, this.diff).length, gateSpawned: false }];
    this.nextSpawnZ = z - 300;
    this.ship.visible = true;
    this.target.set(this.ship.position.x, this.ship.position.y);
    this.trench.setAccent(ACCENTS[0]);
    this.particles.clear();
    const info = sectorInfo(1);
    this.hud.banner(`SECTOR ${pad2(1)}`, info.name, info.tip);
    this.sound.startMusic(1);
  }

  pause() { if (this.state === 'playing') { this.state = 'paused'; this.sound.stopMusic(); this.hud.paused(true); } }
  resume() {
    if (this.state === 'paused') { this.state = 'playing'; this.last = performance.now(); this.sound.startMusic(this.sector); this.hud.paused(false); }
  }
  toMenu() {
    this.clearWorld();
    this.state = 'menu';
    this.ship.visible = true;
    this.trench.setAccent(ACCENTS[0]);
    this.sound.stopMusic();
  }

  clearWorld() {
    for (const o of this.objs) this.scene.remove(o.group);
    this.objs.length = 0;
    for (const b of this.bolts) this.releaseBolt(b);
    for (const b of this.ebolts) this.releaseBolt(b);
    this.bolts.length = this.ebolts.length = 0;
    for (const d of this.debris) this.scene.remove(d.mesh);
    this.debris.length = 0;
    this.lock = null;
  }

  // ---------------------------------------------------------------- main loop
  frame(now) {
    requestAnimationFrame(this.frame);
    const rawDt = Math.max(0, (now - this.last) / 1000);
    const dt = Math.min(0.05, rawDt);
    this.last = now;
    if (rawDt < 0.25) this.adaptResolution(rawDt);
    this.input.poll();
    if (this.input.takePause()) {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }
    if (this.state !== 'paused') {
      this.time += dt;
      if (this.state === 'playing') this.updatePlay(dt);
      else this.updateCruise(dt);
      this.updateBolts(dt);
      this.updateDebris(dt);
      this.particles.update(dt);
    }
    this.updateCamera(this.state === 'paused' ? 0 : dt);
    this.render();
  }

  updateCruise(dt) {
    const s = this.ship.position;
    const targetSpeed = this.state === 'menu' ? 72 : 40;
    this.speed = damp(this.speed, targetSpeed, 1.2, dt);
    if (this.state === 'menu') {
      const t = this.time;
      this.steerTo(Math.sin(t * 0.43) * 6 + Math.sin(t * 1.1) * 1.2, 15 + Math.sin(t * 0.29) * 8, dt);
    } else this.steerTo(s.x, s.y, dt);
    s.z -= this.speed * dt;
    if (this.state === 'dying') {
      this.dieT += dt;
      if (this.dieT > 2.4) { this.state = 'over'; this.hud.gameOver(this.stats()); }
      this.updateObjects(dt, false);
    }
    this.sound.engine(this.speed / 240, this.state === 'menu' || this.ship.visible ? 0.6 : 0.15);
  }

  steerTo(tx, ty, dt) {
    const s = this.ship.position;
    const vx = clamp((tx - s.x) * 9, -LATERAL, LATERAL);
    const vy = clamp((ty - s.y) * 9, -LATERAL, LATERAL);
    this.vx = damp(this.vx, vx, 14, dt);
    this.vy = damp(this.vy, vy, 14, dt);
    s.x = clamp(s.x + this.vx * dt, -BX, BX);
    s.y = clamp(s.y + this.vy * dt, BY0, BY1);
  }

  updatePlay(dt) {
    const s = this.ship.position;
    const inp = this.input;
    const P = params(this.sector, this.diff);

    // ---- steering
    const ax = inp.axis();
    const inv = this.settings.invertY ? -1 : 1;
    if (ax.x || ax.y) {
      this.target.x += ax.x * LATERAL * 1.05 * dt;
      this.target.y += ax.y * inv * LATERAL * 1.05 * dt;
      // keep the target from running far ahead of the ship
      this.target.x = clamp(this.target.x, s.x - 4, s.x + 4);
      this.target.y = clamp(this.target.y, s.y - 4, s.y + 4);
    } else if (inp.device === 'mouse') {
      this.target.x = inp.mouse.nx * BX * 1.15;
      const ny = inp.mouse.ny * inv;
      this.target.y = (BY0 + BY1) / 2 + ny * (BY1 - BY0) / 2 * 1.12;
    } else if (inp.device === 'touch') {
      const d = inp.takeDrag();
      const k = (2 * BX) / (Math.min(window.innerWidth, 900) * 0.55);
      this.target.x += d.x * k;
      this.target.y -= d.y * k * inv * 1.1;
    }
    this.target.x = clamp(this.target.x, -BX, BX);
    this.target.y = clamp(this.target.y, BY0, BY1);
    this.steerTo(this.target.x, this.target.y, dt);

    // ---- forward motion
    this.speed = damp(this.speed, P.speed, 1.4, dt);
    const prevZ = s.z;
    s.z -= this.speed * dt;
    this.distance += this.speed * dt;
    const mult = this.mult();
    this.score += this.speed * dt * 0.1 * mult;
    this.invuln = Math.max(0, this.invuln - dt);

    this.spawnAhead();
    this.updateObjects(dt, true, prevZ);

    // ---- weapons
    this.findLock();
    this.fireCd -= dt;
    const wantFire = inp.firing() || (this.settings.autofire && inp.device === 'touch' && this.lock);
    if (wantFire && this.fireCd <= 0) this.firePlayer();

    // ---- low shield alarm
    if (this.shield < 30) {
      this.alarmT -= dt;
      if (this.alarmT <= 0) { this.sound.alarm(); this.alarmT = 1.4; }
    }

    // ---- HUD
    const b = this.bounds.find(b => s.z <= b.startZ && s.z > b.endZ) || this.bounds[this.bounds.length - 1];
    this.hud.update({
      score: Math.floor(this.score), mult, speed: Math.round(this.speed * 4.2), shield: this.shield,
      progress: clamp((b.startZ - s.z) / (b.startZ - b.endZ), 0, 1), sector: this.sector,
      sectorName: sectorInfo(this.sector).name, invuln: this.invuln > 0,
    });
    this.sound.engine(this.speed / 240, 0.6);
  }

  mult() { return 1 + Math.min(7, Math.floor(this.combo / 3)); }

  // ---------------------------------------------------------------- spawning
  boundFor(z) {
    let last = this.bounds[this.bounds.length - 1];
    while (z <= last.endZ) {
      const n = last.n + 1;
      last = { n, startZ: last.endZ, endZ: last.endZ - params(n, this.diff).length, gateSpawned: false };
      this.bounds.push(last);
    }
    for (let i = this.bounds.length - 1; i >= 0; i--) if (z <= this.bounds[i].startZ) return this.bounds[i];
    return this.bounds[0];
  }

  spawnAhead() {
    const horizon = this.ship.position.z - 580;
    let guard = 0;
    while (this.nextSpawnZ > horizon && guard++ < 20) {
      const z = this.nextSpawnZ;
      const b = this.boundFor(z);
      if (z - b.endZ < 210) {
        if (!b.gateSpawned) { b.gateSpawned = true; this.spawnGate(b.endZ, b.n); }
        this.nextSpawnZ = b.endZ - 240;
        continue;
      }
      const P = params(b.n, this.diff);
      const gm = this.spawnPattern(z, b.n, P);
      this.nextSpawnZ -= P.speed * P.gapSec * gm * rand(0.92, 1.22);
    }
  }

  spawnPattern(z, n, P) {
    const pool = [['beam', 3]];
    if (n >= 2) pool.push(['pillar', n === 2 ? 4 : 2.2], ['slab', n === 2 ? 3 : 1.8]);
    if (n >= 4) pool.push(['door', n === 4 ? 5 : 2.2], ['slot', 1.4]);
    if (n >= 5) pool.push(['mover', n === 5 ? 5 : 2]);
    if (n >= 6) pool.push(['mines', n === 6 ? 3.5 : 1.5]);
    if (n >= 7) pool.push(['cross', 1.6]);
    let total = pool.reduce((a, p) => a + p[1], 0), r = Math.random() * total, type = 'beam';
    for (const [t, w] of pool) { if ((r -= w) <= 0) { type = t; break; } }

    let gm = 1;
    switch (type) {
      case 'beam': this.addRectObstacle(z, 3, [this.beamRect(rand(7, TH - 11), rand(2.4, 4))], 'beam'); break;
      case 'pillar': {
        const x = rand(-4.5, 4.5), w = rand(3, 4.5);
        this.addRectObstacle(z, 3, [{ x0: x - w / 2, x1: x + w / 2, y0: -1, y1: TH + 3 }], 'pillar');
        break;
      }
      case 'slab': {
        const k = (Math.random() * 4) | 0;
        let rc;
        if (k === 0) rc = { x0: -HW - 1, x1: HW + 1, y0: -1, y1: rand(14, 23) };
        else if (k === 1) rc = { x0: -HW - 1, x1: HW + 1, y0: rand(15, 24), y1: TH + 3 };
        else if (k === 2) rc = { x0: -HW - 1, x1: rand(-1.5, 2), y0: -1, y1: TH + 3 };
        else rc = { x0: rand(-2, 1.5), x1: HW + 1, y0: -1, y1: TH + 3 };
        this.addRectObstacle(z, 4, [rc], 'slab');
        gm = 1.1;
        break;
      }
      case 'door': {
        const hw = P.hole, hh = P.hole * 0.72;
        const hx = rand(-BX + hw / 2 - 2.5, BX - hw / 2 + 2.5), hy = rand(BY0 + hh / 2 - 0.4, BY1 - hh / 2 - 2);
        const x0 = hx - hw / 2, x1 = hx + hw / 2, y0 = hy - hh / 2, y1 = hy + hh / 2;
        this.addRectObstacle(z, 2.2, [
          { x0: -HW - 1, x1: x0, y0: -1, y1: TH + 3 }, { x0: x1, x1: HW + 1, y0: -1, y1: TH + 3 },
          { x0, x1, y0: -1, y1: y0 }, { x0, x1, y0: y1, y1: TH + 3 },
        ], 'door', { hole: { x0, x1, y0, y1 } });
        gm = 1.35;
        break;
      }
      case 'slot': {
        const gw = P.hole + 0.8, gx = rand(-BX + gw / 2 - 2, BX - gw / 2 + 2);
        this.addRectObstacle(z, 3, [
          { x0: -HW - 1, x1: gx - gw / 2, y0: -1, y1: TH + 3 }, { x0: gx + gw / 2, x1: HW + 1, y0: -1, y1: TH + 3 },
        ], 'slot');
        gm = 1.2;
        break;
      }
      case 'cross': {
        const y = rand(10, TH - 14), x = rand(-3, 3);
        this.addRectObstacle(z, 3, [this.beamRect(y, 3), { x0: x - 1.8, x1: x + 1.8, y0: -1, y1: TH + 3 }], 'cross');
        gm = 1.2;
        break;
      }
      case 'mover': {
        const vertical = Math.random() < 0.6;
        const o = this.addRectObstacle(z, 3, [vertical ? this.beamRect(TH / 2, 3) : { x0: -2, x1: 2, y0: -1, y1: TH + 3 }], 'mover');
        o.move = { vertical, amp: vertical ? rand(9, 12) : rand(6, 8), w: P.moverSpeed * rand(0.85, 1.2), ph: rand(0, 6.28) };
        gm = 1.25;
        break;
      }
      case 'mines': {
        const k = 2 + ((Math.random() * 3) | 0);
        for (let i = 0; i < k; i++) this.spawnMine(z - i * rand(14, 28), P);
        gm = 1.1;
        break;
      }
    }
    if (Math.random() < P.turretChance) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.spawnTurret(z - rand(10, 60), side, P);
      if (n >= 6 && Math.random() < 0.35) this.spawnTurret(z - rand(10, 60), -side, P);
    }
    if (Math.random() < 0.06 + (this.shield < 50 ? 0.08 : 0)) {
      this.spawnPickup(z + P.speed * P.gapSec * 0.5);
    }
    return gm;
  }

  beamRect(y, th) { return { x0: -HW - 1, x1: HW + 1, y0: y - th / 2, y1: y + th / 2 }; }

  addRectObstacle(z, depth, rects, type, extra = {}) {
    const group = new THREE.Group();
    group.position.z = z;
    const meshes = rects.map(r => {
      const m = new THREE.Mesh(this.box, this.mats.obstacle);
      this.fitRect(m, r, depth);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      return m;
    });
    const glowMat = type === 'mover' ? this.mats.yellow : this.mats.hazard;
    const strips = new THREE.Group();
    group.add(strips);
    if (type === 'door') this.frameStrips(strips, extra.hole, this.mats.cyan, 0.05);
    else rects.forEach(r => this.edgeStrips(strips, r, glowMat, 0.05));
    // blinking end lights
    const blink = glowSprite(type === 'mover' ? 0xffc030 : 0xff4a20, 3.2, 3);
    const r0 = rects[0];
    blink.position.set(clamp((r0.x0 + r0.x1) / 2, -HW + 1, HW - 1), clamp(r0.y1, 0, TH), 0.3);
    group.add(blink);
    this.scene.add(group);
    const o = { type, z, depth, rects: rects.map(r => ({ ...r })), base: rects.map(r => ({ ...r })), group, meshes, strips, blink, minClear: 99, ...extra };
    this.objs.push(o);
    return o;
  }

  fitRect(m, r, depth) {
    m.position.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, -depth / 2);
    m.scale.set(r.x1 - r.x0, r.y1 - r.y0, depth);
  }

  edgeStrips(group, r, mat, z) {
    const t = 0.22;
    const x0 = Math.max(r.x0, -HW), x1 = Math.min(r.x1, HW), y0 = Math.max(r.y0, 0), y1 = Math.min(r.y1, TH);
    const add = (x, y, sx, sy) => { const m = new THREE.Mesh(this.box, mat); m.position.set(x, y, z); m.scale.set(sx, sy, 0.12); group.add(m); };
    if (r.y0 > 0) add((x0 + x1) / 2, y0 + t / 2, x1 - x0, t);
    if (r.y1 < TH) add((x0 + x1) / 2, y1 - t / 2, x1 - x0, t);
    if (r.x0 > -HW) add(x0 + t / 2, (y0 + y1) / 2, t, y1 - y0);
    if (r.x1 < HW) add(x1 - t / 2, (y0 + y1) / 2, t, y1 - y0);
  }

  frameStrips(group, h, mat, z) {
    const t = 0.3;
    const add = (x, y, sx, sy) => { const m = new THREE.Mesh(this.box, mat); m.position.set(x, y, z); m.scale.set(sx, sy, 0.14); group.add(m); };
    add((h.x0 + h.x1) / 2, h.y0 - t / 2, h.x1 - h.x0 + 2 * t, t);
    add((h.x0 + h.x1) / 2, h.y1 + t / 2, h.x1 - h.x0 + 2 * t, t);
    add(h.x0 - t / 2, (h.y0 + h.y1) / 2, t, h.y1 - h.y0);
    add(h.x1 + t / 2, (h.y0 + h.y1) / 2, t, h.y1 - h.y0);
  }

  spawnTurret(z, side, P) {
    const g = new THREE.Group();
    g.position.set(side * (HW - 1.5), rand(TH - 16, TH - 3), z);
    const base = new THREE.Mesh(this.box, this.mats.dark);
    base.scale.set(2.4, 2.8, 3.2); base.position.x = side * 0.5; base.castShadow = true;
    g.add(base);
    const dome = new THREE.Mesh(this.geos.dome, this.mats.obstacle);
    dome.rotation.z = side * Math.PI / 2; dome.position.x = -side * 0.7; dome.castShadow = true;
    g.add(dome);
    const pivot = new THREE.Group();
    pivot.position.x = -side * 1.1;
    for (const dy of [-0.35, 0.35]) {
      const b = new THREE.Mesh(this.box, this.mats.dark);
      b.scale.set(0.22, 0.22, 2.6); b.position.set(0, dy, 1.3);
      pivot.add(b);
    }
    g.add(pivot);
    const eye = glowSprite(0x50ff60, 2.4, 3);
    eye.position.x = -side * 1.3;
    g.add(eye);
    this.scene.add(g);
    this.objs.push({ type: 'turret', z, group: g, pos: g.position, pivot, eye, hp: 2, r: 2.4, cd: rand(0.3, 1.0) * P.turretRate, rate: P.turretRate, boltSpeed: P.boltSpeed, target: true, score: 250 });
  }

  spawnMine(z, P) {
    const g = new THREE.Group();
    g.position.set(rand(-BX, BX), rand(BY0 + 2, BY1 - 4), z);
    const core = new THREE.Mesh(this.geos.icosa, this.mats.mine);
    core.castShadow = true;
    g.add(core);
    for (const [x, y, zz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const s = new THREE.Mesh(this.geos.spike, this.mats.dark);
      s.position.set(x * 1.2, y * 1.2, zz * 1.2);
      s.lookAt(x * 5, y * 5, zz * 5); s.rotateX(Math.PI / 2);
      g.add(s);
    }
    const eye = glowSprite(0xff3020, 3.4, 3.2);
    g.add(eye);
    this.scene.add(g);
    this.objs.push({ type: 'mine', z, group: g, pos: g.position, eye, hp: 1, r: 1.9, ph: rand(0, 6.28), homing: P.homing, target: true, score: 150 });
  }

  spawnPickup(z) {
    const g = new THREE.Group();
    g.position.set(rand(-6, 6), rand(7, TH - 12), z);
    const c = new THREE.Mesh(this.geos.octa, this.mats.pickup);
    g.add(c);
    const ring = new THREE.Mesh(this.geos.ring, this.mats.pickup);
    g.add(ring);
    g.add(glowSprite(0x40ffe0, 7, 1.6));
    this.scene.add(g);
    this.objs.push({ type: 'pickup', z, group: g, pos: g.position, core: c, ring });
  }

  spawnGate(z, n) {
    const g = new THREE.Group();
    g.position.z = z;
    const add = (x, y, sx, sy) => { const m = new THREE.Mesh(this.box, this.mats.cyan); m.position.set(x, y, 0); m.scale.set(sx, sy, 0.4); g.add(m); };
    add(-HW + 0.3, TH / 2, 0.5, TH); add(HW - 0.3, TH / 2, 0.5, TH); add(0, 0.3, HW * 2, 0.5);
    add(0, TH + 0.6, HW * 2 + 4, 0.5);
    for (let i = 0; i < 6; i++) add(0, (TH / 6) * i + 3, HW * 2, 0.06);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, TH),
      new THREE.MeshBasicMaterial({ map: this.gateTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    curtain.position.y = TH / 2;
    g.add(curtain);
    this.scene.add(g);
    this.objs.push({ type: 'gate', z, n, group: g, curtain });
  }

  // ---------------------------------------------------------------- object updates
  updateObjects(dt, live, prevZ) {
    const s = this.ship.position;
    const zFront = s.z - SHD, zBack = (prevZ ?? s.z) + SHD;
    for (let i = this.objs.length - 1; i >= 0; i--) {
      const o = this.objs[i];
      const dz = s.z - o.z; // >0 → object ahead
      if (dz < -60) { this.scene.remove(o.group); this.objs.splice(i, 1); if (this.lock === o) this.lock = null; continue; }

      if (o.rects) {
        if (o.move) {
          const m = o.move, off = Math.sin(this.time * m.w + m.ph) * m.amp;
          o.rects.forEach((r, k) => {
            const b = o.base[k];
            if (m.vertical) { r.y0 = b.y0 + off; r.y1 = b.y1 + off; }
            else { r.x0 = b.x0 + off; r.x1 = b.x1 + off; }
            this.fitRect(o.meshes[k], r, o.depth);
          });
          if (m.vertical) o.strips.position.y = off; else o.strips.position.x = off;
          o.blink.position.y = clamp(o.rects[0].y1, 0, TH); o.blink.position.x = clamp((o.rects[0].x0 + o.rects[0].x1) / 2, -HW + 1, HW - 1);
        }
        o.blink.material.opacity = (Math.sin(this.time * 9 + o.z) > 0) ? 1 : 0.25;
        if (!live) continue;
        if (zFront <= o.z && zBack >= o.z - o.depth && !o.hitDone) {
          for (const r of o.rects) {
            const dx = Math.max(r.x0 - (s.x + SHW), (s.x - SHW) - r.x1, 0);
            const dy = Math.max(r.y0 - (s.y + SHH), (s.y - SHH) - r.y1, 0);
            if (dx === 0 && dy === 0) {
              o.hitDone = true;
              this.particles.emit(this.tmp.set(s.x, s.y, s.z - 1.5), { count: 70, speed: 30, c0: 0xffffff, c1: 0xff6a20, life: 0.6, size: 0.5, drag: 1.5, vel: this.tmp2.set(0, 0, -this.speed * 0.7) });
              this.damage(34, 'impact');
              break;
            }
            o.minClear = Math.min(o.minClear, Math.hypot(dx, dy));
          }
        }
        if (!o.passed && s.z + SHD < o.z - o.depth) {
          o.passed = true;
          if (!o.hitDone && o.minClear < 1.4 && this.state === 'playing') {
            this.combo++; this.closeCalls++;
            const pts = 100 * this.mult();
            this.score += pts;
            this.hud.callout(`CLOSE CALL +${pts}`, 'gold');
            this.sound.whoosh();
          }
        }
        continue;
      }

      switch (o.type) {
        case 'turret': {
          o.pivot.lookAt(s.x, s.y, s.z);
          o.eye.material.opacity = 0.6 + Math.sin(this.time * 12) * 0.4;
          if (live && dz > 55 && dz < 380) {
            o.cd -= dt;
            if (o.cd <= 0) { o.cd = o.rate * rand(0.75, 1.3); this.fireEnemy(o); }
          }
          break;
        }
        case 'mine': {
          o.group.rotation.x += dt * 1.3; o.group.rotation.y += dt * 0.9;
          o.eye.scale.setScalar(3 + Math.sin(this.time * 10 + o.ph) * 1.2);
          if (dz > 0 && dz < 170) {
            o.pos.x += clamp(s.x - o.pos.x, -1, 1) * o.homing * dt;
            o.pos.y += clamp(s.y - o.pos.y, -1, 1) * o.homing * dt;
          }
          o.pos.y += Math.sin(this.time * 2 + o.ph) * dt * 1.5;
          if (live && Math.abs(o.pos.z - s.z) < 2.4 && Math.abs(o.pos.x - s.x) < SHW + 0.9 && Math.abs(o.pos.y - s.y) < SHH + 1.0) {
            this.destroyTarget(o, i, false);
            this.damage(26, 'mine');
          }
          break;
        }
        case 'pickup': {
          o.core.rotation.y += dt * 2; o.ring.rotation.x += dt * 1.4; o.ring.rotation.y += dt * 0.8;
          if (live && this.tmp.copy(o.pos).sub(s).length() < 3.4) {
            this.scene.remove(o.group); this.objs.splice(i, 1);
            this.shield = Math.min(100, this.shield + 30);
            this.sound.pickup();
            this.hud.callout('SHIELD +30', 'cyan');
            this.particles.emit(o.pos, { count: 50, speed: 18, c0: 0xffffff, c1: 0x20ffd0, life: 0.6, size: 0.6 });
          }
          break;
        }
        case 'gate': {
          o.curtain.material.map.offset.y = (this.time * 0.6) % 1;
          if (live && !o.passed && s.z < o.z) { o.passed = true; this.onGate(o); }
          break;
        }
      }
    }
  }

  onGate(o) {
    const n = o.n;
    const bonus = 1000 * n;
    this.score += bonus;
    this.shield = Math.min(100, this.shield + 25);
    this.sector = n + 1;
    this.trench.setAccent(ACCENTS[(this.sector - 1) % ACCENTS.length]);
    const info = sectorInfo(this.sector);
    this.hud.banner(`SECTOR ${pad2(n)} CLEAR · +${bonus.toLocaleString()}`, `SECTOR ${pad2(this.sector)} · ${info.name}`, info.tip);
    this.sound.gate();
    this.sound.startMusic(this.sector);
    this.flash.setRGB(0.15, 0.5, 0.6);
    this.fovKick = 10;
    this.hud.sectorUp(this.sector);
  }

  damage(amount, kind) {
    if (this.invuln > 0 || this.state !== 'playing') return;
    this.shield -= amount * this.diff.dmg;
    this.invuln = 1.1;
    this.combo = 0;
    this.shake = Math.max(this.shake, 1);
    this.aberr = 0.014;
    this.flash.setRGB(0.7, 0.08, 0.02);
    this.sound.hit();
    this.hud.damage(kind);
    if (navigator.vibrate) try { navigator.vibrate(60); } catch { /* noop */ }
    if (this.shield <= 0) { this.shield = 0; this.die(); }
  }

  die() {
    const s = this.ship.position;
    this.explode(s.clone(), 2.6, 0xff7a20);
    this.ship.visible = false;
    this.state = 'dying';
    this.dieT = 0;
    this.shake = 1.6;
    this.sound.stopMusic();
    this.hud.update({ score: Math.floor(this.score), mult: 1, speed: 0, shield: 0, progress: 0, sector: this.sector, sectorName: sectorInfo(this.sector).name });
    if (navigator.vibrate) try { navigator.vibrate([90, 40, 160]); } catch { /* noop */ }
  }

  stats() {
    return {
      score: Math.floor(this.score), sector: this.sector, kills: this.kills, closeCalls: this.closeCalls,
      distance: Math.floor(this.distance), difficulty: this.diffKey,
    };
  }

  // ---------------------------------------------------------------- weapons
  findLock() {
    const s = this.ship.position;
    let best = null, bestScore = 1;
    for (const o of this.objs) {
      if (!o.target || o.dead) continue;
      const dz = s.z - o.pos.z;
      if (dz < 20 || dz > 400) continue;
      const cone = 4 + dz * 0.13;
      const sc = Math.hypot(o.pos.x - s.x, o.pos.y - s.y) / cone + dz / 2000;
      if (sc < bestScore) { bestScore = sc; best = o; }
    }
    this.lock = best;
  }

  getBolt(kind) {
    const pool = this.boltPool[kind];
    let b = pool.pop();
    if (!b) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.geos.boltCore, kind === 'p' ? this.boltMats.pCore : this.boltMats.eCore));
      g.add(new THREE.Mesh(this.geos.boltGlow, kind === 'p' ? this.boltMats.pGlow : this.boltMats.eGlow));
      b = { kind, mesh: g, pos: g.position, vel: new THREE.Vector3(), prev: new THREE.Vector3(), life: 0 };
    }
    this.scene.add(b.mesh);
    return b;
  }

  releaseBolt(b) { this.scene.remove(b.mesh); this.boltPool[b.kind].push(b); }

  firePlayer() {
    this.fireCd = 0.13;
    this.fireSide = -this.fireSide;
    const body = this.ship.userData.body;
    this.ship.updateMatrixWorld();
    const origin = body.localToWorld(this.tmp.set(this.fireSide * CANNON_X, -0.2, -2.6)).clone();
    const s = this.ship.position;
    const speed = 720 + this.speed;
    const dir = new THREE.Vector3();
    if (this.lock) {
      // targeting computer: bolts converge on the locked target
      const T = this.lock.pos;
      dir.set(T.x - origin.x, T.y - origin.y, T.z - origin.z).normalize();
    } else dir.set(s.x - origin.x, s.y - origin.y, -170).normalize();
    const b = this.getBolt('p');
    b.pos.copy(origin); b.prev.copy(origin);
    b.vel.copy(dir).multiplyScalar(speed);
    b.life = 0.7;
    b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    b.mesh.scale.set(1, 1, 7);
    this.bolts.push(b);
    this.particles.emit(origin, { count: 6, speed: 6, c0: 0xffffff, c1: 0xff3010, life: 0.12, size: 0.8, vel: this.tmp2.set(0, 0, -this.speed) });
    this.sound.laser();
  }

  fireEnemy(o) {
    const s = this.ship.position;
    const T = o.group.localToWorld(this.tmp.set(-Math.sign(o.pos.x) * 1.2, 0, 0)).clone();
    // intercept: |D + Vs t| = bs t
    const v = this.speed, bs = o.boltSpeed;
    const D = new THREE.Vector3().subVectors(s, T);
    const a = v * v - bs * bs, bq = -2 * D.z * v, c = D.lengthSq();
    let t;
    if (Math.abs(a) < 1e-3) t = -c / bq;
    else {
      const disc = bq * bq - 4 * a * c;
      if (disc < 0) return;
      const r1 = (-bq - Math.sqrt(disc)) / (2 * a), r2 = (-bq + Math.sqrt(disc)) / (2 * a);
      t = Math.min(...[r1, r2].filter(x => x > 0));
    }
    if (!isFinite(t) || t <= 0) return;
    const aimErr = 1.6;
    const aim = new THREE.Vector3(s.x + rand(-aimErr, aimErr), s.y + rand(-aimErr, aimErr) * 0.6, s.z - v * t);
    const dir = aim.sub(T).normalize();
    const b = this.getBolt('e');
    b.pos.copy(T); b.prev.copy(T);
    b.vel.copy(dir).multiplyScalar(bs);
    b.life = 4;
    b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    b.mesh.scale.set(1.2, 1.2, 5);
    this.ebolts.push(b);
    this.particles.emit(T, { count: 8, speed: 8, c0: 0xffffff, c1: 0x30ff40, life: 0.2, size: 0.9 });
    if (s.z - o.pos.z < 300) this.sound.enemyLaser();
  }

  updateBolts(dt) {
    const s = this.ship.position;
    // player bolts
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let dead = b.life <= 0;
      if (!dead && (b.pos.y < 0.2 || Math.abs(b.pos.x) > HW - 0.4)) { dead = true; this.spark(b.pos); }
      if (!dead) {
        for (let j = this.objs.length - 1; j >= 0; j--) {
          const o = this.objs[j];
          if (o.target && !o.dead) {
            if (segDist(b.prev, b.pos, o.pos) < o.r) {
              dead = true;
              o.hp--;
              this.particles.emit(b.pos, { count: 14, speed: 14, c0: 0xffffff, c1: 0xff5020, life: 0.3, size: 0.5 });
              if (o.hp <= 0) this.destroyTarget(o, j, true); else this.sound.spark();
              break;
            }
          } else if (o.rects) {
            const zMin = Math.min(b.prev.z, b.pos.z), zMax = Math.max(b.prev.z, b.pos.z);
            if (zMin <= o.z && zMax >= o.z - o.depth) {
              const hit = o.rects.some(r => b.pos.x > r.x0 && b.pos.x < r.x1 && b.pos.y > r.y0 && b.pos.y < r.y1);
              if (hit) { dead = true; this.spark(this.tmp.set(b.pos.x, b.pos.y, o.z + 0.2)); break; }
            }
          }
        }
      }
      if (dead) { this.releaseBolt(b); this.bolts.splice(i, 1); }
    }
    // enemy bolts
    const live = this.state === 'playing';
    for (let i = this.ebolts.length - 1; i >= 0; i--) {
      const b = this.ebolts[i];
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let dead = b.life <= 0 || b.pos.z > s.z + 30 || b.pos.y < 0;
      if (!dead && live && this.ship.visible) {
        const c = closestOnSeg(b.prev, b.pos, s, this.tmp);
        if (Math.abs(c.x - s.x) < SHW * 0.85 && Math.abs(c.y - s.y) < SHH + 0.35 && Math.abs(c.z - s.z) < SHD) {
          dead = true;
          this.particles.emit(c, { count: 30, speed: 20, c0: 0xffffff, c1: 0x40ff60, life: 0.4, size: 0.5, vel: this.tmp2.set(0, 0, -this.speed * 0.8) });
          this.damage(15, 'bolt');
        }
      }
      if (dead) { this.releaseBolt(b); this.ebolts.splice(i, 1); }
    }
  }

  destroyTarget(o, index, byPlayer) {
    o.dead = true;
    this.scene.remove(o.group);
    this.objs.splice(index, 1);
    if (this.lock === o) this.lock = null;
    this.explode(o.pos.clone(), o.type === 'turret' ? 1.4 : 1.1, o.type === 'turret' ? 0xff8030 : 0xff4020);
    if (byPlayer) {
      this.kills++;
      this.combo++;
      const pts = o.score * this.mult();
      this.score += pts;
      this.hud.callout(`${o.type === 'turret' ? 'TURRET' : 'MINE'} +${pts}`, 'red');
    }
  }

  spark(p) {
    this.particles.emit(p, { count: 10, speed: 12, c0: 0xffffff, c1: 0xffa040, life: 0.25, size: 0.4, drag: 1, grav: 20 });
  }

  explode(pos, size = 1, color = 0xffa040) {
    const p = this.particles;
    p.emit(pos, { count: Math.round(70 * size), speed: 22 * size, c0: 0xfff0c0, c1: color, life: 0.9, size: 1.5 * size, drag: 2.6, bright: 3.5, jitter: size });
    p.emit(pos, { count: Math.round(40 * size), speed: 70 * size, c0: 0xffffff, c1: 0xff5010, life: 0.55, size: 0.35, drag: 1.2, bright: 5 });
    p.emit(pos, { count: Math.round(20 * size), speed: 6, c0: 0xffffff, c1: color, life: 0.35, size: 3.5 * size, drag: 3, bright: 2 });
    this.boomLight.position.copy(pos);
    this.boomLight.intensity = 2500 * size;
    for (let i = 0; i < Math.round(6 * size); i++) {
      const m = new THREE.Mesh(this.box, this.mats.dark);
      m.scale.set(rand(0.2, 0.7), rand(0.2, 0.5), rand(0.2, 0.9));
      m.position.copy(pos);
      this.scene.add(m);
      this.debris.push({ mesh: m, vel: new THREE.Vector3(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)).multiplyScalar(22 * size), spin: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)), life: rand(1, 1.8) });
    }
    const d = Math.abs(pos.z - this.ship.position.z);
    this.shake = Math.max(this.shake, clamp(1.2 - d / 120, 0, 1) * size * 0.5);
    this.sound.explosion(size);
  }

  updateDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vel.y -= 18 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      if (d.mesh.position.y < 0.2) { d.mesh.position.y = 0.2; d.vel.y *= -0.4; d.vel.x *= 0.7; d.vel.z *= 0.7; }
      if (d.life <= 0) { this.scene.remove(d.mesh); this.debris.splice(i, 1); }
    }
    this.boomLight.intensity *= Math.exp(-dt * 7);
  }

  // ---------------------------------------------------------------- camera + render
  updateCamera(dt) {
    const s = this.ship.position;
    const cam = this.camera;
    const body = this.ship.userData.body;
    this.roll = damp(this.roll, -this.vx * 0.042, 8, dt);
    this.pitch = damp(this.pitch, this.vy * 0.018, 8, dt);
    body.rotation.set(this.pitch, -this.vx * 0.006, this.roll);
    for (const g of this.ship.userData.glows) g.scale.setScalar(1.1 + Math.random() * 0.35 + this.speed / 600);

    const menu = this.state === 'menu';
    const tx = s.x * 0.7, ty = s.y + (menu ? 2.6 : 3.3);
    cam.position.x = damp(cam.position.x, tx, 6, dt);
    cam.position.y = damp(cam.position.y, ty, 6, dt);
    cam.position.z = s.z + (menu ? 11 : 13);
    this.look.set(s.x * 0.55, s.y + 0.9, s.z - 40);
    cam.lookAt(this.look);
    cam.rotateZ(this.roll * 0.3);
    if (this.shake > 0.001) {
      const k = this.shake * 0.5;
      cam.position.x += rand(-k, k); cam.position.y += rand(-k, k);
      cam.rotateZ(rand(-k, k) * 0.03);
      this.shake *= Math.exp(-dt * 5);
    }
    const sp = clamp((this.speed - 60) / 180, 0, 1);
    this.fovKick *= Math.exp(-dt * 2.5);
    const fov = this.baseFov + sp * 9 + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }

    // lights + sky follow
    this.shipLight.position.set(s.x, s.y, s.z + 2.8);
    this.shipLight.intensity = this.ship.visible ? 32 + Math.random() * 10 : 0;
    this.sun.position.set(s.x + 150, s.y + 260, s.z - 30);
    this.sun.target.position.set(0, 0, s.z - 110);
    this.stars.position.copy(cam.position);
    this.moon.position.copy(cam.position).add(this.moonOffset);

    // speed lines
    const arr = this.lines.geometry.attributes.position.array;
    const len = 1 + this.speed * 0.06;
    this.lineData.forEach((l, i) => {
      if (l.z > cam.position.z + 2 || l.z < cam.position.z - 420) {
        l.z = cam.position.z - rand(60, 400); l.x = rand(-HW + 0.6, HW - 0.6); l.y = rand(0.5, TH);
      }
      arr.set([l.x, l.y, l.z, l.x, l.y, l.z + len], i * 6);
    });
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.material.opacity = 0.12 + sp * 0.4;

    this.trench.update(cam.position.z);

    // HUD projections
    if (this.state === 'playing') {
      const p = this.tmp.set(s.x, s.y, s.z - 70).project(cam);
      this.hud.reticle(p.x, p.y, true);
      if (this.lock) { const q = this.tmp2.copy(this.lock.pos).project(cam); this.hud.lock(q.x, q.y, q.z < 1); }
      else this.hud.lock(0, 0, false);
    } else { this.hud.reticle(0, 0, false); this.hud.lock(0, 0, false); }

    // post params
    const u = this.post.mat.uniforms;
    const c = this.tmp.set(s.x * 0.55, s.y + 0.9, s.z - 300).project(cam);
    u.uCenter.value.set(c.x * 0.5 + 0.5, c.y * 0.5 + 0.5);
    u.uBlur.value = this.settings.blur ? 0.02 + sp * 0.075 : 0;
    this.aberr *= Math.exp(-dt * 4);
    u.uAberr.value = this.aberr;
    u.uTime.value = this.time;
    this.flash.multiplyScalar(Math.exp(-dt * 5));
    u.uFlash.value.copy(this.flash);

    this.particles.setScale((this.renderer.domElement.height) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)));
  }

  render() {
    if (this.usePost) this.post.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }
}

// ---------------------------------------------------------------- helpers
function closestOnSeg(a, b, p, out) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz || 1;
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2, 0, 1);
  return out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
}
const _c = new THREE.Vector3();
function segDist(a, b, p) { return closestOnSeg(a, b, p, _c).distanceTo(p); }
