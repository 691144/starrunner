// Particles, glow sprites and the full-screen post pass (zoom blur, aberration, vignette, grain).
import * as THREE from 'three';

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export function glowSprite(color, scale, intensity = 2) {
  const m = new THREE.SpriteMaterial({
    map: glowTexture(), color: new THREE.Color(color).multiplyScalar(intensity),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
  });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(scale);
  return s;
}

// ---------- CPU particle system rendered as one Points draw ----------
export class Particles {
  constructor(scene, max = 2600) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.s0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */`
        attribute vec3 pcolor; attribute float psize; attribute float palpha;
        uniform float uScale;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vColor = pcolor; vAlpha = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = palpha > 0.0 ? psize * uScale / max(0.5, -mv.z) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor; varying float vAlpha;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          a *= a;
          gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
        }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setScale(px) { this.mat.uniforms.uScale.value = px; }

  // opts: count, speed, spread(0..1 sphere vs cone), dir, c0, c1, life, size, drag, grav, vel (inherit)
  emit(p, o) {
    const n = o.count || 20;
    const c0 = new THREE.Color(o.c0 ?? 0xffffff).multiplyScalar(o.bright ?? 3);
    const c1 = new THREE.Color(o.c1 ?? 0xff3300).multiplyScalar((o.bright ?? 3) * 0.4);
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      const sp = (o.speed ?? 20) * (0.3 + Math.random() * 0.7);
      dx /= l; dy /= l; dz /= l;
      if (o.dir) { dx = dx * (o.spread ?? 0.5) + o.dir.x; dy = dy * (o.spread ?? 0.5) + o.dir.y; dz = dz * (o.spread ?? 0.5) + o.dir.z; }
      this.pos[i3] = p.x + (Math.random() - 0.5) * (o.jitter ?? 0);
      this.pos[i3 + 1] = p.y + (Math.random() - 0.5) * (o.jitter ?? 0);
      this.pos[i3 + 2] = p.z + (Math.random() - 0.5) * (o.jitter ?? 0);
      this.vel[i3] = dx * sp + (o.vel ? o.vel.x : 0);
      this.vel[i3 + 1] = dy * sp + (o.vel ? o.vel.y : 0);
      this.vel[i3 + 2] = dz * sp + (o.vel ? o.vel.z : 0);
      const life = (o.life ?? 0.8) * (0.5 + Math.random() * 0.7);
      this.life[i] = life; this.maxLife[i] = life;
      this.c0[i3] = c0.r; this.c0[i3 + 1] = c0.g; this.c0[i3 + 2] = c0.b;
      this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
      this.s0[i] = (o.size ?? 1) * (0.5 + Math.random());
      this.drag[i] = o.drag ?? 2;
      this.grav[i] = o.grav ?? 0;
      this.alpha[i] = 1;
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const i3 = i * 3;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt; this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.col[i3] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      this.col[i3 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      this.col[i3 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      this.size[i] = this.s0[i] * (1 + t * 1.5);
      this.alpha[i] = this.life[i] > 0 ? (1 - t) : 0;
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.pcolor.needsUpdate = a.psize.needsUpdate = a.palpha.needsUpdate = true;
  }

  clear() { this.life.fill(0); this.alpha.fill(0); }
}

// ---------- Post pass ----------
export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uBlur: { value: 0 }, uAberr: { value: 0 }, uTime: { value: 0 },
        uFlash: { value: new THREE.Color(0, 0, 0) }, uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uAspect: { value: 1 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float uBlur, uAberr, uTime, uAspect;
        uniform vec3 uFlash; uniform vec2 uCenter;
        varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec2 dir = vUv - uCenter;
          float d = length(dir * vec2(uAspect, 1.0));
          float amt = uBlur * smoothstep(0.06, 0.8, d);
          float j = hash(vUv * vec2(1931.0, 977.0) + fract(uTime));
          vec3 col = vec3(0.0);
          const int N = 8;
          if (uAberr > 0.0005) {
            for (int i = 0; i < N; i++) {
              float t = (float(i) + j) / float(N);
              vec2 uv = vUv - dir * amt * t;
              col.r += texture2D(tDiffuse, uv - dir * uAberr).r;
              col.g += texture2D(tDiffuse, uv).g;
              col.b += texture2D(tDiffuse, uv + dir * uAberr).b;
            }
            col /= float(N);
          } else if (amt > 0.0005) {
            for (int i = 0; i < N; i++) {
              float t = (float(i) + j) / float(N);
              col += texture2D(tDiffuse, vUv - dir * amt * t).rgb;
            }
            col /= float(N);
          } else {
            col = texture2D(tDiffuse, vUv).rgb;
          }
          col += uFlash;
          vec2 vd = (vUv - 0.5) * vec2(uAspect, 1.0);
          float v = smoothstep(1.15, 0.3, length(vd) * 1.25);
          col *= mix(0.25, 1.0, v);
          col += (hash(vUv * 913.0 + fract(uTime * 7.0)) - 0.5) * 0.02;
          gl_FragColor = vec4(max(col, 0.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    q.frustumCulled = false;
    this.scene.add(q);
  }

  setSize(w, h, samples = 4) {
    if (this.rt.samples !== samples) { this.rt.dispose(); this.rt.samples = samples; }
    this.rt.setSize(w, h);
    this.mat.uniforms.uAspect.value = w / h;
  }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
