// Bootstrap: UI screens, HUD binding, settings persistence, PWA install + service worker.
import { Game, DIFFS } from './game.js';
import { Sound } from './audio.js';
import { Input } from './input.js';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('starrunner.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('starrunner.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
const settings = Object.assign({
  sfx: true, music: true, blur: 'med', invertY: false, quality: coarse ? 'medium' : 'high',
}, store.get('settings', {}));
if (typeof settings.blur === 'boolean') settings.blur = settings.blur ? 'med' : 'off';   // older saves: on/off
let diffKey = store.get('diff', 'pilot');
let records = store.get('records', {}); // { pilot: {score, sector}, ... }

// ---------------- HUD ----------------
// shield bar: one segment per 10 points of capacity, so the bar grows as capacity builds up
const shieldBar = $('h-shield');
let segs = [], segN = 0;
function buildSegs(n) {
  shieldBar.textContent = '';
  for (let i = 0; i < n; i++) shieldBar.appendChild(document.createElement('b'));
  segs = [...shieldBar.children];
  segN = n;
}
const cache = {};
const setText = (el, key, v) => { if (cache[key] !== v) { cache[key] = v; el.textContent = v; } };
const ew = [$('ew-l'), $('ew-r'), $('ew-t'), $('ew-b')];
const signsEl = $('signs'), signEls = new Map();
let bannerTimer = 0;

const hud = {
  update(s) {
    setText($('h-score'), 'score', s.score.toLocaleString());
    const m = $('h-mult');
    if (cache.mult !== s.mult) {
      m.textContent = '×' + s.mult;
      m.classList.toggle('x1', s.mult === 1);
      if (s.mult > (cache.mult || 1)) { m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump'); setTimeout(() => m.classList.remove('bump'), 160); }
      cache.mult = s.mult;
    }
    setText($('h-speed'), 'speed', String(s.speed));
    setText($('h-sector'), 'sector', `SECTOR ${String(s.sector).padStart(2, '0')} · ${s.sectorName}`);
    const pct = Math.round(s.progress * 1000) / 10;
    if (cache.prog !== pct) { cache.prog = pct; $('h-progress').style.width = pct + '%'; }
    const max = s.shieldMax || 100;
    const n = Math.round(max / 10);
    if (n !== segN) { buildSegs(n); cache.shield = null; }
    const sh = Math.max(0, Math.round(s.shield));
    if (cache.shield !== sh) {
      cache.shield = sh;
      $('h-shield-num').textContent = `${sh} / ${max}`;
      const on = Math.ceil(sh / 10);
      segs.forEach((b, i) => b.classList.toggle('off', i >= on));
      const r = sh / max;
      shieldBar.classList.toggle('warn', r <= 0.5 && r > 0.25);
      shieldBar.classList.toggle('crit', r <= 0.25);
      $('damage-edge').classList.toggle('low', r <= 0.25 && sh > 0);
    }
    const inv = !!s.invuln;
    if (cache.inv !== inv) { cache.inv = inv; document.querySelector('.shield').classList.toggle('inv', inv); }
  },
  callout(text, kind = '') {
    const box = $('callouts');
    const d = document.createElement('div');
    d.className = 'callout ' + kind;
    d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.remove(), 1150);
  },
  banner(kicker, title, tip) {
    const b = $('banner');
    b.querySelector('.b-kicker').textContent = kicker;
    b.querySelector('.b-title').textContent = title;
    b.querySelector('.b-tip').textContent = tip;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('show'), 3700);
  },
  damage() {
    const e = $('damage-edge');
    e.classList.add('flash');
    setTimeout(() => e.classList.remove('flash'), 90);
  },
  sectorUp() { /* banner covers it */ },
  edges(v) {
    for (let i = 0; i < 4; i++) {
      const o = Math.round(v[i] * 100) / 100;
      if (cache['e' + i] !== o) { cache['e' + i] = o; ew[i].style.opacity = o; }
    }
  },
  // floating warning signs for the next hazards: steady, fade in/out, countdown to the hazard
  signs(list) {
    const seen = new Set();
    list.forEach((g, i) => {
      let el = signEls.get(g.id);
      if (!el) {
        el = makeSign(g);
        signsEl.appendChild(el);
        signEls.set(g.id, el);
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
      }
      seen.add(g.id);
      el.style.order = i;
      el.classList.toggle('next', i === 0);
      el.classList.toggle('now', g.t <= 0);
      const txt = g.t <= 0 ? 'NOW' : g.t.toFixed(1) + 's';
      if (el._t !== txt) { el._t = txt; el.querySelector('.sg-t').textContent = txt; }
    });
    for (const [id, el] of signEls) {
      if (seen.has(id)) continue;
      signEls.delete(id);
      el.classList.add('out');
      setTimeout(() => el.remove(), 450);
    }
  },
  paused(p) { show('screen-pause', p); },
  gameOver(st) {
    const prev = records[st.difficulty];
    const isNew = !prev || st.score > prev.score;
    if (isNew) { records[st.difficulty] = { score: st.score, sector: st.sector }; store.set('records', records); }
    $('o-score').textContent = st.score.toLocaleString();
    $('o-sector').textContent = st.sector;
    $('o-rings').textContent = st.cleared;
    $('o-perfect').textContent = '×' + st.maxMult;
    $('o-dist').textContent = (st.distance / 1000).toFixed(1) + ' km';
    $('o-newrec').classList.toggle('hidden', !isNew || st.score === 0);
    const r = records[st.difficulty];
    $('o-best').innerHTML = r ? `${DIFFS[st.difficulty].label} BEST <b>${r.score.toLocaleString()}</b> · SECTOR ${r.sector}` : '';
    show('hud', false);
    show('screen-over', true);
    $('btn-retry').focus({ preventScroll: true });
    refreshRecord();
  },
};

