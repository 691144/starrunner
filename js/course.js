// The course: a winding, rising/falling, narrowing canyon defined as a function of world z, plus discrete
// "features": raised floors, roofed tunnels, wall pinches (sideways gaps) and wall shoulders.
// A float lookup texture bakes it so the vertex shader can bend all trench geometry to follow it.
import * as THREE from 'three';

export const HW = 12;           // trench half-width at full width
export const TH = 40;           // trench depth at full height
export const LAT = 44;          // max lateral ship speed (units/s)
export const VERT = 38;         // max vertical ship speed (units/s)
export const STEP = 1.5;        // z spacing of baked samples
export const SHIP_W = 1.9;      // ship half-width (wings level)
export const SHIP_W_BANK = 0.55; // ship half-width knife-edge
export const SHIP_H = 0.55;     // ship half-height (wings level); equals SHIP_W when banked
const N = 1024;
const AHEAD = 800, BEHIND = 180;
const TAU = Math.PI * 2;
const WX = [TAU / 900, TAU / 520, TAU / 300];   // lateral bend wavelengths (fixed so phase never chirps)
const WY = [TAU / 1100, TAU / 640];             // vertical undulation wavelengths
const smooth = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const sectorLength = n => 2800 + 300 * (n - 1);
export const speedAt = d => Math.min(250, 90 + 15 * d);

