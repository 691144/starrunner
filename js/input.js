// Unified input producing a steering vector in [-1,1]²: keyboard, mouse (stick-style), floating touch stick, gamepad.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const R = 64; // touch stick radius (px)

export class Input {
  constructor() {
    this.keys = new Set();
    this.mouse = { nx: 0, ny: 0 };
    this.touch = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.device = 'keyboard';
    this.pausePressed = false;
    this.gpX = 0; this.gpY = 0;
    this._gpStartPrev = false;

    const isUI = e => e.target.closest && e.target.closest('button, .screen, .panel, input, label, a');

    window.addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && !isUI(e)) e.preventDefault();
      if (e.code === 'Escape' || e.code === 'KeyP') this.pausePressed = true;
      this.keys.add(e.code);
      this.device = 'keyboard';
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.touch.id = null; this.touch.x = this.touch.y = 0; });

    window.addEventListener('pointerdown', e => {
      if (isUI(e) || e.pointerType === 'mouse') return;
      if (this.touch.id === null) {
        Object.assign(this.touch, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
        this.device = 'touch';
      }
    });
    window.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse') {
        this.mouse.nx = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.ny = -((e.clientY / window.innerHeight) * 2 - 1);
        if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.device = 'mouse';
        return;
      }
      const t = this.touch;
      if (e.pointerId !== t.id) return;
      let dx = e.clientX - t.ox, dy = e.clientY - t.oy;
      const l = Math.hypot(dx, dy);
      if (l > R) { // floating origin trails the finger so the stick re-centres naturally
        const k = (l - R) / l;
        t.ox += dx * k; t.oy += dy * k;
        dx = e.clientX - t.ox; dy = e.clientY - t.oy;
      }
      t.x = clamp(dx / R, -1, 1);
      t.y = clamp(-dy / R, -1, 1);
    });
    const up = e => {
      if (e.pointerId === this.touch.id) { this.touch.id = null; this.touch.x = this.touch.y = 0; }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  takePause() { const p = this.pausePressed; this.pausePressed = false; return p; }

  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find(p => p && p.connected);
    this.gpX = this.gpY = 0;
    if (!gp) return;
    const dz = v => (Math.abs(v) < 0.12 ? 0 : v);
    const x = dz(gp.axes[0] || 0), y = dz(gp.axes[1] || 0);
    const dl = gp.buttons[14]?.pressed ? -1 : gp.buttons[15]?.pressed ? 1 : 0;
    const du = gp.buttons[12]?.pressed ? 1 : gp.buttons[13]?.pressed ? -1 : 0;
    this.gpX = x || dl; this.gpY = -y || du;
    if (this.gpX || this.gpY) this.device = 'gamepad';
    const start = !!gp.buttons[9]?.pressed;
    if (start && !this._gpStartPrev) this.pausePressed = true;
    this._gpStartPrev = start;
  }

  // steering command: x right, y up, each in [-1, 1]
  steer(invertY = false) {
    const k = this.keys;
    let x = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    let y = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
    x += this.gpX; y += this.gpY;
    if (!x && !y) {
      if (this.device === 'mouse') {
        const f = v => (Math.abs(v) < 0.035 ? 0 : clamp(v * 1.3, -1, 1));
        x = f(this.mouse.nx); y = f(this.mouse.ny);
      } else if (this.device === 'touch') { x = this.touch.x; y = this.touch.y; }
    }
    return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) * (invertY ? -1 : 1) };
  }
}