// ---------------- hazard signs ----------------
const SIGN = {
  hump: { l: 'RAISED FLOOR', a: () => 'CLIMB', svg: '<path d="M6 4V36H14Q24 20 34 36H42V4"/><path d="M24 15V5M20 9L24 5L28 9"/>' },
  tunnel: { l: 'TUNNEL', a: () => 'STAY LOW', svg: '<path d="M6 36V12H42V36"/><path d="M2 12H46" stroke-width="5"/><path d="M24 19V31M20 27L24 31L28 27"/>' },
  pinch: { l: 'SIDEWAYS GAP', a: () => (input.device === 'touch' ? 'HOLD BANK' : 'HOLD CLICK'), svg: '<path d="M5 4L19 18V36"/><path d="M43 4L29 18V36"/><path d="M24 21V35" stroke-width="3.5"/><path d="M21 28H27"/>' },
  shoulder: { l: 'WALL IN', a: g => (g.side < 0 ? 'SHIFT RIGHT' : 'SHIFT LEFT'), svg: '<path d="M6 4V36"/><path d="M42 4L30 16V36"/><path d="M24 26H12M16 22L12 26L16 30"/>' },
  exit: { l: 'OPEN SPACE', a: () => 'FREE FLIGHT', svg: '<path d="M24 5L27 17L39 20L27 23L24 35L21 23L9 20L21 17Z"/>' },
  entry: { l: 'NEXT CORRIDOR', a: () => 'LINE UP', svg: '<path d="M6 36V8H42V36"/><path d="M16 36V17H32V36"/><path d="M24 22V31"/>' },
};
function makeSign(g) {
  const d = SIGN[g.kind] || SIGN.hump;
  const el = document.createElement('div');
  el.className = 'sign k-' + g.kind;
  const flip = g.kind === 'shoulder' && g.side < 0 ? ' transform="translate(48 0) scale(-1 1)"' : '';
  el.innerHTML = `<svg viewBox="0 0 48 40" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"${flip}>${d.svg}</g></svg>`
    + `<div class="sg-l">${d.l}</div><div class="sg-a">${d.a(g)}</div><div class="sg-t"></div>`;
  return el;
}

// ---------------- core objects ----------------
const sound = new Sound();
sound.sfxOn = settings.sfx;
sound.musicOn = settings.music;
const input = new Input();
input.bindBankButton($('btn-bank'));

let game;
try {
  game = new Game($('gl'), sound, input, hud);
} catch (err) {
  console.error(err);
  $('loading').innerHTML = '<span>WEBGL UNAVAILABLE — THIS DEVICE CANNOT RUN STARRUNNER</span>';
  throw err;
}
game.applySettings({ quality: settings.quality, blur: settings.blur, invertY: settings.invertY });
setTimeout(() => $('loading').classList.add('done'), 300);

// ---------------- screens ----------------
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function openPanel(id) { sound.init(); sound.click(); show(id, true); $(id).querySelector('.close-panel').focus({ preventScroll: true }); }
function closePanels() { show('panel-how', false); show('panel-settings', false); }

function launch() {
  sound.init();
  sound.click();
  closePanels();
  show('screen-title', false);
  show('screen-over', false);
  show('screen-pause', false);
  show('hud', true);
  Object.keys(cache).forEach(k => delete cache[k]);
  game.start(diffKey);
  document.activeElement?.blur?.();
}