export class Course {
  constructor() {
    this.data = new Float32Array(N * 8);   // row 0: x, y, sx, sy · row 1: floor raise, ceiling drop, wall-left inset, wall-right inset
    this.tex = new THREE.DataTexture(this.data, N, 2, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    this.uniforms = { uCourse: { value: this.tex } };
    this._t = {};
    this.reset(0, 0, 1, 1, 1);
  }

  // z0: where the run starts; d0: starting difficulty offset (menu uses a mid value)
  reset(z0, d0, speedMul = 1, frac = 1, narrow = 1) {
    this.z0 = z0; this.d0 = d0; this.speedMul = speedMul; this.frac = frac; this.narrow = narrow;
    this.ph = Array.from({ length: 8 }, () => Math.random() * TAU);
    this.features = [];
    this.genDist = 600;
    this.hi = null;
    this.sync(z0);
  }

  // difficulty level d: continuous, +1 per sector
  dAt(dist) {
    let n = 1, r = dist, len = sectorLength(1);
    while (r >= len && n < 200) { r -= len; n++; len = sectorLength(n); }
    return this.d0 + (n - 1) + r / len;
  }
  dAtZ(z) { return this.dAt(Math.max(0, this.z0 - z)); }

  // ---------------------------------------------------------------- features
  genTo(dist) {
    while (this.genDist < dist) {
      const d = this.dAt(this.genDist);
      const speed = speedAt(d) * this.speedMul;
      const ramp = clamp(speed * 0.55, 45, 120);
      const pool = [['hump', 3]];
      if (d >= 0.8) pool.push(['tunnel', 2.4]);
      if (d >= 1.2) pool.push(['shoulder', 1.4]);
      if (d >= 1.6) pool.push(['pinch', 2.2]);
      let type = 'hump';
      if (this.features.length) {
        let r = Math.random() * pool.reduce((a, p) => a + p[1], 0);
        for (const [t, w] of pool) { if ((r -= w) <= 0) { type = t; break; } }
        // never two pinches or two tunnels back to back
        const prev = this.features[this.features.length - 1];
        if (prev.type === type && (type === 'pinch' || type === 'tunnel')) type = 'hump';
      }
      // keep features clear of sector gates
      const edge = this.edgeNear(this.genDist, this.genDist + 520);
      if (edge !== null) { this.genDist = edge + 160; continue; }
      const f = { type, ramp, d0: this.genDist + ramp, pass: false, hit: false, announced: false, built: false };
      if (type === 'hump') {
        f.len = rand(45, 70);
        f.h = Math.min(8.5 + 1.2 * d, 17);
      } else if (type === 'tunnel') {
        f.len = clamp(speed * rand(1.5, 2.1), 140, 300);
        f.clear = Math.max(8.5, 15 - 0.8 * d);          // underside height above the floor
      } else if (type === 'pinch') {
        f.len = rand(40, 60);
        f.h = Math.max(1.6, 1.95 - 0.05 * d);            // gap half-width: narrower than the ship's wings, so banking is required
        f.g = rand(-1, 1);                                // gap centre, as a fraction of the available span
      } else {
        f.len = rand(70, 120);
        f.side = Math.random() < 0.5 ? -1 : 1;
        f.amt = Math.min(3.2 + 0.7 * d, 7);
      }
      f.d1 = f.d0 + f.len;
      this.features.push(f);
      const gapT = clamp(3.4 - 0.16 * d, 1.9, 3.4);
      this.genDist = f.d1 + f.ramp + speed * gapT * rand(0.9, 1.25);
    }
  }

  // distance of a sector boundary within [a, b], or null
  edgeNear(a, b) {
    let acc = 0;
    for (let n = 1; n < 200; n++) {
      acc += sectorLength(n);
      if (acc > b) return null;
      if (acc >= a) return acc;
    }
    return null;
  }

  envelope(f, dist) {
    if (dist < f.d0 - f.ramp || dist > f.d1 + f.ramp) return 0;
    if (dist < f.d0) return smooth(f.d0 - f.ramp, f.d0, dist);
    if (dist <= f.d1) return 1;
    return 1 - smooth(f.d1, f.d1 + f.ramp, dist);
  }

  // world-z extent of a feature (ramps included): zs is the nearer-to-start end
  zRange(f) { return { zs: this.z0 - (f.d0 - f.ramp), ze: this.z0 - (f.d1 + f.ramp), zhs: this.z0 - f.d0, zhe: this.z0 - f.d1 }; }

  // ---------------------------------------------------------------- the course function
  // centerline x, y, width/height scale, and feature offsets at world z
  at(z, o = {}) {
    const dist = Math.max(0, this.z0 - z);
    const d = this.dAt(dist);
    const p = this.ph;
    const sp = speedAt(d) * this.speedMul;
    const frac = Math.min(0.92, 0.32 + 0.07 * d) * this.frac;
    const ramp = smooth(0, 280, dist);
    const mod = 0.72 + 0.28 * Math.sin(dist / 830 + p[3]);

    const S = (frac * LAT / sp) * mod;
    const k2 = Math.min(0.45, 0.22 + 0.035 * d), k3 = Math.min(0.32, 0.08 + 0.03 * d);
    const tot = 0.7 + k2 + k3;
    const x = (S * 0.7 / tot / WX[0]) * (Math.sin(WX[0] * dist + p[0]) - Math.sin(p[0]))
            + (S * k2 / tot / WX[1]) * (Math.sin(WX[1] * dist + p[1]) - Math.sin(p[1]))
            + (S * k3 / tot / WX[2]) * (Math.sin(WX[2] * dist + p[2]) - Math.sin(p[2]));

    const Sy = 0.5 * frac * VERT / sp;
    const y = (Sy * 0.75 / WY[0]) * (Math.sin(WY[0] * dist + p[4]) - Math.sin(p[4]))
            + (Sy * 0.25 / WY[1]) * (Math.sin(WY[1] * dist + p[6]) - Math.sin(p[6]));

    o.x = x * ramp;
    o.y = y * ramp;
    o.sx = Math.max(0.4, 1 - 0.072 * d * this.narrow) * (1 + 0.09 * Math.sin(dist / 240 + p[5]) * Math.min(1, d));
    o.sy = Math.max(0.5, 1 - 0.065 * d * this.narrow);
    o.d = d;

    // features
    let fr = 0, cl = 0, wl = 0, wr = 0;
    const hwx = HW * o.sx, rim = TH * o.sy;
    for (let i = 0; i < this.features.length; i++) {
      const f = this.features[i];
      const e = this.envelope(f, dist);
      if (e <= 0) continue;
      if (f.type === 'hump') fr = Math.max(fr, e * Math.min(f.h, rim - 12.5));
      else if (f.type === 'tunnel') cl = Math.max(cl, e * Math.max(0, rim - f.clear));
      else if (f.type === 'pinch') {
        const g = f.g * Math.max(0, hwx - f.h - 1.2);
        wl = Math.max(wl, e * (g - f.h + hwx));
        wr = Math.max(wr, e * (hwx - g - f.h));
      } else if (f.side < 0) wl = Math.max(wl, e * Math.min(f.amt, hwx * 0.5));
      else wr = Math.max(wr, e * Math.min(f.amt, hwx * 0.5));
    }
    o.fr = fr; o.cl = cl; o.wl = wl; o.wr = wr;
    o.lw = -hwx + wl;           // left wall, relative to the centerline
    o.rw = hwx - wr;            // right wall
    o.floor = o.y + fr;         // world floor height
    o.top = o.y + rim - cl;     // world ceiling (rim, or tunnel underside)
    return o;
  }

  // flyable bounds for a ship of the given extents; flags squeezes where it simply can't fit
  limits(c, effW, effH, out = {}) {
    out.l = c.x + c.lw + effW + 0.25;
    out.r = c.x + c.rw - effW - 0.25;
    out.lo = c.floor + effH + 0.9;
    out.hi = c.top - effH - 1.2;
    out.sqX = out.l > out.r;
    out.sqY = out.lo > out.hi;
    if (out.sqX) out.l = out.r = (out.l + out.r) / 2;
    if (out.sqY) out.lo = out.hi = (out.lo + out.hi) / 2;
    return out;
  }

  _write(i) {
    const t = this.at(-i * STEP, this._t);
    const k = (((i % N) + N) % N) * 4;
    const d = this.data;
    d[k] = t.x; d[k + 1] = t.y; d[k + 2] = t.sx; d[k + 3] = t.sy;
    d[N * 4 + k] = t.fr; d[N * 4 + k + 1] = t.cl; d[N * 4 + k + 2] = t.wl; d[N * 4 + k + 3] = t.wr;
  }

  // make sure features exist and baked samples cover the window around the ship
  sync(z) {
    const dist = Math.max(0, this.z0 - z);
    this.genTo(dist + AHEAD + 500);
    while (this.features.length > 2 && this.features[0].d1 + this.features[0].ramp < dist - 500) this.features.shift();
    const iNow = Math.floor(-z / STEP);
    const target = iNow + Math.ceil(AHEAD / STEP);
    let from;
    if (this.hi === null) from = iNow - Math.ceil(BEHIND / STEP);
    else if (target > this.hi) from = this.hi + 1;
    else return;
    for (let i = from; i <= target; i++) this._write(i);
    this.hi = target;
    this.tex.needsUpdate = true;
  }
}

// GLSL: displace world-space positions along the course.
//  trench mode: bend + width/height scale + wall inset + raised floor (rim stays fixed)
//  roof mode:   tunnel roof slabs. Local y 0 is the underside; y in [0,1] spans up to the roof top; y < 0 hangs below (lights)
const BEND_GLSL = /* glsl */`
uniform sampler2D uCourse;
vec4 courseA(int i, int row) { return texelFetch(uCourse, ivec2(((i % 1024) + 1024) % 1024, row), 0); }
void courseAt(float zw, out vec4 A, out vec4 B) {
  float u = -zw / ${STEP.toFixed(2)};
  float fl = floor(u);
  int i0 = int(fl);
  float f = u - fl;
  A = mix(courseA(i0, 0), courseA(i0 + 1, 0), f);
  B = mix(courseA(i0, 1), courseA(i0 + 1, 1), f);
}
vec4 bendPos(vec4 p) {
  vec4 A, B;
  courseAt(p.z, A, B);
  float Lw = -${HW.toFixed(1)} * A.z + B.z;
  float Rw =  ${HW.toFixed(1)} * A.z - B.w;
  // wall detail that sticks out into the canyon flattens as that wall moves in, so gaps stay clear
  float kR = clamp(1.0 - B.w / 4.0, 0.06, 1.0), kL = clamp(1.0 - B.z / 4.0, 0.06, 1.0);
  float dR = p.x - ${HW.toFixed(1)}, dL = p.x + ${HW.toFixed(1)};
  float xo = p.x >= 0.0 ? Rw + (dR < 0.0 ? dR * kR : dR) * A.z : Lw + (dL > 0.0 ? dL * kL : dL) * A.z;
  p.x = A.x + xo;
  p.y = A.y + B.x + p.y * (A.w - B.x / ${TH.toFixed(1)});
  return p;
}
vec4 bendRoof(vec4 p) {
  vec4 A, B;
  courseAt(p.z, A, B);
  float rim = A.y + ${TH.toFixed(1)} * A.w;
  float yb = rim - B.y;
  float thick = min(12.0, B.y * 0.7) + 0.12;
  p.y = p.y <= 0.0 ? yb + p.y : yb + p.y * (B.y + thick);
  p.x = A.x + p.x * A.z;
  return p;
}
`;
const projectFor = fn => /* glsl */`
vec4 bendWP = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  bendWP = instanceMatrix * bendWP;
#endif
bendWP = ${fn}( modelMatrix * bendWP );
vec4 mvPosition = viewMatrix * bendWP;
gl_Position = projectionMatrix * mvPosition;
`;
const worldposFor = fn => /* glsl */`
#include <worldpos_vertex>
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  worldPosition = ${fn}( worldPosition );
#endif
`;

export function bendMaterial(mat, course, mode = 'trench') {
  const fn = mode === 'roof' ? 'bendRoof' : 'bendPos';
  mat.onBeforeCompile = sh => {
    sh.uniforms.uCourse = course.uniforms.uCourse;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', BEND_GLSL + '\nvoid main() {')
      .replace('#include <project_vertex>', projectFor(fn))
      .replace('#include <worldpos_vertex>', worldposFor(fn));
  };
  mat.customProgramCacheKey = () => 'bend-' + mode;
  return mat;
}

export function bendDepthMaterial(course, mode = 'trench') {
  return bendMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), course, mode);
}
