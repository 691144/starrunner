// STARRUNNER core: a winding, narrowing canyon flown at ever-increasing speed.
import * as THREE from 'three';
import { Trench } from './trench.js';
import { Course, HW, TH, LAT, VERT, SHIP_W, SHIP_W_BANK, SHIP_H, speedAt, sectorLength, bendMaterial, bendDepthMaterial } from './course.js';
import { Particles, PostFX, glowSprite } from './fx.js';
import { buildShip } from './ship.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const pad2 = n => String(n).padStart(2, '0');

export const SECTORS = [
  { name: 'OUTER CHANNEL', tip: 'Follow the canyon. Climb over the raised floor.' },
  { name: 'SWEEPING BENDS', tip: 'Tunnels ahead. Stay low and keep your line.' },
  { name: 'THE NARROWS', tip: 'Gaps too narrow for your wings: hold click to turn sideways.' },
  { name: 'SERPENTINE', tip: 'Tight S-bends at speed. Smooth inputs win.' },
  { name: 'THE SQUEEZE', tip: 'The ceiling drops. Mind your height.' },
  { name: 'HYPERLANE', tip: 'The canyon barely keeps up with you.' },
  { name: 'DEEP CORE', tip: 'No margin for error.' },
];
export function sectorInfo(n) {
  if (n <= SECTORS.length) return SECTORS[n - 1];
  return { name: `DEEP CORE · LAYER ${n - SECTORS.length + 1}`, tip: 'Faster. Narrower. Keep going.' };
}

// speed: velocity multiplier · dmg: scrape damage · frac: how hard the bends push the ship's turn rate · narrow: how fast the canyon closes
export const DIFFS = {
  cadet: { label: 'CADET', speed: 0.86, dmg: 0.6, frac: 0.8, narrow: 0.75 },
  pilot: { label: 'PILOT', speed: 1.0, dmg: 1.0, frac: 1.0, narrow: 1.0 },
  ace: { label: 'ACE', speed: 1.15, dmg: 1.4, frac: 1.12, narrow: 1.2 },
};

const ACCENTS = [0xffb347, 0x59d8ff, 0xff5a4a, 0x9dff6a, 0xd48cff, 0xfff27a, 0xff7ad9, 0x7affe4];
const RADAR_N = 30, RADAR_STEP = 11;

