// Original craft: the "Ember" interceptor — diamond fuselage, forward-swept wings, twin pod engines.
import * as THREE from 'three';
import { glowSprite } from './fx.js';

export const CANNON_X = 2.05;   // lateral offset of the wing cannons (ship space)

export function buildShip() {
  const root = new THREE.Group();     // positioned by the game
  const body = new THREE.Group();     // rolled / pitched for banking
  root.add(body);

  const hull = new THREE.MeshStandardMaterial({ color: 0xd8dce1, roughness: 0.42, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.55, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.5, metalness: 0.2, emissive: 0x3a0e00 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a1624, roughness: 0.08, metalness: 0.9, emissive: 0x06263c });
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // fuselage: 4-sided taper, tip pointing -z, flattened
  const fus = new THREE.CylinderGeometry(0.02, 0.62, 4.4, 4, 1);
  fus.rotateX(-Math.PI / 2);
  fus.scale(1, 0.62, 1);
  add(fus, hull, 0, 0, -0.6);
  add(new THREE.BoxGeometry(1.0, 0.62, 2.0), hull, 0, 0, 1.9);
  add(new THREE.BoxGeometry(0.7, 0.4, 0.3), dark, 0, 0, 2.95);
  // canopy
  const can = new THREE.SphereGeometry(0.42, 16, 10);
  can.scale(0.75, 0.55, 1.9);
  add(can, glass, 0, 0.32, 0.25);
  // spine stripe
  add(new THREE.BoxGeometry(0.16, 0.05, 2.2), accent, 0, 0.37, 1.6);

  // forward-swept wings (shape in XY, laid flat into XZ)
  const shape = new THREE.Shape();
  shape.moveTo(0.35, 1.1);
  shape.lineTo(2.05, -0.35);
  shape.lineTo(2.05, 0.55);
  shape.lineTo(0.35, 2.3);
  shape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
  wingGeo.rotateX(Math.PI / 2);
  wingGeo.translate(0, 0.06, 0);
  const stripeGeo = new THREE.BoxGeometry(0.9, 0.03, 0.18);

  for (const s of [-1, 1]) {
    const wing = add(wingGeo, hull, 0, 0, 0);
    wing.scale.x = s;
    wing.rotation.z = s * -0.1;
    const st = add(stripeGeo, accent, s * 1.3, 0.02, 0.75);
    st.rotation.y = s * 0.68;
    // engine pod
    const pod = new THREE.CylinderGeometry(0.34, 0.4, 2.6, 14);
    pod.rotateX(Math.PI / 2);
    add(pod, dark, s * CANNON_X, -0.2, 0.9);
    add(new THREE.CylinderGeometry(0.36, 0.36, 0.25, 14).rotateX(Math.PI / 2), accent, s * CANNON_X, -0.2, -0.3);
    // cannon
    add(new THREE.CylinderGeometry(0.07, 0.09, 2.2, 8).rotateX(Math.PI / 2), dark, s * CANNON_X, -0.2, -1.4);
    add(new THREE.BoxGeometry(0.18, 0.18, 0.4), dark, s * CANNON_X, -0.2, -0.65);
    // nozzle core
    const noz = new THREE.Mesh(new THREE.CircleGeometry(0.27, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.55, 0.2).multiplyScalar(4) }));
    noz.position.set(s * CANNON_X, -0.2, 2.21);
    body.add(noz);
    const g = glowSprite(0xff7a2a, 1.2, 1.5);
    g.position.set(s * CANNON_X, -0.2, 2.45);
    body.add(g);
    (root.userData.glows ||= []).push(g);
  }
  // dorsal fin
  const fin = new THREE.Shape();
  fin.moveTo(0, 0); fin.lineTo(0.9, 0); fin.lineTo(1.3, 0.75); fin.lineTo(1.0, 0.75); fin.closePath();
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.08, bevelEnabled: false });
  finGeo.rotateY(-Math.PI / 2);
  finGeo.translate(0.04, 0.3, 1.2);
  add(finGeo, hull);

  root.userData.body = body;
  root.scale.setScalar(0.95);
  return root;
}
