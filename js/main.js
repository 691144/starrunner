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
  sfx: true, music: true, blur: true, invertY: false, autofire: coarse, quality: coarse ? 'medium' : 'high',
}, store.get('settings', {}));
let diffKey = store.get('diff', 'pilot');
let records = store.get('records', {}); // { pilot: {score, sector}, ... }

// ---------------- HUD ----------------
const SEG = 20;
const shieldBar = $('h-shield');
for (let i = 0; i < SEG; i++) shieldBar.appendChild(document.createElement('b'));
const segs = [...shieldBar.children];
const cache = {};
const setText = (el, key, v) => { if (cache[key] !== v) { cache[key] = v; el.textContent = v; } };
const reticle = $('reticle'), lockEl = $('lock');
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
    const sh = Math.max(0, Math.round(s.shield));
    if (cache.shield !== sh) {
      cache.shield = sh;
      $('h-shield-num').textContent = sh;
      const on = Math.ceil((sh / 100) * SEG);
      segs.forEach((b, i) => b.classList.toggle('off', i >= on));
      shieldBar.classList.toggle('warn', sh <= 50 && sh > 25);
      shieldBar.classList.toggle('crit', sh <= 25);
      $('damage-edge').classList.toggle('low', sh <= 25 && sh > 0);
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
  reticle(x, y, on) {
    if (!on) { reticle.style.display = 'none'; return; }
    reticle.style.display = 'block';
    reticle.style.transform = `translate(${(x * 0.5 + 0.5) * innerWidth}px, ${(-y * 0.5 + 0.5) * innerHeight}px)`;
  },
  lock(x, y, on) {
    lockEl.classList.toggle('on', on);
    if (on) lockEl.style.transform = `translate(${(x * 0.5 + 0.5) * innerWidth}px, ${(-y * 0.5 + 0.5) * innerHeight}px)`;
  },
  paused(p) { show('screen-pause', p); },
  gameOver(st) {
    const prev = records[st.difficulty];
    const isNew = !prev || st.score > prev.score;
    if (isNew) { records[st.difficulty] = { score: st.score, sector: st.sector }; store.set('records', records); }
    $('o-score').textContent = st.score.toLocaleString();
    $('o-sector').textContent = st.sector;
    $('o-kills').textContent = st.kills;
    $('o-close').textContent = st.closeCalls;
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

// ---------------- core objects ----------------
const sound = new Sound();
sound.sfxOn = settings.sfx;
sound.musicOn = settings.music;
const input = new Input();
input.bindFireButton($('btn-fire'));

let game;
try {
  game = new Game($('gl'), sound, input, hud);
} catch (err) {
  console.error(err);
  $('loading').innerHTML = '<span>WEBGL UNAVAILABLE — THIS DEVICE CANNOT RUN STARRUNNER</span>';
  throw err;
}
game.applySettings({ quality: settings.quality, blur: settings.blur, invertY: settings.invertY, autofire: settings.autofire });
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
  if ((e.code === 'Space' || e.code === 'Enter') && !e.target.closest('button')) {
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
bindToggle('s-blur', 'blur', v => game.applySettings({ blur: v }));
bindToggle('s-invert', 'invertY', v => game.applySettings({ invertY: v }));
bindToggle('s-autofire', 'autofire', v => game.applySettings({ autofire: v }));
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