export class Game {
  constructor(canvas, sound, input, hud) {
    this.sound = sound;
    this.input = input;
    this.hud = hud;
    this.state = 'menu';
    this.time = 0;
    this.diffKey = 'pilot';
    this.diff = DIFFS.pilot;
    this.settings = { quality: 'high', blur: true, invertY: false };

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

    this.course = new Course();
    this.course.reset(0, 1.4);
    this.trench = new Trench(scene, this.course);
    this.buildSky();
    this.buildSpeedLines();

    this.ship = buildShip();
    scene.add(this.ship);
    this.particles = new Particles(scene);

    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.55 });
    this.cyanMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.9, 1).multiplyScalar(3) });
    // tunnel roofs use their own bend mapping (slab hangs from the rim down to the tunnel underside)
    this.roofMat = bendMaterial(new THREE.MeshStandardMaterial({ map: this.trench.greebleTex, color: 0x9aa0a8, roughness: 0.8, metalness: 0.3 }), this.course, 'roof');
    this.roofLightMat = bendMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.7, 0.3).multiplyScalar(3) }), this.course, 'roof');
    this.roofDepth = bendDepthMaterial(this.course, 'roof');
    this.stripGeoCache = new Map();
    this.gateTex = this.makeGateTexture();

    this.objs = [];
    this.roofs = [];
    this.debris = [];

    this.speed = 70;
    this.vx = this.vy = 0;
    this.roll = this.pitch = this.yaw = 0;
    this.shake = 0;
    this.aberr = 0;
    this.flash = new THREE.Color(0, 0, 0);
    this.fovKick = 0;
    this.edge = [0, 0, 0, 0];
    this.bank = 0;
    this.lim = {};
    this.promptKind = null;
    this.maxMult = 1;
    this.radarT = 0;
    this.radar = {
      n: RADAR_N, step: RADAR_STEP,
      lft: new Float32Array(RADAR_N), rgt: new Float32Array(RADAR_N), flo: new Float32Array(RADAR_N), cei: new Float32Array(RADAR_N),
      shipY: 0,
    };
    this.c1 = {}; this.c2 = {}; this.c3 = {};
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.look = new THREE.Vector3();

    this.placeShip(0);
    this.snapCamera();
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
    for (let i = 0; i < n; i++) this.lineData.push({ x: 0, y: 0, z: 1e9 });
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
  placeShip(z) {
    const c = this.course.at(z, this.c1);
    this.ship.position.set(c.x, c.y + 14, z);
    this.vx = this.vy = 0;
  }

  snapCamera() {
    const s = this.ship.position;
    this.camera.position.set(s.x, s.y + 3.3, s.z + 13);
    this.updateCamera(0.0001);
  }

  start(diffKey) {
    this.clearWorld();
    this.diffKey = diffKey;
    this.diff = DIFFS[diffKey] || DIFFS.pilot;
    this.course.reset(0, 0, this.diff.speed, this.diff.frac, this.diff.narrow);
    this.trench.placeAt(0);
    this.placeShip(0);
    this.speed = 80;
    this.state = 'playing';
    this.score = 0;
    this.shield = 100;
    this.combo = 0;
    this.cleared = 0;
    this.maxMult = 1;
    this.bank = 0;
    this.promptKind = null;
    this.sector = 1;
    this.invuln = 2.0;
    this.distance = 0;
    this.cleanT = 0;
    this.scrapeSfxT = 0;
    this.wasScraping = false;
    this.secStart = 0;
    this.secEnd = -sectorLength(1);
    this.gateN = 1;
    this.gateZ = this.secEnd;
    this.gateSpawned = false;
    this.lineData.forEach(l => { l.z = 1e9; });
    this.ship.visible = true;
    this.setAccent(ACCENTS[0]);
    this.particles.clear();
    this.snapCamera();
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
    this.course.reset(this.ship.position.z, 1.4);
    this.placeShip(this.ship.position.z);
    this.state = 'menu';
    this.ship.visible = true;
    this.setAccent(ACCENTS[0]);
    this.hud.edges([0, 0, 0, 0]);
    this.sound.stopMusic();
  }

  setAccent(hex) {
    this.trench.setAccent(hex);
    this.roofLightMat.color.set(hex).multiplyScalar(3);
  }

  clearWorld() {
    for (const m of this.roofs || []) this.disposeRoof(m);
    this.roofs = [];
    this.hud.prompt(null);
    for (const o of this.objs) this.disposeObj(o);
    this.objs.length = 0;
    for (const d of this.debris) this.scene.remove(d.mesh);
    this.debris.length = 0;
  }

  disposeObj(o) {
    this.scene.remove(o.group);
    if (o.mat) o.mat.dispose();
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
      this.updateDebris(dt);
      this.particles.update(dt);
    }
    this.updateCamera(this.state === 'paused' ? 0 : dt);
    this.render();
  }

  // integrate lateral/vertical flight from a command in [-1, 1]
  steer(ux, uy, dt) {
    const s = this.ship.position;
    this.vx = damp(this.vx, ux * LAT, 9, dt);
    this.vy = damp(this.vy, uy * VERT, 9, dt);
    s.x += this.vx * dt;
    s.y += this.vy * dt;
  }

  // the ship's current extents (wings level -> knife-edge when banked)
  extents() {
    const b = this.bank;
    return { w: SHIP_W + (SHIP_W_BANK - SHIP_W) * b, h: SHIP_H + (SHIP_W - SHIP_H) * b };
  }

  // menu / death / game-over backdrop: the ship flies the course by itself
  updateCruise(dt) {
    const s = this.ship.position;
    const c = this.course;
    c.sync(s.z);
    const here = c.at(s.z, this.c1);
    const ahead = c.at(s.z - this.speed * 0.4, this.c2);
    const far = c.at(s.z - this.speed * 0.9, this.c3);
    // bank when a pinch is coming: the corridor is narrower than the ship
    const tight = Math.min(here.rw - here.lw, ahead.rw - ahead.lw, far.rw - far.lw) < 2 * SHIP_W + 1.4;
    this.bank = damp(this.bank, tight ? 1 : 0, 14, dt);
    const ex = this.extents();
    const L = c.limits(ahead, ex.w, ex.h, this.lim);
    const tx = (L.l + L.r) / 2, ty = clamp(here.floor + 13 + Math.sin(this.time * 0.6) * 4, L.lo, L.hi);
    this.steer(clamp((tx - s.x) * 2.4 / LAT, -1, 1), clamp((ty - s.y) * 2.4 / VERT, -1, 1), dt);
    this.speed = damp(this.speed, this.state === 'menu' ? 74 : 46, 1.2, dt);
    s.z -= this.speed * dt;
    const hc = c.at(s.z, this.c1);
    this.clampToCanyon(hc);
    this.updateObjects(dt, false, s.z);
    this.updateFeatures(false);
    if (this.state === 'dying') {
      this.dieT += dt;
      if (this.dieT > 2.4) { this.state = 'over'; this.hud.gameOver(this.stats()); }
    }
    this.sound.engine(this.speed / 240, this.state === 'menu' || this.ship.visible ? 0.6 : 0.15);
  }

  updatePlay(dt) {
    const s = this.ship.position;
    const c = this.course;
    c.sync(s.z);
    const d = c.dAtZ(s.z);

    // ---- flight
    const st = this.input.steer(this.settings.invertY);
    const held = this.input.bank();
    if (held && this.bank < 0.1) this.sound.whoosh();
    this.bank = damp(this.bank, held ? 1 : 0, 13, dt);
    this.steer(st.x, st.y, dt);
    this.speed = damp(this.speed, speedAt(d) * this.diff.speed, 1.6, dt);
    s.z -= this.speed * dt;
    this.distance += this.speed * dt;
    this.invuln = Math.max(0, this.invuln - dt);

    // ---- canyon contact
    const cc = c.at(s.z, this.c1);
    this.contact(dt, cc);

    const mult = this.mult();
    if (mult > this.maxMult) this.maxMult = mult;
    this.score += this.speed * dt * 0.1 * mult;
    this.cleanT += dt;
    if (this.cleanT >= 4) {
      this.cleanT -= 4;
      this.combo++;
    }

    this.spawnAhead();
    this.updateObjects(dt, true, s.z);
    this.updateFeatures(true);

    if (this.shield < 30 && this.state === 'playing') {
      this.alarmT = (this.alarmT || 0) - dt;
      if (this.alarmT <= 0) { this.sound.alarm(); this.alarmT = 1.4; }
    }

    const prog = clamp((this.secStart - s.z) / (this.secStart - this.secEnd), 0, 1);
    this.hud.update({
      score: Math.floor(this.score), mult, speed: Math.round(this.speed * 4.2), shield: this.shield,
      progress: prog, sector: this.sector, sectorName: sectorInfo(this.sector).name, invuln: this.invuln > 0,
    });
    this.updateRadar(dt);
    this.sound.engine(this.speed / 240, 0.6);
  }

  mult() { return 1 + Math.min(7, Math.floor(this.combo / 4)); }

  // ---------------------------------------------------------------- canyon collision
  // keep the ship inside the flyable corridor; returns which surfaces it is touching
  clampToCanyon(c) {
    const s = this.ship.position;
    const ex = this.extents();
    const L = this.course.limits(c, ex.w, ex.h, this.lim);
    let hitX = 0, hitY = 0;
    if (s.x > L.r) { s.x = L.r; hitX = 1; if (this.vx > 0) this.vx = -this.vx * 0.25; }
    else if (s.x < L.l) { s.x = L.l; hitX = -1; if (this.vx < 0) this.vx = -this.vx * 0.25; }
    if (s.y < L.lo) { s.y = L.lo; hitY = -1; if (this.vy < 0) this.vy = -this.vy * 0.2; }
    else if (s.y > L.hi) { s.y = L.hi; hitY = 1; if (this.vy > 0) this.vy = -this.vy * 0.2; }
    // a squeeze means the ship physically cannot fit: that is always a scrape
    if (L.sqX && !hitX) hitX = s.x >= c.x + (c.lw + c.rw) / 2 ? 1 : -1;
    if (L.sqY && !hitY) hitY = 1;
    return { hitX, hitY, L };
  }

  contact(dt, c) {
    const s = this.ship.position;
    const { hitX, hitY, L } = this.clampToCanyon(c);

    // proximity warning (0..1 per edge: left, right, top, bottom)
    // (scaled to the corridor so a deliberately tight gap doesn't keep the screen glowing red)
    const mx = clamp((L.r - L.l) * 0.3, 0.7, 3.0), my = clamp((L.hi - L.lo) * 0.3, 0.7, 3.0);
    this.edge[0] = clamp(1 - (s.x - L.l) / mx, 0, 1) * 0.8;
    this.edge[1] = clamp(1 - (L.r - s.x) / mx, 0, 1) * 0.8;
    this.edge[2] = clamp(1 - (L.hi - s.y) / my, 0, 1) * 0.8;
    this.edge[3] = clamp(1 - (s.y - L.lo) / my, 0, 1) * 0.8;
    this.hud.edges(this.edge);

    const scraping = !!(hitX || hitY);
    if (scraping) {
      this.cleanT = 0;
      this.combo = 0;
      this.scrapedNow = true;
      if (this.invuln <= 0) {
        if (!this.wasScraping) this.damage(7, 'impact');
        // forcing a ship through a gap it physically can't fit is far worse than brushing a wall
        this.shield -= ((L.sqX || L.sqY) ? 110 : 30) * dt * this.diff.dmg;
        this.shake = Math.max(this.shake, 0.45);
        this.aberr = Math.max(this.aberr, 0.007);
        if (this.shield <= 0) { this.shield = 0; this.die(); return; }
      }
      this.scrapeSfxT -= dt;
      if (this.scrapeSfxT <= 0) { this.sound.spark(); this.scrapeSfxT = 0.07; }
      const ex = this.extents();
      const p = this.tmp.set(s.x + hitX * (ex.w + 0.2), s.y + hitY * (ex.h + 0.1), s.z - 1.2);
      this.particles.emit(p, {
        count: 5, speed: 16, c0: 0xffffff, c1: 0xff7a20, life: 0.4, size: 0.5, drag: 1.2, grav: 18,
        vel: this.tmp2.set(-hitX * 6, -hitY * 4, -this.speed * 0.35),
      });
    }
    this.wasScraping = scraping;
  }

  damage(amount) {
    if (this.invuln > 0 || this.state !== 'playing') return;
    this.shield -= amount * this.diff.dmg;
    this.combo = 0;
    this.shake = Math.max(this.shake, 1);
    this.aberr = 0.014;
    this.flash.setRGB(0.28, 0.04, 0.01);
    this.sound.hit();
    this.hud.damage();
    if (navigator.vibrate) try { navigator.vibrate(50); } catch { /* noop */ }
    if (this.shield <= 0) { this.shield = 0; this.die(); }
  }

  die() {
    if (this.state !== 'playing') return;
    this.explode(this.ship.position.clone(), 2.6, 0xff7a20);
    this.ship.visible = false;
    this.state = 'dying';
    this.dieT = 0;
    this.shake = 1.6;
    this.sound.stopMusic();
    this.hud.edges([0, 0, 0, 0]);
    this.hud.update({ score: Math.floor(this.score), mult: 1, speed: 0, shield: 0, progress: 0, sector: this.sector, sectorName: sectorInfo(this.sector).name });
    if (navigator.vibrate) try { navigator.vibrate([90, 40, 160]); } catch { /* noop */ }
  }

  stats() {
    return { score: Math.floor(this.score), sector: this.sector, cleared: this.cleared, maxMult: this.maxMult, distance: Math.floor(this.distance), difficulty: this.diffKey };
  }

  // ---------------------------------------------------------------- gates, features, tunnel roofs
  spawnAhead() {
    const s = this.ship.position;
    const horizon = s.z - 560;
    if (!this.gateSpawned && this.gateZ > horizon) { this.gateSpawned = true; this.spawnGate(this.gateZ, this.gateN); }
  }

  spawnGate(z, n) {
    const c = this.course.at(z, this.c1);
    const g = new THREE.Group();
    const add = (x, y, sx, sy) => { const m = new THREE.Mesh(this.box, this.cyanMat); m.position.set(x, y, 0); m.scale.set(sx, sy, 0.4); g.add(m); };
    add(-HW + 0.3, TH / 2, 0.5, TH); add(HW - 0.3, TH / 2, 0.5, TH); add(0, 0.3, HW * 2, 0.5);
    add(0, TH + 0.6, HW * 2 + 4, 0.5);
    for (let i = 0; i < 6; i++) add(0, (TH / 6) * i + 3, HW * 2, 0.06);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, TH),
      new THREE.MeshBasicMaterial({ map: this.gateTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    curtain.position.y = TH / 2;
    g.add(curtain);
    g.position.set(c.x, c.y, z);
    g.scale.set(c.sx, c.sy, 1);
    g.rotation.y = Math.atan2(c.x - this.course.at(z - 6, this.c3).x, 6);
    this.scene.add(g);
    this.objs.push({ type: 'gate', z, n, group: g, curtain });
  }

  updateObjects(dt, live, prevZ) {
    const s = this.ship.position;
    for (let i = this.objs.length - 1; i >= 0; i--) {
      const o = this.objs[i];
      if (o.z > s.z + 70) { this.disposeObj(o); this.objs.splice(i, 1); continue; }
      if (o.type === 'gate') {
        o.curtain.material.map.offset.y = (this.time * 0.6) % 1;
        if (live && !o.passed && s.z < o.z) { o.passed = true; this.onGate(o); }
      }
    }
  }

  // roofs for tunnels, announcements, and scoring of cleared features
  updateFeatures(live) {
    const s = this.ship.position, c = this.course;
    for (let i = this.roofs.length - 1; i >= 0; i--) {
      if (this.roofs[i].ze > s.z + 220) { this.disposeRoof(this.roofs[i]); this.roofs.splice(i, 1); }
    }
    let next = null;
    for (const f of c.features) {
      const r = c.zRange(f);
      // build roofs as tunnels come into range
      if (f.type === 'tunnel' && !f.built && r.zs > s.z - 700) { f.built = true; this.buildRoof(f, r); }
      if (!live) continue;
      if (f.pass) continue;
      if (s.z < r.zs && s.z > r.ze) {
        if (this.scrapedNow) f.hit = true;
      } else if (s.z <= r.ze) {
        f.pass = true;
        if (!f.hit) this.featureCleared(f);
        continue;
      }
      if (!next && s.z > r.ze) { next = f; next._r = r; }
    }
    this.scrapedNow = false;

    // calm, steady prompt (no flashing) while a feature is approaching or underway
    let kind = null;
    if (live && next) {
      const lead = this.speed * 2.8;
      if (next._r.zs - s.z < lead) kind = next.type;
    }
    if (kind !== this.promptKind) { this.promptKind = kind; this.hud.prompt(kind); }
  }

  featureCleared(f) {
    this.cleared++;
    this.combo += f.type === 'pinch' ? 3 : 2;
    const base = { hump: 250, tunnel: 400, pinch: 600, shoulder: 250 }[f.type];
    const pts = base * this.mult() * Math.max(1, Math.ceil(this.sector / 2));
    this.score += pts;
    this.shield = Math.min(100, this.shield + 8);
    const label = { hump: 'CLEARED', tunnel: 'TUNNEL CLEARED', pinch: 'SIDEWAYS!', shoulder: 'CLEARED' }[f.type];
    this.hud.callout(`${label} +${pts}`, f.type === 'pinch' ? 'gold' : 'cyan');
    this.sound.pickup();
  }

  buildRoof(f, r) {
    const len = r.zs - r.ze;
    const segs = Math.max(2, Math.ceil(len / 5));
    const g = new THREE.BoxGeometry(2 * (HW + 30), 1, len, 1, 1, segs);
    g.translate(0, 0.5, 0);                        // local y in [0, 1]
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 26, uv.getY(i) * 6);
    const roof = new THREE.Mesh(g, this.roofMat);
    roof.position.z = (r.zs + r.ze) / 2;
    roof.castShadow = roof.receiveShadow = true;
    roof.customDepthMaterial = this.roofDepth;
    roof.frustumCulled = false;
    const grp = new THREE.Group();
    grp.add(roof);
    // light strips hanging under the roof
    const sg = new THREE.BoxGeometry(0.5, 0.3, len);
    sg.translate(0, -0.15, 0);
    for (const x of [-6, 0, 6]) {
      const m = new THREE.Mesh(sg, this.roofLightMat);
      m.position.set(x, 0, (r.zs + r.ze) / 2);
      m.frustumCulled = false;
      grp.add(m);
    }
    this.scene.add(grp);
    this.roofs.push({ grp, geos: [g, sg], ze: r.ze });
  }

  disposeRoof(m) {
    this.scene.remove(m.grp);
    m.geos.forEach(g => g.dispose());
  }

  onGate(o) {
    const n = o.n;
    const bonus = 1000 * n;
    this.score += bonus;
    this.shield = Math.min(100, this.shield + 25);
    this.sector = n + 1;
    this.gateN = n + 1;
    this.secStart = o.z;
    this.secEnd = o.z - sectorLength(n + 1);
    this.gateZ = this.secEnd;
    this.gateSpawned = false;
    this.setAccent(ACCENTS[(this.sector - 1) % ACCENTS.length]);
    const info = sectorInfo(this.sector);
    this.hud.banner(`SECTOR ${pad2(n)} CLEAR · +${bonus.toLocaleString()}`, `SECTOR ${pad2(this.sector)} · ${info.name}`, info.tip);
    this.sound.gate();
    this.sound.startMusic(this.sector);
    this.flash.setRGB(0.15, 0.5, 0.6);
    this.fovKick = 10;
  }

  // ---------------------------------------------------------------- radar (course preview for the HUD)
  updateRadar(dt) {
    this.radarT -= dt;
    if (this.radarT > 0) return;
    this.radarT = 1 / 24;
    const s = this.ship.position, R = this.radar, course = this.course;
    for (let i = 0; i < R.n; i++) {
      const t = course.at(s.z - i * R.step, this.c3);
      R.lft[i] = t.x + t.lw - s.x;
      R.rgt[i] = t.x + t.rw - s.x;
      R.flo[i] = t.floor;
      R.cei[i] = t.top;
    }
    R.shipY = s.y;
    this.hud.radar(R);
  }

  // ---------------------------------------------------------------- effects
  explode(pos, size = 1, color = 0xffa040) {
    const p = this.particles;
    p.emit(pos, { count: Math.round(70 * size), speed: 22 * size, c0: 0xfff0c0, c1: color, life: 0.9, size: 1.5 * size, drag: 2.6, bright: 3.5, jitter: size });
    p.emit(pos, { count: Math.round(40 * size), speed: 70 * size, c0: 0xffffff, c1: 0xff5010, life: 0.55, size: 0.35, drag: 1.2, bright: 5 });
    p.emit(pos, { count: Math.round(20 * size), speed: 6, c0: 0xffffff, c1: color, life: 0.35, size: 3.5 * size, drag: 3, bright: 2 });
    this.boomLight.position.copy(pos);
    this.boomLight.intensity = 2500 * size;
    for (let i = 0; i < Math.round(6 * size); i++) {
      const m = new THREE.Mesh(this.box, this.darkMat);
      m.scale.set(rand(0.2, 0.7), rand(0.2, 0.5), rand(0.2, 0.9));
      m.position.copy(pos);
      this.scene.add(m);
      this.debris.push({ mesh: m, vel: new THREE.Vector3(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)).multiplyScalar(22 * size).add(new THREE.Vector3(0, 0, -this.speed * 0.5)), spin: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)), life: rand(1, 1.8) });
    }
    this.sound.explosion(size);
  }

  updateDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vel.y -= 18 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      if (d.life <= 0) { this.scene.remove(d.mesh); this.debris.splice(i, 1); }
    }
    this.boomLight.intensity *= Math.exp(-dt * 7);
  }

  // ---------------------------------------------------------------- camera + render
  updateCamera(dt) {
    const s = this.ship.position;
    const cam = this.camera;
    const course = this.course;
    const body = this.ship.userData.body;
    const c = course.at(s.z, this.c1);
    const ca = course.at(s.z - 70, this.c2);

    this.roll = damp(this.roll, -this.vx * 0.042, 8, dt);
    const bankRoll = this.bank * Math.PI / 2;
    this.pitch = damp(this.pitch, this.vy * 0.018, 8, dt);
    this.yaw = damp(this.yaw, -Math.atan2(this.vx, Math.max(40, this.speed)) * 0.9, 8, dt);
    body.rotation.set(this.pitch, this.yaw, this.roll * (1 - this.bank) + bankRoll);
    for (const g of this.ship.userData.glows) g.scale.setScalar(1.1 + Math.random() * 0.35 + this.speed / 600);

    const menu = this.state === 'menu';
    cam.position.x = damp(cam.position.x, s.x + (c.x - s.x) * 0.2, 9, dt);
    cam.position.y = damp(cam.position.y, s.y + (menu ? 2.6 : 3.3), 8, dt);
    cam.position.z = s.z + (menu ? 11 : 13);
    {   // keep the camera inside the canyon: below tunnel roofs, above raised floors, between pinched walls
      const cz = course.at(cam.position.z, this.c3);
      cam.position.y = clamp(cam.position.y, cz.floor + 0.8, Math.max(cz.floor + 1.2, cz.top - 0.8));
      const hx = Math.max(0.2, (cz.rw - cz.lw) / 2 - 0.6);
      const mid = cz.x + (cz.lw + cz.rw) / 2;
      cam.position.x = clamp(cam.position.x, mid - hx, mid + hx);
    }
    this.look.set(s.x + (ca.x - s.x) * 0.75, s.y + 0.9 + (ca.y - c.y) * 0.55, s.z - 45);
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
    const tgt = course.at(s.z - 110, this.c3);
    this.sun.target.position.set(tgt.x, tgt.y, s.z - 110);
    this.sun.position.set(tgt.x + 150, tgt.y + 260, s.z - 30);
    this.stars.position.copy(cam.position);
    this.moon.position.copy(cam.position).add(this.moonOffset);

    // speed lines hug the course
    const arr = this.lines.geometry.attributes.position.array;
    const len = 1 + this.speed * 0.06;
    this.lineData.forEach((l, i) => {
      if (l.z > cam.position.z + 2 || l.z < cam.position.z - 420) {
        l.z = cam.position.z - rand(60, 400);
        const t = course.at(l.z, this.c3);
        const w = HW * t.sx - 0.6;
        l.x = t.x + rand(-w, w); l.y = t.floor + rand(0.5, Math.max(1, t.top - t.floor));
      }
      arr.set([l.x, l.y, l.z, l.x, l.y, l.z + len], i * 6);
    });
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.material.opacity = 0.12 + sp * 0.4;

    this.trench.update(cam.position.z);

    // post params
    const u = this.post.mat.uniforms;
    const p = this.tmp.set(ca.x, s.y + 0.9 + (ca.y - c.y) * 0.55, s.z - 300).project(cam);
    u.uCenter.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
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
