// The course: a winding, rising/falling, narrowing canyon defined as a function of world z.
// A float lookup texture of the centerline lets the vertex shader bend all trench geometry to follow it.
import * as THREE from 'three';

export const HW = 12;           // trench half-width at full width
export const TH = 40;           // trench depth at full height
export const LAT = 44;          // max lateral ship speed (units/s)
export const VERT = 38;         // max vertical ship speed (units/s)
export const STEP = 1.5;        // z spacing of baked samples
const N = 1024;
const AHEAD = 800, BEHIND = 180;
const TAU = Math.PI * 2;
const WX = [TAU / 900, TAU / 520, TAU / 300];   // lateral bend wavelengths (fixed so phase never chirps)
const WY = [TAU / 1100, TAU / 640];             // vertical undulation wavelengths
const smooth = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };

export const sectorLength = n => 2800 + 300 * (n - 1);
export const speedAt = d => Math.min(250, 90 + 15 * d);

export class Course {
  constructor() {
    this.data = new Float32Array(N * 4);
    this.tex = new THREE.DataTexture(this.data, N, 1, THREE.RGBAFormat, THREE.FloatType);
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

  // centerline x, y, and width/height scale at world z
  at(z, o = {}) {
    const dist = Math.max(0, this.z0 - z);
    const d = this.dAt(dist);
    const p = this.ph;
    const sp = speedAt(d) * this.speedMul;
    const frac = Math.min(0.92, 0.32 + 0.07 * d) * this.frac;
    const ramp = smooth(0, 280, dist);
    const mod = 0.72 + 0.28 * Math.sin(dist / 830 + p[3]);

    // lateral: slope amplitude S is chosen so the steepest bend demands `frac` of the ship's lateral speed
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
    return o;
  }

  // flyable limits at a sample
  limX(c) { return HW * c.sx - 2.3; }
  yLo(c) { return c.y + 1.5; }
  yHi(c) { return c.y + TH * c.sy - 2.8; }

  _write(i) {
    const t = this.at(-i * STEP, this._t);
    const k = (((i % N) + N) % N) * 4;
    this.data[k] = t.x; this.data[k + 1] = t.y; this.data[k + 2] = t.sx; this.data[k + 3] = t.sy;
  }

  // make sure baked samples cover the window around the ship
  sync(z) {
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

// GLSL that displaces world-space positions along the course.
const BEND_GLSL = /* glsl */`
uniform sampler2D uCourse;
vec4 courseAt(int i) { return texelFetch(uCourse, ivec2(((i % 1024) + 1024) % 1024, 0), 0); }
vec4 bendPos(vec4 p) {
  float u = -p.z / ${STEP.toFixed(2)};
  float fl = floor(u);
  int i0 = int(fl);
  vec4 c = mix(courseAt(i0), courseAt(i0 + 1), u - fl);
  p.x = c.x + p.x * c.z;
  p.y = c.y + p.y * c.w;
  return p;
}
`;
const PROJECT = /* glsl */`
vec4 bendWP = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  bendWP = instanceMatrix * bendWP;
#endif
bendWP = bendPos( modelMatrix * bendWP );
vec4 mvPosition = viewMatrix * bendWP;
gl_Position = projectionMatrix * mvPosition;
`;
const WORLDPOS = /* glsl */`
#include <worldpos_vertex>
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  worldPosition = bendPos( worldPosition );
#endif
`;

export function bendMaterial(mat, course) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uCourse = course.uniforms.uCourse;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', BEND_GLSL + '\nvoid main() {')
      .replace('#include <project_vertex>', PROJECT)
      .replace('#include <worldpos_vertex>', WORLDPOS);
  };
  mat.customProgramCacheKey = () => 'bend';
  return mat;
}

export function bendDepthMaterial(course) {
  return bendMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), course);
}
