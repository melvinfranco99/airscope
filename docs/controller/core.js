/* AirScope Controller — estado del proyecto, simulación de red y cálculo de mapas. */
'use strict';

/* ================================================================ utilidades */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (v, d = 0) => Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—';
const fdbm = v => Number.isFinite(v) ? `${Math.round(v)} dBm` : '—';
const fmw = d => { const m = RF.dbmToMw(d); return m >= 10 ? `${Math.round(m)} mW` : `${fmt(m, 1)} mW`; };
const frate = r => !r ? '—' : r >= 1000 ? `${fmt(r / 1000, 2)} Gbps` : `${Math.round(r)} Mbps`;
const uid = p => p + Math.random().toString(36).slice(2, 8);
const randHex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
const fdur = s => { s = Math.floor(s); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`; };

const ICONS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  map: '<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  ap: '<rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 17h.01M11 17h.01"/><path d="M8.5 9.5a5 5 0 0 1 7 0M6 7a8.5 8.5 0 0 1 12 0"/>',
  wave: '<path d="M2 12h3l3-8 4 16 3-8h7"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  cursor: '<path d="m4 4 7.07 16.97 2.51-7.39 7.39-2.51L4 4z"/>',
  wall: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9.3h18M3 14.6h18M9 4v5.3M15 9.3v5.3M9 14.6V20"/>',
  room: '<path d="M3 3h18v18H3z" stroke-dasharray="3 2"/><path d="M3 3h6M15 3h6"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  ruler: '<path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z"/><path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>',
  scale: '<circle cx="12" cy="12" r="9"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  eraser: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19"/><path d="M22 21H7M5 11l9 9"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M9.9 9.9a3 3 0 1 0 4.2 4.2M10.7 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a13 13 0 0 1-1.7 2.7M6.6 6.6A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20"/>',
  solo: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18.5 5.5"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  locate: '<circle cx="12" cy="10" r="3"/><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/>',
};
const ic = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;

const AP_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#facc15', '#4ade80', '#fb923c', '#60a5fa', '#f87171',
  '#2dd4bf', '#c084fc', '#a3e635', '#fbbf24', '#38bdf8', '#e879f9', '#34d399', '#fda4af'];
const apColor = ap => AP_COLORS[P.aps.indexOf(ap) % AP_COLORS.length];

const SECURITY = {
  open:    { name: 'Abierta', six: false },
  owe:     { name: 'OWE (Enhanced Open)', six: true },
  wpa2psk: { name: 'WPA2-Personal', six: false },
  wpa23:   { name: 'WPA2/WPA3-Personal (transición)', six: true },
  wpa3sae: { name: 'WPA3-Personal (SAE)', six: true },
  wpa2ent: { name: 'WPA2-Enterprise (802.1X)', six: false },
  wpa3ent: { name: 'WPA3-Enterprise (802.1X)', six: true },
};

const PROFILES = {
  voice: { name: 'Voz / vídeo en tiempo real', prim: -67, sec: -67, snr: 25, cci: 2 },
  data:  { name: 'Datos de alta velocidad',    prim: -67, sec: -75, snr: 25, cci: 3 },
  basic: { name: 'Navegación básica',          prim: -72, sec: null, snr: 18, cci: 4 },
  rtls:  { name: 'Localización (RTLS, 3 APs)', prim: -75, sec: -75, snr: 15, cci: null, aps: 3 },
  iot:   { name: 'IoT / sensores',             prim: -75, sec: null, snr: 12, cci: null },
};

const ENV_PRESETS = {
  open:     { name: 'Espacio abierto / nave',      ple: { '2.4': 2.0, '5': 2.0, '6': 2.1 } },
  office:   { name: 'Oficina (muros dibujados)',   ple: { '2.4': 2.4, '5': 2.6, '6': 2.7 } },
  dense:    { name: 'Oficina densa / mobiliario',  ple: { '2.4': 2.6, '5': 2.8, '6': 2.9 } },
  home:     { name: 'Vivienda',                    ple: { '2.4': 2.5, '5': 2.7, '6': 2.8 } },
  hospital: { name: 'Hospital / hotel',            ple: { '2.4': 2.8, '5': 3.0, '6': 3.1 } },
  custom:   { name: 'Personalizado',               ple: null },
};

// Carga de tráfico (% de tiempo de aire a 150 Mbps) por tipo de cliente.
const CLIENT_LOAD = { phone: 3, laptop: 6, tablet: 4, voip: 1, iot: 0.5 };

// Ganchos de interfaz (los rellena views.js).
const UI = { refresh() {}, badge() {} };

/* ==================================================================== estado */
const STORE_KEY = 'airscope-controller-v1';
let P = null;                                       // proyecto actual
const view = { hidden: new Set(), source: 'all' };   // estado de visualización (no persistente)

function defaultEnv() {
  return { preset: 'office', ple: { ...ENV_PRESETS.office.ple }, clientHeight: 1.0, noiseFigure: 7,
    ambient: { '2.4': 3, '5': 0, '6': 0 }, gridRes: 0.25 };
}

function defaultRrm() {
  return {
    dcaAuto: true, tpcAuto: true, set24: '1-6-11', avoidDfs: false, psc: true, neighbors: 3,
    tpc: { '2.4': { threshold: -70, min: 6, max: 17 }, '5': { threshold: -70, min: 9, max: 23 }, '6': { threshold: -70, min: 9, max: 23 } },
    bandSteering: true, minRssi: -82, roamTrigger: -72, roamDelta: 6, nol: {},
  };
}

function newProject(name = 'Proyecto nuevo', w = 30, h = 20) {
  return {
    v: 1, name, country: 'ES',
    floor: { w, h, image: null, imgW: 0, imgH: 0, imgOpacity: 0.85, showGrid: true },
    env: defaultEnv(), rrm: defaultRrm(), matLoss: {},
    walls: [], aps: [], clients: [], wlans: [], events: [], walk: null,
    heat: { metric: 'rssi', band: 'all', cutoff: -88, opacity: 85, profile: 'data', contours: false, links: false,
      outside: true, borders: true, overlap: true, conflict: true, v2: true },
  };
}

function newRadio(ap, band) {
  const m = RF.MODELS[ap.model];
  const width = band === '2.4' ? 20 : band === '5' ? Math.min(80, m.maxWidth[band]) : Math.min(160, m.maxWidth[band]);
  const ch = band === '2.4' ? 1 : band === '5' ? 36 : 5;
  return { on: true, ch, width, tx: Math.min(band === '2.4' ? 14 : 17, m.maxTx[band]), chMode: 'auto', txMode: 'auto' };
}

function newAp(x, y, model = 'AS-660E') {
  const n = P.aps.length + 1;
  let name = `AP-${String(n).padStart(2, '0')}`;
  for (let i = n; P.aps.some(a => a.name === name); i++) name = `AP-${String(i + 1).padStart(2, '0')}`;
  const used = new Set(P.aps.map(a => a.ip));
  let host = 10; while (used.has(`10.0.1.${host}`)) host++;
  const ap = { id: uid('ap'), name, model, x, y, h: 3, azimuth: 0, status: 'up', since: Date.now(),
    mac: `02:5A:1C:${randHex()}:${randHex()}:${randHex()}`, ip: `10.0.1.${host}`, radios: {} };
  for (const b of RF.MODELS[model].bands) ap.radios[b] = newRadio(ap, b);
  return ap;
}

function setModel(ap, model) {
  ap.model = model;
  const m = RF.MODELS[model];
  for (const b of RF.BANDS) {
    if (!m.bands.includes(b)) delete ap.radios[b];
    else if (!ap.radios[b]) ap.radios[b] = newRadio(ap, b);
  }
  if (m.pattern === 'omni') ap.azimuth = 0;
  normalizeAp(ap);
}

/** Límite de potencia conducida por normativa y hardware. */
function txLimit(ap, band) {
  const m = RF.MODELS[ap.model], r = ap.radios[band];
  return Math.floor(Math.min(m.maxTx[band], RF.maxEirp(P.country, band, r.ch, r.width) - m.gain[band]));
}

/** Ajusta ancho/canal/potencia a lo que permiten modelo y normativa. Devuelve avisos. */
function normalizeAp(ap) {
  const m = RF.MODELS[ap.model], notes = [];
  for (const b of m.bands) {
    const r = ap.radios[b];
    if (r.width > m.maxWidth[b]) r.width = m.maxWidth[b];
    if (!RF.validChannel(P.country, b, r.ch, r.width)) {
      let list = RF.channelsFor(P.country, b, r.width);
      while (!list.length && r.width > 20) { r.width /= 2; list = RF.channelsFor(P.country, b, r.width); }
      const blk = RF.block(b, r.ch, r.width);
      const old = r.ch;
      r.ch = list.find(c => blk.includes(c)) ?? list.reduce((a, c) => Math.abs(c - old) < Math.abs(a - old) ? c : a, list[0]);
      if (old !== r.ch) notes.push(`${ap.name} ${RF.BAND_LABEL[b]}: canal ${old} no válido, pasa a ${r.ch}`);
    }
    const lim = txLimit(ap, b);
    if (r.tx > lim) { notes.push(`${ap.name} ${RF.BAND_LABEL[b]}: potencia limitada a ${lim} dBm (normativa ${P.country})`); r.tx = lim; }
    if (r.tx < 1) r.tx = 1;
  }
  return notes;
}

/* ================================================================== eventos */
function logEvent(lv, src, msg) {
  P.events.unshift({ t: Date.now(), lv, src, msg });
  if (P.events.length > 500) P.events.length = 500;
  UI.badge?.();
}

function toast(msg, lv = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${lv}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3800);
}

/* ============================================================ persistencia */
let saveTimer = null, saveWarned = false;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(P)); }
    catch (e) {
      if (!saveWarned) { saveWarned = true; toast('No se pudo autoguardar (plano demasiado grande o almacenamiento bloqueado). Exporta el proyecto.', 'warn'); }
    }
  }, 400);
}

function applyMaterialOverrides() {
  for (const [k, v] of Object.entries(P.matLoss || {})) if (RF.MATERIALS[k]) Object.assign(RF.MATERIALS[k].loss, v);
}

function loadProject(obj) {
  const base = newProject();
  P = { ...base, ...obj, floor: { ...base.floor, ...obj.floor }, env: { ...base.env, ...obj.env },
    rrm: { ...base.rrm, ...obj.rrm, tpc: { ...base.rrm.tpc, ...(obj.rrm?.tpc || {}) } }, heat: { ...base.heat, ...obj.heat } };
  if (!obj.heat?.v2) Object.assign(P.heat, { opacity: 85, contours: false, v2: true });   // estilo de mapa nuevo
  P.walls = (P.walls || []).filter(w => RF.MATERIALS[w.mat]);
  P.aps = (P.aps || []).filter(a => RF.MODELS[a.model]);
  P.aps.forEach(a => { if (a.status !== 'up') a.status = 'up'; setModel(a, a.model); });
  view.hidden.clear(); view.source = 'all';
  applyMaterialOverrides();
  Heat.cache.clear(); Heat.invalidate();
  P.clients.forEach(c => { c.link = null; });
  associateAll(false);
}

/* ============================================================= radios / RRM */
function apUp(ap) { return ap.status === 'up'; }

function radioItems(band, filter = () => true) {
  const out = [];
  for (const ap of P.aps) {
    const r = ap.radios[band];
    if (!r || !r.on || !apUp(ap) || !filter(ap)) continue;
    out.push({ ap, model: RF.MODELS[ap.model], radio: r, band, limitTx: txLimit(ap, band) });
  }
  return out;
}

function set24() {
  return P.rrm.set24 === '1-5-9-13' ? [1, 5, 9, 13] : [1, 6, 11];
}

function runDca(band, { force = false, log = true } = {}) {
  const list = radioItems(band).map(it => ({ ...it, fixed: !force && it.radio.chMode !== 'auto' }));
  if (!list.length) return 0;
  const res = RF.dca(list, P.walls, P.env, band,
    { country: P.country, set24: set24(), avoidDfs: P.rrm.avoidDfs, psc: P.rrm.psc, blocked: P.rrm.nol });
  let changes = 0;
  list.forEach((it, i) => {
    if (res[i] !== it.radio.ch) {
      if (log) logEvent('info', 'DCA', `${it.ap.name} ${RF.BAND_LABEL[band]}: canal ${it.radio.ch} → ${res[i]}`);
      it.radio.ch = res[i]; changes++;
    }
    if (force) it.radio.chMode = 'auto';
  });
  P.aps.forEach(a => normalizeAp(a));
  return changes;
}

function runTpc(band, { log = true } = {}) {
  const items = radioItems(band);
  if (!items.length) return 0;
  const cfg = P.rrm.tpc[band];
  const res = RF.tpc(items, P.walls, P.env, band, { minTx: cfg.min, maxTx: cfg.max, threshold: cfg.threshold, neighbors: P.rrm.neighbors });
  let changes = 0;
  items.forEach((it, i) => {
    if (it.radio.txMode !== 'auto') return;
    if (res[i] !== it.radio.tx) {
      if (log) logEvent('info', 'TPC', `${it.ap.name} ${RF.BAND_LABEL[band]}: potencia ${it.radio.tx} → ${res[i]} dBm`);
      it.radio.tx = res[i]; changes++;
    }
  });
  return changes;
}

/** Re-ejecuta DCA/TPC automáticos tras un cambio de topología. */
let rrmTimer = null;
function autoRrm(reason) {
  if (!P.rrm.dcaAuto && !P.rrm.tpcAuto) return;
  clearTimeout(rrmTimer);
  rrmTimer = setTimeout(() => {
    let n = 0;
    for (const b of RF.BANDS) {
      if (P.rrm.tpcAuto) n += runTpc(b);
      if (P.rrm.dcaAuto) n += runDca(b);
    }
    if (n) {
      logEvent('ok', 'RRM', `Reoptimización automática (${reason}): ${n} cambio(s)`);
      associateAll();
      UI.refresh();
    }
  }, 350);
}

/** Mejor canal para una sola radio dejando el resto fijo (p. ej. tras radar). */
function bestChannelFor(ap, band) {
  const list = radioItems(band).map(it => ({ ...it, fixed: it.ap !== ap }));
  const res = RF.dca(list, P.walls, P.env, band,
    { country: P.country, set24: set24(), avoidDfs: true, psc: P.rrm.psc, blocked: P.rrm.nol });
  const i = list.findIndex(it => it.ap === ap);
  return i >= 0 ? res[i] : ap.radios[band].ch;
}

function simulateRadar(ap) {
  const r = ap.radios['5'];
  if (!r || !RF.isDfs('5', r.ch, r.width)) return;
  const blk = RF.block('5', r.ch, r.width).filter(c => RF.DFS.has(c));
  const until = Date.now() + 30 * 60 * 1000;
  blk.forEach(c => { P.rrm.nol[c] = until; });
  const old = r.ch;
  r.ch = bestChannelFor(ap, '5');
  if (RF.isDfs('5', r.ch, r.width)) {      // sin canal libre: reduce ancho
    r.width = 20; r.ch = bestChannelFor(ap, '5');
  }
  logEvent('crit', 'DFS', `Radar detectado por ${ap.name} en canal ${old} (${blk.join(',')}). Canales en NOL 30 min. Nuevo canal: ${r.ch}/${r.width} MHz`);
  normalizeAp(ap);
  associateAll();
}

function rebootAp(ap) {
  ap.status = 'boot';
  ap.bootUntil = Date.now() + 12000;
  logEvent('warn', ap.name, 'Reinicio solicitado por el administrador');
  associateAll();
}

/* ================================================================= clientes */
function clientWlan(cl) { return P.wlans.find(w => w.id === cl.wlan && w.on); }

function linkFor(cl, ap, band) {
  const m = RF.MODELS[ap.model], r = ap.radios[band], ct = RF.CLIENT_TYPES[cl.type];
  const pl = RF.pathLoss(P.walls, band, P.env.ple[band], ap.x, ap.y, ap.h, cl.x, cl.y, P.env.clientHeight);
  const pg = RF.patternGain(m, band, ap.azimuth || 0, Math.atan2(cl.y - ap.y, cl.x - ap.x));
  const rssi = r.tx + m.gain[band] + pg + ct.gain - pl;
  const ul = ct.tx[band] + ct.gain + m.gain[band] + pg - pl;
  const width = Math.min(r.width, ct.maxWidth);
  const nf = RF.noiseFloor(width, band, P.env);
  const sp = RF.span(band, r.ch, r.width);
  let I = 0;
  for (const o of P.aps) {
    if (o === ap || !apUp(o)) continue;
    const or = o.radios[band];
    if (!or || !or.on) continue;
    const ov = RF.overlap(sp, RF.span(band, or.ch, or.width));
    if (ov > 0) I += RF.dbmToMw(RF.rssiAt(o, RF.MODELS[o.model], band, or, P.walls, P.env, cl.x, cl.y, P.env.clientHeight, ct.gain)) * ov;
  }
  const snr = rssi - nf;
  const sinr = rssi - RF.mwToDbm(RF.dbmToMw(nf) + I);
  const gen = Math.min(m.gen, ct.gen), ss = Math.min(m.ss[band], ct.ss);
  const dl = RF.phyRate(snr, width, ss, gen), up = RF.phyRate(ul - nf, width, ss, gen);
  return { ap: ap.id, band, ch: r.ch, width, rssi, ul, snr, sinr, mcs: dl.mcs, ss: dl.ss, rate: dl.rate, mod: dl.mod, ulRate: up.rate };
}

function candidates(cl) {
  const wl = clientWlan(cl), ct = RF.CLIENT_TYPES[cl.type], out = [];
  if (!wl) return out;
  for (const ap of P.aps) {
    if (!apUp(ap)) continue;
    for (const b of ct.bands) {
      if (!wl.bands.includes(b) || !ap.radios[b]?.on) continue;
      const l = linkFor(cl, ap, b);
      if (l.rssi >= P.rrm.minRssi) out.push(l);
    }
  }
  const score = l => l.rssi + (P.rrm.bandSteering ? (l.band === '6' && l.rssi >= -70 ? 12 : l.band === '5' && l.rssi >= -72 ? 10 : 0) : 0);
  return out.sort((a, b) => score(b) - score(a));
}

function roamTime(wl) {
  if (wl.ft) return 30 + Math.random() * 25;
  if (wl.sec.endsWith('ent')) return 320 + Math.random() * 300;
  return 90 + Math.random() * 70;
}

/** Selección de AP con histéresis (cliente "pegajoso" como en la vida real). */
function chooseLink(cl, cands, prev) {
  if (!cands.length) return null;
  const cur = prev && cands.find(c => c.ap === prev.ap && c.band === prev.band);
  if (cur && cur.rssi >= P.rrm.roamTrigger) return cur;
  if (cur && cands[0].rssi < cur.rssi + P.rrm.roamDelta) return cur;
  return cands[0];
}

function associate(cl, log = true) {
  const prev = cl.link;
  const next = chooseLink(cl, candidates(cl), prev);
  const apName = id => P.aps.find(a => a.id === id)?.name ?? '?';
  if (log) {
    if (!next && prev) logEvent('warn', cl.name, `Desconectado: sin cobertura suficiente (último AP ${apName(prev.ap)})`);
    else if (next && !prev) logEvent('info', cl.name, `Asociado a ${apName(next.ap)} · ${RF.BAND_LABEL[next.band]} canal ${next.ch} (${fdbm(next.rssi)})`);
    else if (next && prev && (next.ap !== prev.ap || next.band !== prev.band)) {
      const wl = clientWlan(cl);
      cl.roams = (cl.roams || 0) + 1;
      const t = Math.round(roamTime(wl));
      const how = wl.ft ? '802.11r FT' : wl.sec.endsWith('ent') ? 'EAP completo' : 'SAE/4-way';
      logEvent(t > 300 ? 'warn' : 'info', cl.name,
        `Roaming ${apName(prev.ap)} ${RF.BAND_LABEL[prev.band]} → ${apName(next.ap)} ${RF.BAND_LABEL[next.band]} (${fdbm(next.rssi)}, ${how}, ${t} ms)`);
    }
  }
  cl.link = next;
}

function associateAll(log = true) { P.clients.forEach(c => associate(c, log)); }

function newClient(type, x, y) {
  const ct = RF.CLIENT_TYPES[type];
  const n = P.clients.filter(c => c.type === type).length + 1;
  const pref = { phone: 'Móvil', laptop: 'Portátil', tablet: 'Tablet', voip: 'VoIP', iot: 'Sensor' }[type];
  const on = P.wlans.filter(w => w.on && w.bands.some(b => ct.bands.includes(b)));
  let wl = type === 'iot' ? on.find(w => /iot/i.test(w.ssid)) : type === 'voip' ? on.find(w => w.sec.endsWith('ent')) : null;
  wl = wl || on.filter(w => !/iot/i.test(w.ssid))[Math.floor(Math.random() * Math.max(1, on.filter(w => !/iot/i.test(w.ssid)).length))] || on[0];
  return { id: uid('cl'), name: `${pref}-${String(n).padStart(2, '0')}`, type, x, y, wlan: wl?.id ?? null,
    mac: `${['3A', '7E', 'D2', '5C'][Math.floor(Math.random() * 4)]}:${randHex()}:${randHex()}:${randHex()}:${randHex()}:${randHex()}`, link: null, roams: 0 };
}

/* ============================================================ utilización */
function utilization() {
  const out = {};
  const items = [];
  for (const b of RF.BANDS) for (const it of radioItems(b)) items.push(it);
  const ssids = b => P.wlans.filter(w => w.on && w.bands.includes(b)).length;
  const minRate = P.wlans.filter(w => w.on).reduce((a, w) => Math.min(a, w.minRate || 6), 24);
  const own = items.map(it => {
    let l = RF.beaconAirtime(ssids(it.band), it.band, it.band === '2.4' ? minRate : 6);
    for (const c of P.clients) if (c.link && c.link.ap === it.ap.id && c.link.band === it.band)
      l += CLIENT_LOAD[c.type] * clamp(150 / Math.max(c.link.rate, 15), 0.5, 5);
    return l;
  });
  items.forEach((it, i) => {
    let u = own[i];
    const sp = RF.span(it.band, it.radio.ch, it.radio.width);
    items.forEach((o, j) => {
      if (i === j || o.band !== it.band) return;
      const ov = RF.overlap(sp, RF.span(o.band, o.radio.ch, o.radio.width));
      if (!ov) return;
      const heard = RF.rssiAt(o.ap, o.model, o.band, o.radio, P.walls, P.env, it.ap.x, it.ap.y, it.ap.h, it.model.gain[it.band]);
      if (heard >= -82) u += own[j] * ov;
    });
    out[`${it.ap.id}|${it.band}`] = clamp(u, 0, 100);
  });
  return out;
}

/** Vecinos RF que oye un AP (todas las bandas). */
function neighbors(ap) {
  const out = [];
  const m = RF.MODELS[ap.model];
  for (const o of P.aps) {
    if (o === ap || !apUp(o)) continue;
    for (const b of m.bands) {
      const or = o.radios[b];
      if (!or?.on) continue;
      const rssi = RF.rssiAt(o, RF.MODELS[o.model], b, or, P.walls, P.env, ap.x, ap.y, ap.h, m.gain[b]);
      if (rssi < -90) continue;
      const mine = ap.radios[b];
      const ov = mine?.on ? RF.overlap(RF.span(b, mine.ch, mine.width), RF.span(b, or.ch, or.width)) : 0;
      out.push({ ap: o, band: b, ch: or.ch, width: or.width, rssi, co: ov > 0 });
    }
  }
  return out.sort((a, b) => b.rssi - a.rssi);
}

/* ============================================================ mapas de calor */
const Heat = {
  geoVer: 0, cache: new Map(), grid: null,

  coarse: false,                                    // rejilla gruesa mientras se arrastra

  /** Rejilla de cálculo: el plano más un margen exterior (la señal sale del edificio). */
  getGrid() {
    const m = P.heat.outside ? clamp(Math.max(P.floor.w, P.floor.h) * 0.3, 4, 20) : 0;
    const W = P.floor.w + 2 * m, H = P.floor.h + 2 * m, max = this.coarse ? 10000 : 48000;
    let res = this.coarse ? Math.max(P.env.gridRes * 2, 0.5) : P.env.gridRes;
    if (W * H / (res * res) > max) res = Math.sqrt(W * H / max);
    const cols = Math.max(1, Math.ceil(W / res)), rows = Math.max(1, Math.ceil(H / res));
    const key = `${cols}x${rows}@${res.toFixed(4)}~${m.toFixed(2)}`;
    return { cols, rows, res, key, x0: -m, y0: -m };
  },

  invalidate() { this.geoVer++; },

  loss(ap) {
    const g = this.getGrid();
    const k = [ap.x, ap.y, ap.h, ap.azimuth || 0, ap.model, this.geoVer, g.key].join('|');
    const ck = `${ap.id}|${g.key}`;
    let e = this.cache.get(ck);
    if (!e || e.k !== k) {
      e = { k, m: RF.lossMap(ap, RF.MODELS[ap.model], P.walls, P.env, g) };
      this.cache.set(ck, e);
    }
    return e.m;
  },

  /** Radios que participan en el cálculo y estructuras auxiliares. */
  setup(band, source, hidden, withLoss) {
    const bands = band === 'all' ? RF.BANDS : [band];
    const all = [];
    P.aps.forEach((ap, ai) => {
      if (!apUp(ap) || hidden.has(ap.id)) return;
      const m = RF.MODELS[ap.model];
      const L = withLoss ? this.loss(ap) : null;
      for (const b of bands) {
        const r = ap.radios[b];
        if (!r?.on) continue;
        all.push({ ap, ai, b, r, m, L: L && L[b], txg: r.tx + m.gain[b], sp: RF.span(b, r.ch, r.width),
          nf: RF.noiseFloor(r.width, b, P.env), ss: Math.min(m.ss[b], 2), gen: m.gen, serv: source === 'all' || source === ap.id });
      }
    });
    const groups = new Map();
    all.forEach((it, i) => { if (it.serv) { if (!groups.has(it.ap.id)) groups.set(it.ap.id, []); groups.get(it.ap.id).push(i); } });
    const R = all.length;
    const ov = all.map((a, i) => {
      const row = new Float32Array(R);
      for (let j = 0; j < R; j++) {
        const o = all[j];
        if (j !== i && o.b === a.b && o.ap !== a.ap) row[j] = RF.overlap(a.sp, o.sp);
      }
      return row;
    });
    return { all, groups: [...groups.values()], ov };
  },

  /** Métricas en un punto a partir de los RSSI de cada radio. */
  evalPoint(rs, S, profile) {
    const { all, groups, ov } = S;
    let best = -Infinity, bi = -1, sec = -Infinity, n75 = 0;
    const steer = P.rrm.bandSteering;
    for (const g of groups) {
      // radio que usaría un cliente de ese AP (band steering hacia 5/6 GHz)
      let gb = -Infinity, gi = -1, gs = -Infinity;
      for (const i of g) {
        const v = rs[i], b = all[i].b;
        const sc = v + (steer ? (b === '6' && v >= -70 ? 12 : b === '5' && v >= -72 ? 10 : 0) : 0);
        if (sc > gs) { gs = sc; gb = v; gi = i; }
      }
      if (gb >= -75) n75++;
      if (gb > best) { sec = best; best = gb; bi = gi; } else if (gb > sec) sec = gb;
    }
    if (bi < 0) return null;
    const s = all[bi];
    const snr = best - s.nf;
    let I = 0, cci = 0;
    const row = ov[bi];
    for (let j = 0; j < rs.length; j++) {
      const o = row[j];
      if (o > 0) { I += Math.pow(10, rs[j] / 10) * o; if (rs[j] >= -82) cci++; }
    }
    const sinr = best - RF.mwToDbm(Math.pow(10, s.nf / 10) + I);
    const phy = RF.phyRate(snr, s.r.width, s.ss, s.gen);
    const thr = phy.rate * 0.7 / (1 + cci);
    const p = PROFILES[profile];
    const fails = [];
    if (p) {
      if (best < p.prim) fails.push(`señal ${Math.round(best)} < ${p.prim}`);
      if (p.sec != null && sec < p.sec) fails.push(`2.º AP ${Number.isFinite(sec) ? Math.round(sec) : '—'} < ${p.sec}`);
      if (snr < p.snr) fails.push(`SNR ${Math.round(snr)} < ${p.snr}`);
      if (p.cci != null && cci > p.cci) fails.push(`co-canal ${cci} > ${p.cci}`);
      if (p.aps && n75 < p.aps) fails.push(`${n75} APs ≥ -75 (< ${p.aps})`);
    }
    return { best, bi, sec, n75, snr, sinr, cci, phy, thr, fails, s };
  },

  /**
   * Campos en bruto sobre la rejilla (sin recortar por umbral): la métrica,
   * mejor y 2.ª señal, SNR, SINR y la señal de cada AP para dibujar fronteras.
   */
  compute({ metric, band, source, hidden, profile }) {
    const g = this.getGrid(), n = g.cols * g.rows;
    const S = this.setup(band, source, hidden, true);
    const R = S.all.length;
    const nan = () => new Float32Array(n).fill(NaN);
    const val = nan(), best = nan(), sec = nan(), snr = nan(), sinr = nan();
    const apF = S.groups.map(gr => ({ ai: S.all[gr[0]].ai, ap: S.all[gr[0]].ap, idx: gr, f: new Float32Array(n).fill(-200) }));
    const rs = new Float64Array(R);
    const st = { cells: 0, c67: 0, c75: 0, snr: 0, thr: 0, pass: 0, served: 0 };
    const chanIdx = new Map();
    for (let idx = 0; idx < n; idx++) {
      for (let i = 0; i < R; i++) rs[i] = S.all[i].txg - S.all[i].L[idx];
      for (const a of apF) { let b = -200; for (const i of a.idx) if (rs[i] > b) b = rs[i]; a.f[idx] = b; }
      const cx = g.x0 + (idx % g.cols + 0.5) * g.res, cy = g.y0 + (Math.floor(idx / g.cols) + 0.5) * g.res;
      const inside = cx >= 0 && cy >= 0 && cx <= P.floor.w && cy <= P.floor.h;
      if (inside) st.cells++;
      const e = this.evalPoint(rs, S, profile);
      if (!e) continue;
      best[idx] = e.best; sec[idx] = Number.isFinite(e.sec) ? e.sec : -200; snr[idx] = e.snr; sinr[idx] = e.sinr;
      if (!inside) { val[idx] = this.metricValue(metric, e, chanIdx); continue; }
      st.served++;
      if (e.best >= -67) st.c67++;
      if (e.best >= -75) st.c75++;
      st.snr += e.snr; st.thr += e.thr;
      if (!e.fails.length) st.pass++;
      val[idx] = this.metricValue(metric, e, chanIdx);
    }
    st.cells = Math.max(st.cells, 1);
    st.snr /= Math.max(st.served, 1); st.thr /= Math.max(st.served, 1);
    return { val, best, sec, snr, sinr, apF, grid: g, stats: st, chanIdx, radios: S.all };
  },

  metricValue(metric, e, chanIdx) {
      let v;
      switch (metric) {
        case 'rssi': v = e.best; break;
        case 'second': v = e.sec; break;
        case 'snr': v = e.snr; break;
        case 'sinr': v = e.sinr; break;
        case 'cci': v = e.cci; break;
        case 'rate': v = e.phy.rate; break;
        case 'thr': v = e.thr; break;
        case 'apcount': v = e.n75; break;
        case 'zones': v = e.s.ai; break;
        case 'channel': {
          const k = `${e.s.b}|${e.s.r.ch}|${e.s.r.width}`;
          if (!chanIdx.has(k)) chanIdx.set(k, chanIdx.size);
          v = chanIdx.get(k); break;
        }
        case 'req': v = e.fails.length ? 0 : 1; break;
      }
      return v;
  },

  probe(x, y, { band, source, hidden, profile }) {
    const S = this.setup(band, source, hidden, false);
    const rs = S.all.map(it => RF.rssiAt(it.ap, it.m, it.b, it.r, P.walls, P.env, x, y));
    return { S, rs, e: this.evalPoint(rs, S, profile) };
  },
};

/* ================================================================ análisis */
function analyze(stats) {
  const A = [];
  const add = (lv, msg) => A.push({ lv, msg });
  const down = P.aps.filter(a => !apUp(a));
  down.forEach(a => add('crit', `${a.name} no está operativo (reiniciando)`));
  if (!P.aps.length) add('warn', 'No hay puntos de acceso. Añádelos desde el plano.');
  if (!P.wlans.some(w => w.on)) add('crit', 'No hay ninguna WLAN activa: los clientes no pueden asociarse.');
  for (const b of RF.BANDS) {
    const items = radioItems(b);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], c = items[j];
      const ov = Math.max(RF.overlap(RF.span(b, a.radio.ch, a.radio.width), RF.span(b, c.radio.ch, c.radio.width)),
        RF.overlap(RF.span(b, c.radio.ch, c.radio.width), RF.span(b, a.radio.ch, a.radio.width)));
      if (!ov) continue;
      const heard = RF.rssiAt(a.ap, a.model, b, a.radio, P.walls, P.env, c.ap.x, c.ap.y, c.ap.h, c.model.gain[b]);
      if (heard < -78) continue;
      const same = a.radio.ch === c.radio.ch && a.radio.width === c.radio.width;
      add(heard > -65 ? 'crit' : 'warn', `${a.ap.name} y ${c.ap.name} ${same ? 'comparten' : 'solapan'} canal en ${RF.BAND_LABEL[b]} (${a.radio.ch}/${a.radio.width} y ${c.radio.ch}/${c.radio.width}) y se oyen a ${fdbm(heard)}`);
    }
    items.forEach(it => {
      const eirp = it.radio.tx + it.model.gain[b];
      const cli = b === '2.4' ? 15 : 14;
      if (eirp - cli > 8) add('warn', `${it.ap.name} ${RF.BAND_LABEL[b]}: PIRE ${Math.round(eirp)} dBm muy superior a la de un móvil (~${cli} dBm): enlace asimétrico`);
      if (b === '2.4' && it.radio.width === 40) add('warn', `${it.ap.name}: 40 MHz en 2,4 GHz solapa casi toda la banda`);
      if (b === '2.4' && it.radio.width === 20 && !set24().includes(it.radio.ch)) add('warn', `${it.ap.name}: canal ${it.radio.ch} en 2,4 GHz no es ${set24().join('/')} (interferencia de canal adyacente)`);
      if (b === '5' && RF.block(b, it.radio.ch, it.radio.width).some(c => RF.WEATHER_RADAR.has(c)))
        add('warn', `${it.ap.name}: canal ${it.radio.ch} incluye canales de radar meteorológico (CAC de 10 min)`);
    });
  }
  const dfsUse = radioItems('5').filter(it => RF.isDfs('5', it.radio.ch, it.radio.width));
  if (dfsUse.length) add('info', `${dfsUse.length} radio(s) de 5 GHz en canales DFS: pueden cambiar de canal si detectan radar`);
  for (const b of RF.BANDS) {
    const n = P.wlans.filter(w => w.on && w.bands.includes(b)).length;
    if (n > 4) add('warn', `${n} SSID en ${RF.BAND_LABEL[b]}: demasiados beacons (recomendado ≤ 3-4)`);
  }
  if (stats) {
    const hole = 1 - stats.c75 / stats.cells;
    if (P.aps.length && hole > 0.05) add(hole > 0.2 ? 'crit' : 'warn', `${fmt(hole * 100)} % del plano por debajo de -75 dBm (zonas sin cobertura)`);
  }
  const weak = P.clients.filter(c => c.link && c.link.rssi < -72);
  if (weak.length) add('warn', `${weak.length} cliente(s) con señal débil (< -72 dBm)`);
  const lost = P.clients.filter(c => !c.link);
  if (lost.length) add('crit', `${lost.length} cliente(s) sin conexión`);
  const util = utilization();
  Object.entries(util).forEach(([k, u]) => {
    if (u < 60) return;
    const [id, b] = k.split('|');
    add(u > 80 ? 'crit' : 'warn', `${P.aps.find(a => a.id === id)?.name} ${RF.BAND_LABEL[b]}: utilización de canal ${Math.round(u)} %`);
  });
  const order = { crit: 0, warn: 1, info: 2 };
  return A.sort((a, b) => order[a.lv] - order[b.lv]);
}

/* ===================================================== proyecto de ejemplo */
function demoProject() {
  P = newProject('Oficina central — Planta 1', 36, 22);
  const W = (x1, y1, x2, y2, mat) => P.walls.push({ x1, y1, x2, y2, mat });
  // fachada
  W(0, 0, 36, 0, 'concrete'); W(36, 0, 36, 22, 'concrete'); W(36, 22, 0, 22, 'concrete'); W(0, 22, 0, 0, 'concrete');
  // despachos al norte (pladur con puertas)
  for (const x of [6, 12, 18, 24]) W(x, 0, x, 6, 'drywall');
  for (const [a, b] of [[0, 2], [3.2, 8], [9.2, 14], [15.2, 20], [21.2, 26], [27.2, 30]]) W(a, 6, b, 6, 'drywall');
  for (const a of [2, 8, 14, 20, 26]) W(a, 6, a + 1.2, 6, 'wood');
  // sala de servidores
  W(30, 0, 30, 6, 'brick'); W(30, 6, 32, 6, 'brick'); W(33.2, 6, 36, 6, 'brick'); W(32, 6, 33.2, 6, 'metal');
  // núcleo: ascensor y escaleras
  W(16, 9, 18, 9, 'metal'); W(18, 9, 18, 12, 'metal'); W(18, 12, 16, 12, 'metal'); W(16, 12, 16, 9, 'metal');
  W(18, 9, 21, 9, 'heavy'); W(21, 9, 21, 12, 'heavy'); W(21, 12, 18, 12, 'heavy');
  // salas de reuniones acristaladas
  W(26, 14, 26, 22, 'glass'); W(26, 14, 29, 14, 'glass'); W(30.2, 14, 36, 14, 'glass'); W(29, 14, 30.2, 14, 'wood'); W(31, 14, 31, 22, 'glass');
  // aseos y office
  W(0, 16, 4, 16, 'brick'); W(5.2, 16, 7, 16, 'brick'); W(7, 16, 7, 22, 'brick'); W(4, 16, 5.2, 16, 'wood');
  // estanterías de archivo
  W(9, 13, 9, 19, 'shelf'); W(11, 13, 11, 19, 'shelf');
  P.wlans = [
    { id: uid('wl'), ssid: 'AirScope-Corp', on: true, sec: 'wpa3ent', bands: ['2.4', '5', '6'], vlan: 10, hidden: false, ft: true, k: true, v: true, isolation: false, minRate: 12, limit: 0 },
    { id: uid('wl'), ssid: 'AirScope-Invitados', on: true, sec: 'wpa23', bands: ['2.4', '5'], vlan: 50, hidden: false, ft: false, k: true, v: true, isolation: true, minRate: 12, limit: 20 },
    { id: uid('wl'), ssid: 'AirScope-IoT', on: true, sec: 'wpa2psk', bands: ['2.4'], vlan: 30, hidden: true, ft: false, k: false, v: false, isolation: true, minRate: 6, limit: 5 },
  ];
  const spots = [[5, 10, 'AS-660E', 'AP-Abierta-O'], [14.5, 3, 'AS-660E', 'AP-Despachos'], [25.5, 10, 'AS-770', 'AP-Abierta-E'],
    [31, 18, 'AS-660E', 'AP-Reuniones'], [12.5, 18.5, 'AS-660E', 'AP-Archivo']];
  for (const [x, y, m, name] of spots) { const ap = newAp(x, y, m); ap.name = name; P.aps.push(ap); }
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const types = ['phone', 'phone', 'laptop', 'laptop', 'tablet', 'voip', 'phone', 'laptop', 'iot', 'iot', 'phone', 'laptop', 'voip', 'phone'];
  types.forEach(t => P.clients.push(newClient(t, 1 + rnd() * 34, 1 + rnd() * 20)));
  for (const b of RF.BANDS) { runTpc(b, { log: false }); runDca(b, { log: false }); }
  associateAll(false);
  logEvent('ok', 'Sistema', 'Controlador iniciado con el proyecto de ejemplo');
  logEvent('info', 'RRM', 'DCA y TPC iniciales completados');
}
