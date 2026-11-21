// Unified input: keyboard, mouse (absolute aim), touch (relative drag), gamepad.
export class Input {
  constructor() {
    this.keys = new Set();
    this.mouse = { nx: 0, ny: 0, down: false, fresh: false };
    this.drag = { id: null, lx: 0, ly: 0, dx: 0, dy: 0 };
    this.fireTouch = false;
    this.device = 'keyboard';
    this.pausePressed = false;
    this.gpFire = false;
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
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; this.fireTouch = false; this.drag.id = null; });

    window.addEventListener('pointerdown', e => {
      if (isUI(e)) return;
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.mouse.down = true;
        this.device = 'mouse';
        this._mouseMove(e);
      } else if (this.drag.id === null) {
        this.drag.id = e.pointerId; this.drag.lx = e.clientX; this.drag.ly = e.clientY;
        this.device = 'touch';
      }
    });
    window.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse') { this._mouseMove(e); return; }
      if (e.pointerId === this.drag.id) {
        this.drag.dx += e.clientX - this.drag.lx; this.drag.dy += e.clientY - this.drag.ly;
        this.drag.lx = e.clientX; this.drag.ly = e.clientY;
      }
    });
    const up = e => {
      if (e.pointerType === 'mouse') { if (e.button === 0) this.mouse.down = false; }
      else if (e.pointerId === this.drag.id) this.drag.id = null;
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  _mouseMove(e) {
    this.mouse.nx = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.ny = -((e.clientY / window.innerHeight) * 2 - 1);
    if (this.device !== 'mouse' && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2)) this.device = 'mouse';
  }

  bindFireButton(el) {
    const on = e => { e.preventDefault(); e.stopPropagation(); this.fireTouch = true; this.device = 'touch'; try { el.setPointerCapture(e.pointerId); } catch { /* noop */ } };
    const off = e => { e.preventDefault(); this.fireTouch = false; };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
  }

  takeDrag() {
    const d = { x: this.drag.dx, y: this.drag.dy };
    this.drag.dx = this.drag.dy = 0;
    return d;
  }

  takePause() { const p = this.pausePressed; this.pausePressed = false; return p; }

  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find(p => p && p.connected);
    this.gpX = this.gpY = 0; this.gpFire = false;
    if (!gp) return;
    const dz = v => (Math.abs(v) < 0.16 ? 0 : v);
    const x = dz(gp.axes[0] || 0), y = dz(gp.axes[1] || 0);
    const dl = gp.buttons[14]?.pressed ? -1 : gp.buttons[15]?.pressed ? 1 : 0;
    const du = gp.buttons[12]?.pressed ? 1 : gp.buttons[13]?.pressed ? -1 : 0;
    this.gpX = x || dl; this.gpY = -y || du;
    this.gpFire = !!(gp.buttons[0]?.pressed || gp.buttons[7]?.pressed || gp.buttons[5]?.pressed);
    if (this.gpX || this.gpY || this.gpFire) this.device = 'gamepad';
    const start = !!gp.buttons[9]?.pressed;
    if (start && !this._gpStartPrev) this.pausePressed = true;
    this._gpStartPrev = start;
  }

  axis() {
    const k = this.keys;
    let x = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    let y = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
    x += this.gpX; y += this.gpY;
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }

  firing() {
    return this.keys.has('Space') || this.keys.has('KeyJ') || this.keys.has('Enter') || this.mouse.down || this.fireTouch || this.gpFire;
  }
}
