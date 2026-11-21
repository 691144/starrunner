// Procedural trench: recycled chunks of greebled walls, floor and surface.
import * as THREE from 'three';
import { HW, TH, bendMaterial, bendDepthMaterial } from './course.js';

export { HW, TH };
export const CL = 120;     // chunk length along -z
const NCHUNK = 6;

const rand = (a, b) => a + Math.random() * (b - a);

// ---------- procedural textures ----------
function panelTexture(size, base, depthMax, vents) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);

  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  const sub = (x, y, w, h, depth) => {
    const leaf = depth >= depthMax || w < size / 14 || h < size / 14 || (depth > 1 && Math.random() < 0.16 * depth);
    if (leaf) {
      const shade = rand(-0.16, 0.12);
      g.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${-shade})`;
      g.fillRect(x + 1, y + 1, w - 2, h - 2);
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, w - 2, h - 2);
      g.strokeStyle = 'rgba(255,255,255,0.16)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + 2.5, y + h - 2.5); g.lineTo(x + 2.5, y + 2.5); g.lineTo(x + w - 2.5, y + 2.5);
      g.stroke();
      if (vents && Math.random() < 0.22 && w > 24 && h > 24) {
        g.fillStyle = 'rgba(0,0,0,0.42)';
        if (w > h) for (let k = x + 6; k < x + w - 6; k += 5) g.fillRect(k, y + 6, 2, h - 12);
        else for (let k = y + 6; k < y + h - 6; k += 5) g.fillRect(x + 6, k, w - 12, 2);
      }
      if (Math.random() < 0.18) {
        g.fillStyle = 'rgba(0,0,0,0.5)';
        for (const [px, py] of [[x + 5, y + 5], [x + w - 6, y + 5], [x + 5, y + h - 6], [x + w - 6, y + h - 6]]) g.fillRect(px, py, 2, 2);
      }
      return;
    }
    if (w > h ? Math.random() < 0.72 : Math.random() < 0.28) {
      const s = Math.round(w * rand(0.3, 0.7)); sub(x, y, s, h, depth + 1); sub(x + s, y, w - s, h, depth + 1);
    } else {
      const s = Math.round(h * rand(0.3, 0.7)); sub(x, y, w, s, depth + 1); sub(x, y + s, w, h - s, depth + 1);
    }
  };
  const q = size / 2;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) sub(i * q, j * q, q, q, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

export class Trench {
  constructor(scene, course) {
    this.scene = scene;
    this.course = course;
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.longBoxGeo = new THREE.BoxGeometry(1, 1, 1, 1, 1, 24);   // long ledges need slices to follow bends
    this.depthMat = bendDepthMaterial(course);

    const wallTex = panelTexture(512, '#8d9299', 5, true);
    const greebleTex = panelTexture(256, '#9aa0a7', 3, true);
    this.wallMat = bendMaterial(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.82, metalness: 0.18 }), course, 'trench', true);
    this.greebleMat = bendMaterial(new THREE.MeshStandardMaterial({ map: greebleTex, roughness: 0.75, metalness: 0.25 }), course, 'trench', true);
    this.accentMat = bendMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.7, 0.3).multiplyScalar(3) }), course);
    this.whiteMat = bendMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.85).multiplyScalar(2.2) }), course);
    this.greebleTex = greebleTex;

    this.chunks = [];
    for (let i = 0; i < NCHUNK; i++) {
      const c = this.buildChunk();
      c.position.z = -i * CL;
      scene.add(c);
      this.chunks.push(c);
    }
  }

  setAccent(hex) {
    this.accentMat.color.set(hex).multiplyScalar(3);
  }

  buildChunk() {
    const group = new THREE.Group();
    const boxes = [];
    const lightsA = [];
    const lightsW = [];
    const B = (x, y, z, sx, sy, sz, shade = rand(0.5, 0.9)) => boxes.push([x, y, z, sx, sy, sz, shade]);
    const clampY = (y, h) => Math.min(y, TH + 0.4 - h / 2);

    // ---- walls ----
    for (const s of [-1, 1]) {
      const face = s * HW;
      const nL = 3 + ((Math.random() * 3) | 0);
      for (let i = 0; i < nL; i++) {
        const d = rand(0.6, 2.0), h = rand(0.4, 1.4);
        B(face - s * d / 2, rand(2, TH - 2), -CL / 2, d, h, CL, rand(0.55, 0.8));
      }
      for (let z = -rand(0, 12); z > -CL; z -= rand(8, 22)) {
        const d = rand(0.4, 1.3), w = rand(0.6, 2.4);
        B(face - s * d / 2, TH / 2, z, d, TH, w, rand(0.5, 0.72));
      }
      for (let i = 0; i < 150; i++) {
        const w = rand(1, 9) * (Math.random() < 0.18 ? 2 : 1);
        const h = rand(0.5, 5.5), d = rand(0.3, 2.4);
        const y = clampY(rand(0, TH), h), z = rand(-CL, 0);
        B(face - s * d / 2, y, z, d, h, w);
        if (Math.random() < 0.3) {
          const arr = Math.random() < 0.55 ? lightsA : lightsW;
          arr.push([face - s * (d + 0.03), y + rand(-h, h) * 0.35, z + rand(-w, w) * 0.35, 0.08, rand(0.15, 0.3), rand(0.25, 1.1)]);
        }
      }
      // big structural slabs for silhouette variety
      for (let i = 0; i < 6; i++) {
        const h = rand(4, 12), w = rand(6, 18), d = rand(1.5, 3.2);
        B(face - s * d / 2, clampY(rand(h / 2, TH), h), rand(-CL, 0), d, h, w, rand(0.45, 0.7));
      }
    }

    // ---- floor ----
    for (let k = 0; k < 3; k++) {
      const r = rand(0.5, 1.1);
      B(rand(-HW + 1.5, HW - 1.5), r / 2, -CL / 2, r, r, CL, 0.45);
    }
    for (let i = 0; i < 55; i++) {
      const h = rand(0.1, 1.3);
      B(rand(-HW, HW), h / 2, rand(-CL, 0), rand(1, 6), h, rand(1, 9), rand(0.4, 0.7));
    }
    for (let z = -5; z > -CL; z -= 10) {
      lightsA.push([-3.6, 0.12, z, 0.45, 0.12, 1.8]);
      lightsA.push([3.6, 0.12, z, 0.45, 0.12, 1.8]);
    }

    // ---- surface beyond the lip (jagged silhouette against the stars) ----
    for (const s of [-1, 1]) {
      B(s * (HW + 1.2), TH + 0.4, -CL / 2, 2.4, 0.8, CL, 0.7);
      for (let i = 0; i < 70; i++) {
        const tall = Math.random() < 0.14;
        const h = tall ? rand(4, 12) : rand(0.4, 3);
        const x = s * (HW + 1.5 + Math.pow(Math.random(), 2) * 80);
        const w = rand(2, 10), dz = rand(2, 12), z = rand(-CL, 0);
        B(x, TH + h / 2, z, w, h, dz, rand(0.45, 0.8));
        if (tall && Math.random() < 0.6) lightsW.push([x, TH + h + 0.2, z, 0.3, 0.3, 0.3]);
      }
    }

    const o = new THREE.Object3D();
    const col = new THREE.Color();
    for (const [list, geo] of [[boxes.filter(b => b[5] <= 14), this.boxGeo], [boxes.filter(b => b[5] > 14), this.longBoxGeo]]) {
      const inst = new THREE.InstancedMesh(geo, this.greebleMat, list.length);
      list.forEach((b, i) => {
        o.position.set(b[0], b[1], b[2]);
        o.scale.set(b[3], b[4], b[5]);
        o.updateMatrix();
        inst.setMatrixAt(i, o.matrix);
        inst.setColorAt(i, col.setScalar(b[6]));
      });
      inst.castShadow = inst.receiveShadow = true;
      inst.customDepthMaterial = this.depthMat;
      inst.frustumCulled = false;
      group.add(inst);
    }

    for (const [arr, mat] of [[lightsA, this.accentMat], [lightsW, this.whiteMat]]) {
      const lm = new THREE.InstancedMesh(this.boxGeo, mat, arr.length);
      arr.forEach((b, i) => {
        o.position.set(b[0], b[1], b[2]);
        o.scale.set(b[3], b[4], b[5]);
        o.updateMatrix();
        lm.setMatrixAt(i, o.matrix);
      });
      lm.frustumCulled = false;
      group.add(lm);
    }

    // ---- base planes ----
    const wallGeo = scaleUV(new THREE.PlaneGeometry(CL, TH, 40, 1), CL / 22, TH / 22);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wallGeo, this.wallMat);
      w.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
      w.position.set(s * HW, TH / 2, -CL / 2);
      w.receiveShadow = true;
      group.add(w);
    }
    const floor = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(HW * 2, CL, 1, 40), HW * 2 / 22, CL / 22), this.wallMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -CL / 2);
    floor.receiveShadow = true;
    group.add(floor);
    const surfGeo = scaleUV(new THREE.PlaneGeometry(200, CL, 1, 40), 200 / 30, CL / 30);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(surfGeo, this.wallMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(s * (HW + 100), TH, -CL / 2);
      p.receiveShadow = true;
      group.add(p);
    }
    group.traverse(m => { m.frustumCulled = false; });
    return group;
  }

  update(camZ) {
    for (const c of this.chunks) {
      if (c.position.z - CL > camZ + 10) c.position.z -= NCHUNK * CL;
    }
  }

  // Reset chunks so they start at the given z (used when restarting far from origin is unnecessary,
  // but keeps things tidy).
  placeAt(z) {
    this.chunks.forEach((c, i) => { c.position.z = Math.ceil(z / CL) * CL + CL - i * CL; });
  }
}