function toMenu() {
  sound.click();
  show('screen-over', false);
  show('screen-pause', false);
  show('hud', false);
  show('screen-title', true);
  game.toMenu();
  refreshRecord();
}

function refreshRecord() {
  const r = records[diffKey];
  $('record').innerHTML = r ? `${DIFFS[diffKey].label} BEST <b>${r.score.toLocaleString()}</b> · REACHED SECTOR ${r.sector}` : `NO ${DIFFS[diffKey].label} RECORD YET`;
}

function setDiff(k) {
  diffKey = k;
  store.set('diff', k);
  document.querySelectorAll('.diff-opt').forEach(b => b.setAttribute('aria-checked', String(b.dataset.diff === k)));
  refreshRecord();
}
document.querySelectorAll('.diff-opt').forEach(b => b.addEventListener('click', () => { sound.init(); sound.click(); setDiff(b.dataset.diff); }));
setDiff(diffKey);

$('btn-launch').addEventListener('click', launch);
$('btn-retry').addEventListener('click', launch);
$('btn-menu').addEventListener('click', toMenu);
$('btn-how').addEventListener('click', () => openPanel('panel-how'));
$('btn-settings').addEventListener('click', () => openPanel('panel-settings'));
$('btn-pause-settings').addEventListener('click', () => openPanel('panel-settings'));
$('btn-pause').addEventListener('click', () => { sound.click(); game.pause(); });
$('btn-resume').addEventListener('click', () => { sound.click(); game.resume(); });
$('btn-quit').addEventListener('click', () => { game.state = 'menu'; toMenu(); });
document.querySelectorAll('.close-panel').forEach(b => b.addEventListener('click', () => { sound.click(); closePanels(); }));

window.addEventListener('keydown', e => {
  const panelOpen = !$('panel-how').classList.contains('hidden') || !$('panel-settings').classList.contains('hidden');
  if (e.code === 'Escape' && panelOpen) { closePanels(); return; }
  if (panelOpen) return;
  if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat && !e.target.closest('button')) {
    if (game.state === 'menu') { e.preventDefault(); launch(); }
    else if (game.state === 'over') { e.preventDefault(); launch(); }
  }
  if (game.state === 'menu') {
    const order = ['cadet', 'pilot', 'ace'];
    const i = order.indexOf(diffKey);
    if (e.code === 'ArrowLeft' && i > 0 && !e.target.closest('.menu')) setDiff(order[i - 1]);
    if (e.code === 'ArrowRight' && i < 2 && !e.target.closest('.menu')) setDiff(order[i + 1]);
  }
});
// first gesture unlocks audio
window.addEventListener('pointerdown', () => sound.init(), { once: true });
window.addEventListener('keydown', () => sound.init(), { once: true });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { game.pause(); sound.suspend(); }
  else sound.resume();
});

// ---------------- settings panel ----------------
const bindToggle = (id, key, apply) => {
  const el = $(id);
  el.checked = !!settings[key];
  el.addEventListener('change', () => { settings[key] = el.checked; store.set('settings', settings); apply(el.checked); sound.click(); });
};
bindToggle('s-sfx', 'sfx', v => sound.setSfx(v));
bindToggle('s-music', 'music', v => sound.setMusic(v));
const bBtns = [...document.querySelectorAll('#s-blur button')];
const markB = () => bBtns.forEach(b => b.classList.toggle('on', b.dataset.b === settings.blur));
bBtns.forEach(b => b.addEventListener('click', () => {
  settings.blur = b.dataset.b; store.set('settings', settings); markB(); game.applySettings({ blur: settings.blur }); sound.click();
}));
markB();
bindToggle('s-invert', 'invertY', v => game.applySettings({ invertY: v }));
const qBtns = [...document.querySelectorAll('#s-quality button')];
const markQ = () => qBtns.forEach(b => b.classList.toggle('on', b.dataset.q === settings.quality));
qBtns.forEach(b => b.addEventListener('click', () => {
  settings.quality = b.dataset.q; store.set('settings', settings); markQ(); game.applySettings({ quality: settings.quality }); sound.click();
}));
markQ();

// ---------------- PWA ----------------
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  show('btn-install', true);
});
$('btn-install').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => null);
  deferredInstall = null;
  show('btn-install', false);
});
window.addEventListener('appinstalled', () => show('btn-install', false));

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed', err)));
}

window.__starrunner = game; // handy for debugging in devtools
