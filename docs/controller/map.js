/* AirScope Controller — plano interactivo y mapa de calor. */
'use strict';

const hex3 = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
function rampFn(stops) {
  const s = stops.map(([v, c]) => [v, ...hex3(c)]);
  return v => {
    if (v <= s[0][0]) return s[0].slice(1);
    for (let i = 1; i < s.length; i++) if (v <= s[i][0]) {
      const t = (v - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return [0, 1, 2].map(k => s[i - 1][k + 1] + (s[i][k + 1] - s[i - 1][k + 1]) * t);
    }
    return s[s.length - 1].slice(1);
  };
}

const RSSI_STOPS = [[-95, '#5b21b6'], [-85, '#ef4444'], [-75, '#f97316'], [-67, '#eab308'], [-60, '#84cc16'], [-50, '#22c55e'], [-35, '#0f766e']];
const SNR_STOPS = [[0, '#7f1d1d'], [10, '#ef4444'], [18, '#f97316'], [25, '#eab308'], [32, '#84cc16'], [40, '#22c55e'], [50, '#0f766e']];
const RATE_STOPS = [[0, '#7f1d1d'], [25, '#ef4444'], [100, '#f97316'], [300, '#eab308'], [600, '#84cc16'], [1200, '#22c55e'], [2400, '#06b6d4']];
const CH_COLORS = ['#38bdf8', '#f472b6', '#facc15', '#4ade80', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171', '#a3e635', '#c084fc', '#60a5fa', '#fbbf24'];

const METRICS = {
  rssi:    { name: 'Señal (RSSI) del mejor AP', stops: RSSI_STOPS, ticks: [-90, -80, -70, -60, -50, -40], unit: 'dBm' },
  second:  { name: 'Señal del 2.º mejor AP (roaming)', stops: RSSI_STOPS, ticks: [-90, -80, -70, -60, -50, -40], unit: 'dBm' },
  snr:     { name: 'Relación señal/ruido (SNR)', stops: SNR_STOPS, ticks: [0, 10, 20, 30, 40, 50], unit: 'dB' },
  sinr:    { name: 'SINR (con interferencia co-canal)', stops: SNR_STOPS, ticks: [0, 10, 20, 30, 40, 50], unit: 'dB' },
  cci:     { name: 'Interferencia co-canal (APs ≥ -82 dBm)', discrete: [[0, '#22c55e', '0'], [1, '#84cc16', '1'], [2, '#eab308', '2'], [3, '#f97316', '3'], [4, '#ef4444', '4+']] },
  rate:    { name: 'Velocidad PHY (cliente 2x2)', stops: RATE_STOPS, ticks: [0, 300, 600, 1200, 2400], unit: 'Mbps' },
  thr:     { name: 'Throughput estimado por cliente', stops: RATE_STOPS, ticks: [0, 300, 600, 1200, 2400], unit: 'Mbps' },
  apcount: { name: 'Nº de APs con señal ≥ -75 dBm', discrete: [[0, '#ef4444', '0'], [1, '#f97316', '1'], [2, '#eab308', '2'], [3, '#84cc16', '3'], [4, '#22c55e', '4+']] },
  zones:   { name: 'Zonas de servicio (AP que atiende)', cat: 'ap' },
  channel: { name: 'Canal del AP que atiende', cat: 'channel' },
  req:     { name: 'Cumplimiento del perfil de requisitos', discrete: [[0, '#ef4444', 'No cumple'], [1, '#22c55e', 'Cumple']] },
};

const TOOLS = [
  ['select', 'cursor', 'Seleccionar y mover (V)', 'v'],
  ['pan', 'hand', 'Desplazar plano (H)', 'h'],
  ['ap', 'ap', 'Colocar punto de acceso (A)', 'a'],
  ['wall', 'wall', 'Dibujar muro (W)', 'w'],
  ['room', 'room', 'Dibujar sala rectangular (R)', 'r'],
  ['client', 'phone', 'Añadir cliente (C)', 'c'],
  '-',
  ['measure', 'ruler', 'Medir distancia (M)', 'm'],
  ['calib', 'scale', 'Calibrar escala del plano (K)', 'k'],
  ['walk', 'route', 'Recorrido de prueba / roaming (T)', 't'],
  '-',
  ['erase', 'eraser', 'Borrar elemento (E)', 'e'],
];

const MapView = (() => {
  const cv = $('#cv'), ctx = cv.getContext('2d');
  const stage = $('#stage');
  let CW = 0, CH = 0, dpr = 1;
  const vw = { scale: 20, ox: 40, oy: 40 };
  let tool = 'select', wallMat = 'drywall', apModelSel = 'AS-660E', cliTypeSel = 'phone';
  let sel = null, drag = null, draft = null, hover = null, measure = null;
  let heat = null, heatDirty = true, contours = [];
  const heatCv = document.createElement('canvas'), hctx = heatCv.getContext('2d');
  let img = null, imgSrc = null, blink = null, walk = null, walkAnim = null;
  const pointers = new Map();
  let pinch = null, spaceDown = false, raf = 0, fitted = false;

  const toW = (sx, sy) => ({ x: (sx - vw.ox) / vw.scale, y: (sy - vw.oy) / vw.scale });
  const toS = (x, y) => ({ x: vw.ox + x * vw.scale, y: vw.oy + y * vw.scale });
  const inFloor = p => ({ x: clamp(p.x, 0, P.floor.w), y: clamp(p.y, 0, P.floor.h) });
  const visible = () => $('#v-map').classList.contains('on');

  function heatOpts() {
    return { metric: P.heat.metric, band: P.heat.band, source: view.source, hidden: view.hidden, cutoff: P.heat.cutoff, profile: P.heat.profile };
  }

  /* --------------------------------------------------------------- tamaño */
  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    CW = r.width; CH = r.height;
    cv.width = Math.round(CW * dpr); cv.height = Math.round(CH * dpr);
    if (!fitted && CW > 0) { fit(); fitted = true; }
    draw();
  }

  function fit() {
    if (!CW) return;
    const pad = 36;
    vw.scale = Math.max(2, Math.min((CW - pad * 2) / P.floor.w, (CH - pad * 2) / P.floor.h));
    vw.ox = (CW - P.floor.w * vw.scale) / 2;
    vw.oy = (CH - P.floor.h * vw.scale) / 2;
    draw();
  }

  function zoomAt(f, sx = CW / 2, sy = CH / 2) {
    const p = toW(sx, sy);
    vw.scale = clamp(vw.scale * f, 1, 400);
    vw.ox = sx - p.x * vw.scale; vw.oy = sy - p.y * vw.scale;
    draw();
  }

  /* --------------------------------------------------------------- calor */
  function colorFor(m, v) {
    if (m.discrete) { const d = m.discrete; const k = Math.min(Math.round(v), d.length - 1); return hex3(d[Math.max(0, k)][1]); }
    if (m.cat === 'ap') return hex3(AP_COLORS[v % AP_COLORS.length]);
    if (m.cat === 'channel') return hex3(CH_COLORS[v % CH_COLORS.length]);
    return (m._fn ||= rampFn(m.stops))(v);
  }

  function buildHeat() {
    heatDirty = false;
    if (!P.aps.length) { heat = null; contours = []; renderStats(); return; }
    heat = Heat.compute(heatOpts());
    const g = heat.grid, m = METRICS[P.heat.metric];
    heatCv.width = g.cols; heatCv.height = g.rows;
    const im = hctx.createImageData(g.cols, g.rows), d = im.data;
    for (let i = 0; i < heat.val.length; i++) {
      const v = heat.val[i];
      if (Number.isNaN(v)) continue;
      const c = colorFor(m, v);
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    hctx.putImageData(im, 0, 0);
    contours = P.heat.contours && !Heat.coarse ? [[-67, contourSegs(heat.best, g, -67)], [-75, contourSegs(heat.best, g, -75)]] : [];
    renderStats();
    renderLegend();
  }

  /** Isolíneas por marching squares sobre el mapa de mejor señal. */
  function contourSegs(f, g, L) {
    const { cols, rows, res } = g, segs = [];
    const lerp = (a, b) => (L - a) / (b - a);
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = f[r * cols + c], b = f[r * cols + c + 1], C = f[(r + 1) * cols + c + 1], d = f[(r + 1) * cols + c];
      if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(C) || Number.isNaN(d)) continue;
      const k = (a >= L ? 8 : 0) | (b >= L ? 4 : 0) | (C >= L ? 2 : 0) | (d >= L ? 1 : 0);
      if (k === 0 || k === 15) continue;
      const x0 = (c + 0.5) * res, y0 = (r + 0.5) * res, x1 = x0 + res, y1 = y0 + res;
      const T = [x0 + lerp(a, b) * res, y0], Rt = [x1, y0 + lerp(b, C) * res], B = [x0 + lerp(d, C) * res, y1], Lf = [x0, y0 + lerp(a, d) * res];
      const S = { 1: [[Lf, B]], 2: [[B, Rt]], 3: [[Lf, Rt]], 4: [[T, Rt]], 5: [[T, Lf], [B, Rt]], 6: [[T, B]], 7: [[T, Lf]],
        8: [[T, Lf]], 9: [[T, B]], 10: [[T, Rt], [Lf, B]], 11: [[T, Rt]], 12: [[Lf, Rt]], 13: [[B, Rt]], 14: [[Lf, B]] }[k];
      for (const s of S) segs.push(s);
    }
    return segs;
  }

  function renderStats() {
    const el = $('#hmStats');
    if (!heat) { el.innerHTML = 'Coloca algún punto de acceso para ver el mapa de calor.'; return; }
    const s = heat.stats, pct = v => `${fmt(v / s.cells * 100)} %`;
    el.innerHTML = `Área ≥ -67 dBm: <b>${pct(s.c67)}</b> · ≥ -75 dBm: <b>${pct(s.c75)}</b><br>
      SNR media ${fmt(s.snr)} dB · throughput medio ${frate(s.thr)}<br>
      Cumple «${esc(PROFILES[P.heat.profile].name)}»: <b>${pct(s.pass)}</b>`;
  }

  function renderLegend() {
    const m = METRICS[P.heat.metric], el = $('#legend');
    let h = `<div class="t">${esc(m.name)}${P.heat.band !== 'all' ? ' · ' + RF.BAND_LABEL[P.heat.band] : ''}${view.source !== 'all' ? ' · ' + esc(P.aps.find(a => a.id === view.source)?.name) : ''}</div>`;
    if (m.stops) {
      const lo = m.ticks[0], hi = m.ticks[m.ticks.length - 1];
      const fn = m._fn ||= rampFn(m.stops);
      const g = Array.from({ length: 12 }, (_, i) => { const c = fn(lo + (hi - lo) * i / 11); return `rgb(${c.map(Math.round).join(',')})`; });
      h += `<div class="ramp" style="background:linear-gradient(90deg,${g.join(',')})"></div><div class="ticks">${m.ticks.map(t => `<span>${t}</span>`).join('')}</div><div class="ticks"><span></span><span>${m.unit}</span></div>`;
    } else if (m.discrete) {
      h += `<div class="cats">${m.discrete.map(([, c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;
    } else if (m.cat === 'ap') {
      h += `<div class="cats">${P.aps.filter(a => !view.hidden.has(a.id) && apUp(a)).map(a => `<span><i style="background:${apColor(a)}"></i>${esc(a.name)}</span>`).join('')}</div>`;
    } else if (heat) {
      const items = [...heat.chanIdx.entries()].map(([k, i]) => { const [b, ch, w] = k.split('|'); return `<span><i style="background:${CH_COLORS[i % CH_COLORS.length]}"></i>${RF.BAND_LABEL[b]} ${ch}/${w}</span>`; });
      h += `<div class="cats">${items.join('')}</div>`;
    }
    el.innerHTML = h;
  }

  /* -------------------------------------------------------------- dibujo */
  function requestDraw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }

  function draw(c = ctx, V = vw, w = CW, h = CH, scaleDpr = dpr, forExport = false) {
    if (!P || (!w && !forExport)) return;
    if (heatDirty) buildHeat();
    const S = (x, y) => [V.ox + x * V.scale, V.oy + y * V.scale];
    c.setTransform(scaleDpr, 0, 0, scaleDpr, 0, 0);
    c.fillStyle = '#070c18'; c.fillRect(0, 0, w, h);
    const [fx, fy] = S(0, 0), fw = P.floor.w * V.scale, fh = P.floor.h * V.scale;
    c.fillStyle = '#0e1628'; c.fillRect(fx, fy, fw, fh);
    if (img && img.complete && img.naturalWidth) {
      c.globalAlpha = P.floor.imgOpacity; c.drawImage(img, fx, fy, fw, fh); c.globalAlpha = 1;
    }
    if (P.floor.showGrid) drawGrid(c, V, fx, fy, fw, fh);
    if (heat) {
      c.save(); c.globalAlpha = P.heat.opacity / 100; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      const g = heat.grid;
      c.drawImage(heatCv, fx, fy, g.cols * g.res * V.scale, g.rows * g.res * V.scale);
      c.restore();
      for (const [lvl, segs] of contours) {
        c.beginPath();
        for (const [a, b] of segs) { const p = S(a[0], a[1]), q = S(b[0], b[1]); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); }
        c.strokeStyle = lvl === -67 ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.5)';
        c.setLineDash(lvl === -67 ? [] : [5, 4]); c.lineWidth = 1.3; c.stroke(); c.setLineDash([]);
      }
    }
    c.strokeStyle = '#2b3a5c'; c.lineWidth = 1; c.strokeRect(fx + .5, fy + .5, fw, fh);
    // muros
    const lwF = clamp(V.scale / 22, 0.7, 2.2);
    P.walls.forEach((wl, i) => {
      const m = RF.MATERIALS[wl.mat], a = S(wl.x1, wl.y1), b = S(wl.x2, wl.y2);
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
      const isSel = sel?.kind === 'wall' && sel.i === i;
      if (isSel) { c.strokeStyle = 'rgba(34,211,238,.45)'; c.lineWidth = m.w * lwF + 7; c.stroke(); }
      c.strokeStyle = m.color; c.lineWidth = m.w * lwF; c.lineCap = 'round'; c.stroke();
      if (isSel) for (const p of [a, b]) { c.beginPath(); c.arc(p[0], p[1], 5, 0, 7); c.fillStyle = '#22d3ee'; c.fill(); }
    });
    // enlaces de clientes
    const apById = id => P.aps.find(a => a.id === id);
    if (P.heat.links || sel?.kind === 'client') for (const cl of P.clients) {
      if (!cl.link || (!P.heat.links && sel.id !== cl.id)) continue;
      const ap = apById(cl.link.ap); if (!ap) continue;
      const a = S(cl.x, cl.y), b = S(ap.x, ap.y);
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
      c.strokeStyle = apColor(ap) + '99'; c.setLineDash([4, 4]); c.lineWidth = 1.2; c.stroke(); c.setLineDash([]);
    }
    // clientes
    for (const cl of P.clients) {
      const [x, y] = S(cl.x, cl.y);
      const ap = cl.link && apById(cl.link.ap);
      c.beginPath(); c.roundRect(x - 5, y - 7, 10, 14, 2.5);
      c.fillStyle = ap ? apColor(ap) : '#ef4444'; c.fill();
      c.strokeStyle = sel?.kind === 'client' && sel.id === cl.id ? '#fff' : '#0b1120'; c.lineWidth = sel?.kind === 'client' && sel.id === cl.id ? 2.5 : 1.5; c.stroke();
      if (V.scale > 14) { c.font = '600 10px Inter,sans-serif'; c.fillStyle = 'rgba(226,232,240,.8)'; c.textAlign = 'center'; c.fillText(cl.name, x, y + 18); }
    }
    // APs
    P.aps.forEach(ap => drawAp(c, S, ap));
    // recorrido
    if (P.walk?.pts?.length || draft?.kind === 'walk') drawWalk(c, S);
    // borradores
    drawDraft(c, S);
    if (!forExport) drawScaleBar(c, V, w, h);
  }

  function drawGrid(c, V, fx, fy, fw, fh) {
    const step = V.scale < 6 ? 10 : V.scale < 14 ? 5 : 1;
    c.save(); c.beginPath(); c.rect(fx, fy, fw, fh); c.clip();
    for (let m = 0; m <= Math.max(P.floor.w, P.floor.h); m += step) {
      const major = m % (step * 5) === 0;
      c.strokeStyle = major ? 'rgba(148,163,184,.13)' : 'rgba(148,163,184,.06)';
      c.lineWidth = 1;
      if (m <= P.floor.w) { const x = Math.round(fx + m * V.scale) + .5; c.beginPath(); c.moveTo(x, fy); c.lineTo(x, fy + fh); c.stroke(); }
      if (m <= P.floor.h) { const y = Math.round(fy + m * V.scale) + .5; c.beginPath(); c.moveTo(fx, y); c.lineTo(fx + fw, y); c.stroke(); }
    }
    c.restore();
  }

  function drawAp(c, S, ap) {
    const [x, y] = S(ap.x, ap.y), m = RF.MODELS[ap.model];
    const hidden = view.hidden.has(ap.id) || (view.source !== 'all' && view.source !== ap.id);
    const col = apColor(ap), isSel = sel?.kind === 'ap' && sel.id === ap.id;
    c.save();
    if (hidden) c.globalAlpha = 0.4;
    if (m.pattern !== 'omni') {
      const bw = m.beam[m.bands[m.bands.length - 1]] * Math.PI / 180, az = (ap.azimuth || 0) * Math.PI / 180;
      c.beginPath(); c.moveTo(x, y); c.arc(x, y, 34, az - bw / 2, az + bw / 2); c.closePath();
      c.fillStyle = col + '30'; c.fill(); c.strokeStyle = col + '90'; c.lineWidth = 1; c.stroke();
    }
    if (blink && blink.id === ap.id && Date.now() < blink.until) {
      const t = (Date.now() % 900) / 900;
      c.beginPath(); c.arc(x, y, 14 + t * 26, 0, 7); c.strokeStyle = `rgba(34,211,238,${1 - t})`; c.lineWidth = 3; c.stroke();
      requestDraw();
    }
    if (isSel) { c.beginPath(); c.arc(x, y, 18, 0, 7); c.fillStyle = 'rgba(34,211,238,.22)'; c.fill(); }
    c.beginPath(); c.arc(x, y, 12, 0, 7);
    c.fillStyle = '#0b1120'; c.fill();
    c.lineWidth = 3; c.strokeStyle = apUp(ap) ? col : '#ef4444';
    if (!apUp(ap)) c.setLineDash([3, 3]);
    c.stroke(); c.setLineDash([]);
    c.strokeStyle = apUp(ap) ? '#e2e8f0' : '#ef4444'; c.lineWidth = 1.6; c.lineCap = 'round';
    for (const r of [3.5, 6.5]) { c.beginPath(); c.arc(x, y + 3, r, -Math.PI * 0.78, -Math.PI * 0.22); c.stroke(); }
    c.beginPath(); c.arc(x, y + 3, 1.3, 0, 7); c.fillStyle = c.strokeStyle; c.fill();
    // etiqueta
    const ch = m.bands.filter(b => ap.radios[b]?.on).map(b => `${b === '2.4' ? '2.4' : b}:${ap.radios[b].ch}${b !== '2.4' || ap.radios[b].width > 20 ? '/' + ap.radios[b].width : ''}`).join('  ');
    c.font = '700 11px Inter,sans-serif';
    const t1 = ap.name + (apUp(ap) ? '' : ' (reiniciando)');
    c.font = '500 10px "JetBrains Mono",monospace';
    const w2 = c.measureText(ch).width;
    c.font = '700 11px Inter,sans-serif';
    const w = Math.max(c.measureText(t1).width, w2) + 12;
    c.beginPath(); c.roundRect(x - w / 2, y + 17, w, ch ? 31 : 18, 5);
    c.fillStyle = 'rgba(10,16,32,.88)'; c.fill(); c.strokeStyle = isSel ? '#22d3ee' : col + '80'; c.lineWidth = 1; c.stroke();
    c.fillStyle = '#e2e8f0'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillText(t1, x, y + 30);
    if (ch) { c.font = '500 10px "JetBrains Mono",monospace'; c.fillStyle = '#8a9bb8'; c.fillText(ch, x, y + 43); }
    c.restore();
  }

  function drawWalk(c, S) {
    const pts = draft?.kind === 'walk' ? draft.pts.concat(hover ? [hover] : []) : P.walk.pts;
    if (pts.length < 1) return;
    c.beginPath();
    pts.forEach((p, i) => { const [x, y] = S(p.x, p.y); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.strokeStyle = '#f472b6'; c.lineWidth = 2.5; c.setLineDash([7, 5]); c.stroke(); c.setLineDash([]);
    pts.forEach((p, i) => { const [x, y] = S(p.x, p.y); c.beginPath(); c.arc(x, y, i === 0 ? 5 : 3.5, 0, 7); c.fillStyle = '#f472b6'; c.fill(); });
    if (walk && draft?.kind !== 'walk') {
      for (const r of walk.roams) {
        const [x, y] = S(r.x, r.y);
        c.beginPath(); c.arc(x, y, 6, 0, 7); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = '#f472b6'; c.lineWidth = 2; c.stroke();
      }
      if (walkAnim) {
        const s = walk.samples[walkAnim.i];
        if (s) {
          const [x, y] = S(s.x, s.y);
          const ap = P.aps.find(a => a.id === s.ap);
          if (ap) { const [ax, ay] = S(ap.x, ap.y); c.beginPath(); c.moveTo(x, y); c.lineTo(ax, ay); c.strokeStyle = apColor(ap); c.lineWidth = 2; c.stroke(); }
          c.beginPath(); c.arc(x, y, 8, 0, 7); c.fillStyle = '#f472b6'; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
        }
      }
    }
  }

  function drawDraft(c, S) {
    const line = (a, b, col, label) => {
      const p = S(a.x, a.y), q = S(b.x, b.y);
      c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.strokeStyle = col; c.lineWidth = 2; c.setLineDash([6, 4]); c.stroke(); c.setLineDash([]);
      for (const z of [p, q]) { c.beginPath(); c.arc(z[0], z[1], 4, 0, 7); c.fillStyle = col; c.fill(); }
      if (label) {
        c.font = '700 12px Inter,sans-serif'; const tw = c.measureText(label).width + 12;
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2 - 14;
        c.fillStyle = 'rgba(10,16,32,.92)'; c.beginPath(); c.roundRect(mx - tw / 2, my - 11, tw, 20, 5); c.fill();
        c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(label, mx, my + 3);
      }
    };
    const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    if (draft?.kind === 'wall' && draft.pts.length) {
      const m = RF.MATERIALS[wallMat];
      for (let i = 1; i < draft.pts.length; i++) { const p = S(draft.pts[i - 1].x, draft.pts[i - 1].y), q = S(draft.pts[i].x, draft.pts[i].y); c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.strokeStyle = m.color; c.lineWidth = 3; c.stroke(); }
      if (hover) { const a = draft.pts[draft.pts.length - 1]; line(a, hover, m.color, `${fmt(dist(a, hover), 2)} m`); }
    }
    if (draft?.kind === 'room' && draft.b) {
      const a = S(draft.a.x, draft.a.y), b = S(draft.b.x, draft.b.y);
      c.strokeStyle = RF.MATERIALS[wallMat].color; c.lineWidth = 2.5; c.setLineDash([6, 4]); c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.setLineDash([]);
      c.font = '700 12px Inter,sans-serif'; c.fillStyle = '#fff'; c.textAlign = 'center';
      c.fillText(`${fmt(Math.abs(draft.b.x - draft.a.x), 1)} × ${fmt(Math.abs(draft.b.y - draft.a.y), 1)} m`, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    if ((draft?.kind === 'measure' || draft?.kind === 'calib') && draft.b) line(draft.a, draft.b, draft.kind === 'calib' ? '#facc15' : '#22d3ee', `${fmt(dist(draft.a, draft.b), 2)} m`);
    if (!draft && measure) line(measure.a, measure.b, '#22d3ee', `${fmt(dist(measure.a, measure.b), 2)} m`);
    if (hover && (tool === 'ap' || tool === 'client') && !drag) {
      const [x, y] = S(hover.x, hover.y);
      c.beginPath(); c.arc(x, y, tool === 'ap' ? 12 : 6, 0, 7); c.strokeStyle = 'rgba(34,211,238,.8)'; c.setLineDash([3, 3]); c.lineWidth = 1.5; c.stroke(); c.setLineDash([]);
    }
  }

  function drawScaleBar(c, V, w) {
    const target = 110 / V.scale, pow = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map(k => k * pow).find(k => k >= target * 0.6) || pow;
    const px = nice * V.scale, x = w - 16 - px, y = 22;
    c.fillStyle = 'rgba(13,20,38,.85)'; c.beginPath(); c.roundRect(x - 8, y - 14, px + 16, 26, 6); c.fill();
    c.strokeStyle = '#e2e8f0'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y + 4); c.lineTo(x, y + 7); c.lineTo(x + px, y + 7); c.lineTo(x + px, y + 4); c.stroke();
    c.font = '600 11px Inter,sans-serif'; c.fillStyle = '#e2e8f0'; c.textAlign = 'center'; c.fillText(`${fmt(nice, nice < 1 ? 1 : 0)} m`, x + px / 2, y + 1);
  }

  /* ---------------------------------------------------------- hit test */
  function hit(p) {
    const tol = 15 / vw.scale;
    for (let i = P.aps.length - 1; i >= 0; i--) { const a = P.aps[i]; if (Math.hypot(a.x - p.x, a.y - p.y) < tol) return { kind: 'ap', id: a.id }; }
    for (const cl of P.clients) if (Math.hypot(cl.x - p.x, cl.y - p.y) < 9 / vw.scale) return { kind: 'client', id: cl.id };
    let best = null, bd = 7 / vw.scale;
    P.walls.forEach((w, i) => {
      for (const [ex, ey, end] of [[w.x1, w.y1, 1], [w.x2, w.y2, 2]]) if (sel?.kind === 'wall' && sel.i === i && Math.hypot(ex - p.x, ey - p.y) < 9 / vw.scale) { best = { kind: 'wall', i, end }; bd = 0; }
      const d = segDist(p, w);
      if (d < bd) { bd = d; best = { kind: 'wall', i }; }
    });
    return best;
  }
  function segDist(p, w) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = dx * dx + dy * dy;
    const t = L ? clamp(((p.x - w.x1) * dx + (p.y - w.y1) * dy) / L, 0, 1) : 0;
    return Math.hypot(p.x - (w.x1 + t * dx), p.y - (w.y1 + t * dy));
  }

  function snap(p, from, noSnap) {
    p = inFloor(p);
    if (noSnap) return p;
    const tol = 10 / vw.scale;
    let best = null, bd = tol;
    for (const w of P.walls) for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) { const d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = { x, y }; } }
    if (draft?.pts) for (const q of draft.pts) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd && q !== from) { bd = d; best = { ...q }; } }
    if (best) return best;
    for (const [x, y] of [[0, 0], [P.floor.w, 0], [0, P.floor.h], [P.floor.w, P.floor.h]]) if (Math.hypot(x - p.x, y - p.y) < tol) return { x, y };
    if (from) {
      const ang = Math.abs(Math.atan2(p.y - from.y, p.x - from.x) * 180 / Math.PI);
      if (ang < 6 || ang > 174) p.y = from.y;
      else if (Math.abs(ang - 90) < 6) p.x = from.x;
    }
    return p;
  }

  /* --------------------------------------------------------- interacción */
  const pos = e => { const r = cv.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };

  function onDown(e) {
    cv.setPointerCapture(e.pointerId);
    const { sx, sy } = pos(e);
    pointers.set(e.pointerId, { sx, sy });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), scale: vw.scale, mid: toW((a.sx + b.sx) / 2, (a.sy + b.sy) / 2) };
      drag = null; return;
    }
    const p = toW(sx, sy);
    if (e.button === 1 || e.button === 2 && tool !== 'wall' && tool !== 'walk' || tool === 'pan' || spaceDown) { drag = { kind: 'pan', sx, sy, ox: vw.ox, oy: vw.oy }; return; }
    if (e.button === 2) { finishDraft(); return; }
    hideProbe();
    switch (tool) {
      case 'select': {
        const h = hit(p);
        if (!h) { select(null); drag = { kind: 'pan', sx, sy, ox: vw.ox, oy: vw.oy }; return; }
        if (h.kind === 'wall' && h.end) { const w = P.walls[h.i]; drag = { kind: 'wallEnd', i: h.i, end: h.end, ox: h.end === 1 ? w.x1 : w.x2, oy: h.end === 1 ? w.y1 : w.y2, moved: false }; return; }
        select(h);
        if (h.kind === 'ap') { const a = P.aps.find(x => x.id === h.id); drag = { kind: 'ap', ap: a, dx: a.x - p.x, dy: a.y - p.y, moved: false }; }
        if (h.kind === 'client') { const c = P.clients.find(x => x.id === h.id); drag = { kind: 'client', cl: c, dx: c.x - p.x, dy: c.y - p.y, moved: false }; }
        if (h.kind === 'wall') { const w = P.walls[h.i]; drag = { kind: 'wall', w, p0: p, o: { ...w }, moved: false }; }
        return;
      }
      case 'ap': {
        const q = inFloor(p);
        const ap = newAp(q.x, q.y, apModelSel);
        P.aps.push(ap);
        normalizeAp(ap);
        logEvent('ok', ap.name, `Punto de acceso ${ap.model} adoptado (${ap.ip})`);
        select({ kind: 'ap', id: ap.id });
        topologyChanged('AP añadido');
        return;
      }
      case 'client': {
        if (!P.wlans.some(w => w.on)) { toast('Crea o activa una WLAN para que los clientes puedan conectarse', 'warn'); }
        const q = inFloor(p);
        const cl = newClient(cliTypeSel, q.x, q.y);
        P.clients.push(cl); associate(cl);
        select({ kind: 'client', id: cl.id });
        changed(); return;
      }
      case 'wall': {
        const q = snap(p, draft?.pts?.[draft.pts.length - 1], e.altKey);
        if (!draft) { draft = { kind: 'wall', pts: [q] }; }
        else {
          const a = draft.pts[draft.pts.length - 1];
          if (Math.hypot(q.x - a.x, q.y - a.y) > 0.05) {
            P.walls.push({ x1: a.x, y1: a.y, x2: q.x, y2: q.y, mat: wallMat });
            draft.pts.push(q);
            geometryChanged(false);
          }
        }
        draw(); return;
      }
      case 'room': case 'measure': case 'calib': {
        const q = tool === 'room' ? snap(p, null, e.altKey) : inFloor(p);
        draft = { kind: tool, a: q, b: null }; measure = null; return;
      }
      case 'walk': {
        const q = inFloor(p);
        if (!draft) { draft = { kind: 'walk', pts: [q] }; walk = null; stopWalk(); }
        else draft.pts.push(q);
        draw(); return;
      }
      case 'erase': {
        const h = hit(p);
        if (h) removeItem(h);
        return;
      }
    }
  }

  function onMove(e) {
    const { sx, sy } = pos(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { sx, sy });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.sx - b.sx, a.sy - b.sy), mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
      vw.scale = clamp(pinch.scale * d / pinch.d, 1, 400);
      vw.ox = mx - pinch.mid.x * vw.scale; vw.oy = my - pinch.mid.y * vw.scale;
      requestDraw(); return;
    }
    const p = toW(sx, sy);
    hover = (tool === 'wall' && draft) ? snap(p, draft.pts[draft.pts.length - 1], e.altKey) : inFloor(p);
    if (drag) {
      switch (drag.kind) {
        case 'pan': vw.ox = drag.ox + sx - drag.sx; vw.oy = drag.oy + sy - drag.sy; break;
        case 'ap': {
          const q = inFloor({ x: p.x + drag.dx, y: p.y + drag.dy });
          drag.ap.x = q.x; drag.ap.y = q.y;
          if (!drag.moved) { drag.moved = true; Heat.coarse = true; }
          heatDirty = true; break;
        }
        case 'client': { const q = inFloor({ x: p.x + drag.dx, y: p.y + drag.dy }); drag.cl.x = q.x; drag.cl.y = q.y; drag.moved = true; associate(drag.cl, false); break; }
        case 'wall': {
          const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
          Object.assign(drag.w, { x1: drag.o.x1 + dx, y1: drag.o.y1 + dy, x2: drag.o.x2 + dx, y2: drag.o.y2 + dy });
          drag.moved = true; break;
        }
        case 'wallEnd': {
          const w = P.walls[drag.i];
          const other = drag.end === 1 ? { x: w.x2, y: w.y2 } : { x: w.x1, y: w.y1 };
          const q = snap(p, other, e.altKey);
          // mueve también los extremos unidos a este
          for (const o of P.walls) {
            if (Math.hypot(o.x1 - drag.ox, o.y1 - drag.oy) < 1e-6) { o.x1 = q.x; o.y1 = q.y; }
            if (Math.hypot(o.x2 - drag.ox, o.y2 - drag.oy) < 1e-6) { o.x2 = q.x; o.y2 = q.y; }
          }
          drag.ox = q.x; drag.oy = q.y; drag.moved = true; break;
        }
      }
      requestDraw(); return;
    }
    if (draft && (draft.kind === 'room' || draft.kind === 'measure' || draft.kind === 'calib') && pointers.size) {
      draft.b = draft.kind === 'room' ? snap(p, null, e.altKey) : inFloor(p);
    }
    if (tool === 'select' && !draft) {
      const h = hit(p);
      cv.style.cursor = h ? (h.kind === 'wall' && h.end ? 'crosshair' : 'move') : 'grab';
      if (!h && p.x >= 0 && p.y >= 0 && p.x <= P.floor.w && p.y <= P.floor.h && e.pointerType === 'mouse') showProbe(p, sx, sy); else hideProbe();
    } else {
      cv.style.cursor = tool === 'pan' ? 'grab' : tool === 'erase' ? 'not-allowed' : 'crosshair';
      hideProbe();
    }
    requestDraw();
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    const d = drag; drag = null;
    if (d?.kind === 'ap' && d.moved) {
      Heat.coarse = false; heatDirty = true;
      topologyChanged('AP movido');
    } else if (d?.kind === 'client' && d.moved) { associate(d.cl); changed(); }
    else if ((d?.kind === 'wall' || d?.kind === 'wallEnd') && d.moved) geometryChanged();
    if (draft && (draft.kind === 'room' || draft.kind === 'measure' || draft.kind === 'calib')) {
      const { a, b } = draft; draft = null;
      if (!b || Math.hypot(b.x - a.x, b.y - a.y) < 0.2) { draw(); return; }
      if (tool === 'room') {
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
        [[x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]].forEach(([p, q, r, s]) => P.walls.push({ x1: p, y1: q, x2: r, y2: s, mat: wallMat }));
        geometryChanged();
      } else if (tool === 'measure') { measure = { a, b }; }
      else calibrate(a, b);
      draw();
    }
  }

  function finishDraft() {
    if (draft?.kind === 'wall') { draft = null; geometryChanged(); }
    else if (draft?.kind === 'walk') {
      if (draft.pts.length >= 2) { P.walk = { pts: draft.pts, type: P.walk?.type || 'phone', speed: P.walk?.speed || 5 }; draft = null; computeWalk(); save(); }
      else draft = null;
    } else draft = null;
    draw();
  }

  function calibrate(a, b) {
    const cur = Math.hypot(b.x - a.x, b.y - a.y);
    Modal.open('Calibrar escala', `
      <p class="dim" style="margin-bottom:12px">Has marcado una distancia de <b>${fmt(cur, 2)} m</b> con la escala actual. Introduce la longitud real para reescalar el plano y todos sus elementos.</p>
      <div class="field"><label class="f">Longitud real (m)</label><input type="number" id="calLen" step="0.01" min="0.1" value="${cur.toFixed(2)}"></div>`,
    [['Cancelar'], ['Aplicar', 'primary', () => {
      const real = parseFloat($('#calLen').value);
      if (!(real > 0)) return false;
      rescale(real / cur);
      toast(`Plano recalibrado: ${fmt(P.floor.w, 1)} × ${fmt(P.floor.h, 1)} m`, 'ok');
    }]]);
    setTimeout(() => $('#calLen')?.select(), 50);
  }

  /** Escala el plano y todo su contenido por un factor k (calibración). */
  function rescale(kx, ky = kx) {
    P.floor.w *= kx; P.floor.h *= ky;
    for (const w of P.walls) { w.x1 *= kx; w.x2 *= kx; w.y1 *= ky; w.y2 *= ky; }
    for (const o of [...P.aps, ...P.clients]) { o.x *= kx; o.y *= ky; }
    if (P.walk) for (const q of P.walk.pts) { q.x *= kx; q.y *= ky; }
    measure = null; walk = null;
    geometryChanged();
    fit();
  }

  function removeItem(h) {
    if (h.kind === 'ap') {
      const ap = P.aps.find(a => a.id === h.id);
      P.aps = P.aps.filter(a => a !== ap);
      view.hidden.delete(ap.id); if (view.source === ap.id) view.source = 'all';
      logEvent('warn', ap.name, 'Punto de acceso eliminado del controlador');
      if (sel?.id === ap.id) sel = null;
      topologyChanged('AP eliminado');
    } else if (h.kind === 'client') {
      P.clients = P.clients.filter(c => c.id !== h.id);
      if (sel?.id === h.id) sel = null;
      changed();
    } else if (h.kind === 'wall') {
      P.walls.splice(h.i, 1);
      sel = null; geometryChanged();
    }
  }

  function select(h) { sel = h; renderSide(); draw(); }

  /* ------------------------------------------------------- notificaciones */
  function changed() { heatDirty = true; save(); UI.refresh(); }
  function topologyChanged(reason) {
    heatDirty = true; associateAll(); autoRrm(reason); save(); UI.refresh();
    if (walk) computeWalk();
  }
  function geometryChanged(full = true) {
    Heat.invalidate(); heatDirty = true;
    if (full) { associateAll(); autoRrm('cambio de muros'); if (walk) computeWalk(); }
    save(); if (full) UI.refresh(); else draw();
  }

  /* ----------------------------------------------------------- sonda */
  function showProbe(p, sx, sy) {
    const el = $('#probe');
    const o = heatOpts();
    const { S, rs, e } = Heat.probe(p.x, p.y, o);
    if (!e) { hideProbe(); return; }
    const rows = S.all.map((it, i) => ({ it, r: rs[i] })).filter(x => x.it.serv).sort((a, b) => b.r - a.r).slice(0, 5);
    const sig = v => `<span style="color:rgb(${rampFn(RSSI_STOPS)(v).map(Math.round)})">${fdbm(v)}</span>`;
    const p0 = PROFILES[o.profile];
    el.innerHTML = `<div class="h"><span>${fmt(p.x, 1)} m · ${fmt(p.y, 1)} m</span><span class="dim">${P.heat.band === 'all' ? 'Todas las bandas' : RF.BAND_LABEL[P.heat.band]}</span></div>
      <table>${rows.map(({ it, r }) => `<tr><td><span class="dot" style="background:${apColor(it.ap)}"></span>${esc(it.ap.name)}</td><td class="dim">${RF.BAND_LABEL[it.b]} · ${it.r.ch}/${it.r.width}</td><td>${sig(r)}</td></tr>`).join('')}</table>
      <div style="margin-top:5px">SNR <b>${fmt(e.snr)}</b> dB · SINR <b>${fmt(e.sinr)}</b> dB · co-canal <b>${e.cci}</b></div>
      <div>PHY <b>${frate(e.phy.rate)}</b> <span class="dim">(MCS ${e.phy.mcs < 0 ? '—' : e.phy.mcs} · ${e.phy.mod} · ${e.phy.ss} SS)</span></div>
      <div>Throughput estimado <b>${frate(e.thr)}</b></div>
      <div style="margin-top:4px">${e.fails.length ? `<span style="color:var(--bad)">✖ ${esc(p0.name)}: ${esc(e.fails.join(', '))}</span>` : `<span style="color:var(--good)">✔ Cumple «${esc(p0.name)}»</span>`}</div>`;
    el.classList.remove('hidden');
    const r = stage.getBoundingClientRect(), bw = el.offsetWidth, bh = el.offsetHeight;
    el.style.left = `${sx + 18 + bw > r.width ? sx - bw - 14 : sx + 18}px`;
    el.style.top = `${clamp(sy - 10, 8, r.height - bh - 8)}px`;
  }
  function hideProbe() { $('#probe').classList.add('hidden'); }

  /* -------------------------------------------------------- recorrido */
  function computeWalk() {
    if (!P.walk || P.walk.pts.length < 2) { walk = null; renderWalk(); return; }
    const type = P.walk.type;
    const ct = RF.CLIENT_TYPES[type];
    const wl = P.wlans.find(w => w.on && w.bands.some(b => ct.bands.includes(b)) && !/iot/i.test(w.ssid)) || P.wlans.find(w => w.on);
    const cl = { type, wlan: wl?.id, x: 0, y: 0, link: null };
    const samples = [], roams = [];
    let d = 0;
    const step = 0.25;
    const pts = P.walk.pts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L / step));
      for (let k = (i === 1 ? 0 : 1); k <= n; k++) {
        const t = k / n;
        cl.x = a.x + (b.x - a.x) * t; cl.y = a.y + (b.y - a.y) * t;
        const next = chooseLink(cl, candidates(cl), cl.link);
        const dd = d + L * t;
        if (next && cl.link && (next.ap !== cl.link.ap || next.band !== cl.link.band))
          roams.push({ d: dd, x: cl.x, y: cl.y, from: cl.link, to: next, t: Math.round(roamTime(wl)) });
        cl.link = next;
        samples.push({ d: dd, x: cl.x, y: cl.y, rssi: next ? next.rssi : NaN, ap: next?.ap, band: next?.band, snr: next?.snr, rate: next?.rate || 0 });
      }
      d += L;
    }
    walk = { samples, roams, length: d, wlan: wl };
    renderWalk();
    draw();
  }

  function stopWalk() { if (walkAnim) { cancelAnimationFrame(walkAnim.raf); walkAnim = null; } }

  function playWalk() {
    if (!walk) return;
    stopWalk();
    const speed = 1.4 * (P.walk.speed || 5);
    walkAnim = { t0: performance.now(), i: 0, raf: 0 };
    const tick = now => {
      if (!walkAnim) return;
      const d = (now - walkAnim.t0) / 1000 * speed;
      let i = walkAnim.i;
      while (i < walk.samples.length - 1 && walk.samples[i + 1].d <= d) i++;
      walkAnim.i = i;
      draw(); drawWalkChart();
      if (d >= walk.length) { walkAnim = null; drawWalkChart(); return; }
      walkAnim.raf = requestAnimationFrame(tick);
    };
    walkAnim.raf = requestAnimationFrame(tick);
  }

  function renderWalk() {
    const el = $('#walkPanel');
    if (!P.walk) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const s = walk?.samples || [];
    const valid = s.filter(x => Number.isFinite(x.rssi));
    const below67 = s.length ? s.filter(x => !(x.rssi >= -67)).length / s.length * 100 : 0;
    const minR = valid.length ? Math.min(...valid.map(x => x.rssi)) : NaN;
    const lost = s.filter(x => !x.ap).length;
    const apName = id => P.aps.find(a => a.id === id)?.name ?? '?';
    el.innerHTML = `<h2>Recorrido de prueba <span class="actions"><button class="btn sm" id="wkPlay">${ic(walkAnim ? 'stop' : 'play')}${walkAnim ? 'Parar' : 'Reproducir'}</button><button class="btn sm danger" id="wkDel">${ic('trash')}</button></span></h2>
      <div class="row field"><div><label class="f">Dispositivo</label><select id="wkType">${Object.entries(RF.CLIENT_TYPES).map(([k, t]) => `<option value="${k}" ${k === P.walk.type ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
        <div style="flex:.55"><label class="f">Velocidad</label><select id="wkSpeed">${[1, 2, 5, 10, 20].map(v => `<option value="${v}" ${v === P.walk.speed ? 'selected' : ''}>×${v}</option>`).join('')}</select></div></div>
      <canvas class="walk-chart" id="wkChart"></canvas>
      <div class="note" style="margin-top:8px">Longitud ${fmt(walk?.length || 0, 1)} m · ${walk?.roams.length || 0} roaming(s) · señal mínima ${fdbm(minR)} · ${fmt(below67)} % del trayecto &lt; -67 dBm${lost ? ` · <span style="color:var(--bad)">${fmt(lost / s.length * 100)} % sin conexión</span>` : ''}</div>
      ${walk?.roams.length ? `<div class="note" style="margin-top:6px">${walk.roams.map(r => `${fmt(r.d, 1)} m: ${esc(apName(r.from.ap))} → ${esc(apName(r.to.ap))} (${RF.BAND_LABEL[r.to.band]}, ${r.t} ms)`).join('<br>')}</div>` : ''}
      ${walk?.wlan ? `<div class="note">WLAN ${esc(walk.wlan.ssid)} · ${walk.wlan.ft ? '802.11r activo' : 'sin 802.11r'} · umbral de roaming ${P.rrm.roamTrigger} dBm</div>` : ''}`;
    $('#wkPlay').onclick = () => { if (walkAnim) { stopWalk(); renderWalk(); draw(); } else { playWalk(); renderWalk(); } };
    $('#wkDel').onclick = () => { stopWalk(); P.walk = null; walk = null; save(); renderWalk(); draw(); };
    $('#wkType').onchange = e => { P.walk.type = e.target.value; computeWalk(); save(); };
    $('#wkSpeed').onchange = e => { P.walk.speed = +e.target.value; save(); };
    requestAnimationFrame(drawWalkChart);
  }

  function drawWalkChart() {
    const c = $('#wkChart');
    if (!c || !walk) return;
    const w = c.clientWidth, h = c.clientHeight, r = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * r)) { c.width = Math.round(w * r); c.height = Math.round(h * r); }
    const g = c.getContext('2d');
    g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, w, h);
    const L = Math.max(walk.length, 0.1), lo = -95, hi = -30, padL = 28, padB = 14;
    const X = d => padL + (w - padL - 6) * d / L, Y = v => 6 + (h - 6 - padB) * (hi - clamp(v, lo, hi)) / (hi - lo);
    g.font = '10px Inter,sans-serif'; g.fillStyle = '#64748b'; g.textAlign = 'right';
    for (const v of [-90, -75, -67, -50, -30]) {
      g.strokeStyle = v === -67 ? 'rgba(234,179,8,.5)' : v === -75 ? 'rgba(249,115,22,.45)' : 'rgba(148,163,184,.12)';
      g.setLineDash(v === -67 || v === -75 ? [4, 3] : []); g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(w - 6, Y(v)); g.stroke(); g.setLineDash([]);
      g.fillText(v, padL - 4, Y(v) + 3);
    }
    g.textAlign = 'center'; g.fillText(`0`, padL, h - 2); g.fillText(`${fmt(L, 0)} m`, w - 18, h - 2);
    let prev = null;
    for (const s of walk.samples) {
      if (prev && Number.isFinite(prev.rssi) && Number.isFinite(s.rssi)) {
        const ap = P.aps.find(a => a.id === s.ap);
        g.strokeStyle = ap ? apColor(ap) : '#ef4444'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(X(prev.d), Y(prev.rssi)); g.lineTo(X(s.d), Y(s.rssi)); g.stroke();
      }
      prev = s;
    }
    for (const rm of walk.roams) { g.strokeStyle = 'rgba(244,114,182,.8)'; g.setLineDash([2, 2]); g.beginPath(); g.moveTo(X(rm.d), 6); g.lineTo(X(rm.d), h - padB); g.stroke(); g.setLineDash([]); }
    if (walkAnim) {
      const s = walk.samples[walkAnim.i];
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(s.d), 6); g.lineTo(X(s.d), h - padB); g.stroke();
      g.fillStyle = '#fff'; g.textAlign = X(s.d) > w - 70 ? 'right' : 'left';
      g.fillText(`${fdbm(s.rssi)} · ${P.aps.find(a => a.id === s.ap)?.name ?? 'sin conexión'}`, X(s.d) + (g.textAlign === 'right' ? -4 : 4), 16);
    }
  }

  /* ------------------------------------------------------- panel lateral */
  function setupControls() {
    $('#toolbar').innerHTML = TOOLS.map(t => t === '-' ? '<hr>' : `<button data-tool="${t[0]}" title="${t[2]}">${ic(t[1])}</button>`).join('');
    $$('#toolbar button').forEach(b => b.onclick = () => setTool(b.dataset.tool));
    $('#hmMetric').innerHTML = Object.entries(METRICS).map(([k, m]) => `<option value="${k}">${esc(m.name)}</option>`).join('');
    $('#hmProfile').innerHTML = Object.entries(PROFILES).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('');
    $('#hmBand').innerHTML = [['all', 'Todas'], ...RF.BANDS.map(b => [b, RF.BAND_LABEL[b]])].map(([k, l]) => `<button data-b="${k}">${l}</button>`).join('');
    $$('#hmBand button').forEach(b => b.onclick = () => { P.heat.band = b.dataset.b; heatChanged(); });
    $('#hmMetric').onchange = e => { P.heat.metric = e.target.value; heatChanged(); };
    $('#hmProfile').onchange = e => { P.heat.profile = e.target.value; heatChanged(); };
    $('#hmSource').onchange = e => { view.source = e.target.value; heatChanged(); };
    $('#hmCut').oninput = e => { P.heat.cutoff = +e.target.value; heatChanged(); };
    $('#hmOpacity').oninput = e => { P.heat.opacity = +e.target.value; $('#opOut').textContent = `${P.heat.opacity} %`; save(); draw(); };
    $('#hmContours').onchange = e => { P.heat.contours = e.target.checked; heatChanged(); };
    $('#hmLinks').onchange = e => { P.heat.links = e.target.checked; save(); draw(); };
    $('#allOn').onclick = () => { view.hidden.clear(); view.source = 'all'; heatChanged(); };
    $('#zIn').onclick = () => zoomAt(1.25); $('#zOut').onclick = () => zoomAt(0.8); $('#zFit').onclick = fit;
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', () => { hideProbe(); hover = null; requestDraw(); });
    cv.addEventListener('dblclick', () => finishDraft());
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('wheel', e => { e.preventDefault(); const { sx, sy } = pos(e); zoomAt(Math.exp(-e.deltaY * 0.0015), sx, sy); }, { passive: false });
    new ResizeObserver(resize).observe(stage);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });
  }

  function onKey(e) {
    if (!visible() || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) || $('.modal-bg')) return;
    if (e.code === 'Space') { spaceDown = true; e.preventDefault(); return; }
    if (e.key === 'Escape') { if (draft) finishDraft(); else select(null); return; }
    if (e.key === 'Enter' && draft) { finishDraft(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { removeItem(sel); e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = TOOLS.find(t => t !== '-' && t[3] === e.key.toLowerCase());
    if (t) setTool(t[0]);
  }

  function setTool(t) {
    if (draft) finishDraft();
    tool = t; measure = null;
    $$('#toolbar button').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    const hints = {
      select: '<b>Seleccionar:</b> arrastra APs, clientes o muros (extremos al seleccionarlo). Pasa el ratón por el plano para ver la sonda RF.',
      pan: '<b>Desplazar:</b> arrastra para mover el plano. Rueda o pellizco para hacer zoom.',
      ap: `<b>Colocar AP:</b> clic en el plano para instalar un ${apModelSel}.`,
      wall: `<b>Muro:</b> clic en cada vértice. Doble clic, Enter o Esc para terminar. Alt desactiva el ajuste. Material: ${RF.MATERIALS[wallMat].name}.`,
      room: `<b>Sala:</b> arrastra un rectángulo (4 muros de ${RF.MATERIALS[wallMat].name}).`,
      client: `<b>Cliente:</b> clic para añadir un ${RF.CLIENT_TYPES[cliTypeSel].name}.`,
      measure: '<b>Medir:</b> arrastra entre dos puntos.',
      calib: '<b>Calibrar:</b> arrastra sobre una distancia conocida del plano (una puerta mide ~0,9 m) e indica su longitud real.',
      walk: '<b>Recorrido:</b> clic para cada punto de la ruta, doble clic o Enter para simular el paseo y el roaming.',
      erase: '<b>Borrar:</b> clic sobre un AP, cliente o muro.',
    };
    $('#hint').innerHTML = hints[t];
    renderSide();
    draw();
  }

  function heatChanged() { heatDirty = true; save(); renderSide(); draw(); }

  function renderSide() {
    if (!P) return;
    $('#hmMetric').value = P.heat.metric;
    $('#hmProfile').value = P.heat.profile;
    $('#profField').style.display = P.heat.metric === 'req' ? '' : 'none';
    $$('#hmBand button').forEach(b => {
      b.classList.toggle('on', b.dataset.b === P.heat.band);
      b.disabled = b.dataset.b !== 'all' && !P.aps.some(a => a.radios[b.dataset.b]);
    });
    $('#hmSource').innerHTML = `<option value="all">Todos los APs visibles</option>` + P.aps.map(a => `<option value="${a.id}">Solo ${esc(a.name)}</option>`).join('');
    if (view.source !== 'all' && !P.aps.some(a => a.id === view.source)) view.source = 'all';
    $('#hmSource').value = view.source;
    $('#hmCut').value = P.heat.cutoff; $('#cutOut').textContent = `${P.heat.cutoff} dBm`;
    $('#hmOpacity').value = P.heat.opacity; $('#opOut').textContent = `${P.heat.opacity} %`;
    $('#hmContours').checked = P.heat.contours; $('#hmLinks').checked = P.heat.links;
    // lista de APs
    const counts = {};
    P.clients.forEach(c => { if (c.link) counts[c.link.ap] = (counts[c.link.ap] || 0) + 1; });
    $('#apList').innerHTML = P.aps.length ? P.aps.map(a => {
      const off = view.hidden.has(a.id);
      const ch = RF.MODELS[a.model].bands.filter(b => a.radios[b].on).map(b => a.radios[b].ch).join(' · ');
      return `<div class="ap-item ${sel?.kind === 'ap' && sel.id === a.id ? 'sel' : ''} ${off ? 'off' : ''}" data-id="${a.id}">
        <span class="sw" style="background:${apUp(a) ? apColor(a) : '#ef4444'}"></span><span class="nm">${esc(a.name)}</span>
        <span class="ch mono">${ch}</span><span class="ch">${counts[a.id] || 0}${ic('users').replace('<svg', '<svg style="width:11px;height:11px;vertical-align:-1px;margin-left:2px"')}</span>
        <button data-act="solo" class="${view.source === a.id ? 'solo-on' : ''}" title="Mapa de calor solo de este AP">${ic('solo')}</button>
        <button data-act="eye" title="${off ? 'Incluir' : 'Excluir'} en la simulación">${ic(off ? 'eyeoff' : 'eye')}</button></div>`;
    }).join('') : '<div class="dim" style="font-size:13px">Sin APs. Usa la herramienta «Colocar AP».</div>';
    $$('#apList .ap-item').forEach(el => {
      const id = el.dataset.id;
      el.onclick = e => {
        const act = e.target.closest('button')?.dataset.act;
        if (act === 'eye') { view.hidden.has(id) ? view.hidden.delete(id) : view.hidden.add(id); heatChanged(); }
        else if (act === 'solo') { view.source = view.source === id ? 'all' : id; view.hidden.delete(id); heatChanged(); }
        else { select({ kind: 'ap', id }); centerOn(P.aps.find(a => a.id === id)); }
      };
    });
    renderSel();
  }

  function centerOn(o) {
    if (!o) return;
    const s = toS(o.x, o.y);
    if (s.x < 40 || s.y < 40 || s.x > CW - 40 || s.y > CH - 40) { vw.ox += CW / 2 - s.x; vw.oy += CH / 2 - s.y; draw(); }
  }

  function renderSel() {
    const el = $('#selPanel');
    let h = '';
    if (tool === 'ap') h += `<h2>Herramienta: colocar AP</h2><div class="field"><label class="f">Modelo</label><select id="tModel">${Object.entries(RF.MODELS).map(([k, m]) => `<option value="${k}" ${k === apModelSel ? 'selected' : ''}>${m.name} — ${esc(m.desc)}</option>`).join('')}</select></div>`;
    if (tool === 'wall' || tool === 'room') h += `<h2>Herramienta: ${tool === 'wall' ? 'muro' : 'sala'}</h2><div class="field"><label class="f">Material</label><select id="tMat">${matOptions(wallMat)}</select></div><div class="note">${matNote(wallMat)}</div>`;
    if (tool === 'client') h += `<h2>Herramienta: cliente</h2><div class="field"><label class="f">Tipo de dispositivo</label><select id="tCli">${Object.entries(RF.CLIENT_TYPES).map(([k, t]) => `<option value="${k}" ${k === cliTypeSel ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>`;
    const s = sel;
    if (s?.kind === 'ap') {
      const ap = P.aps.find(a => a.id === s.id);
      if (ap) { el.innerHTML = h + '<div id="mapApEd"></div>'; ApEditor.render($('#mapApEd'), ap, { compact: true }); bindTools(); return; }
    } else if (s?.kind === 'wall' && P.walls[s.i]) {
      const w = P.walls[s.i];
      h += `<h2>Muro <span class="actions"><button class="btn sm danger" id="wDel">${ic('trash')}Borrar</button></span></h2>
        <div class="field"><label class="f">Material</label><select id="wMat">${matOptions(w.mat)}</select></div>
        <div class="note">${matNote(w.mat)}<br>Longitud ${fmt(Math.hypot(w.x2 - w.x1, w.y2 - w.y1), 2)} m · arrastra sus extremos para editarlo.</div>`;
    } else if (s?.kind === 'client') {
      const cl = P.clients.find(c => c.id === s.id);
      if (cl) h += clientCard(cl);
    } else if (!h) {
      h = `<h2>Plano</h2><div class="note" style="margin-top:0">${fmt(P.floor.w, 1)} × ${fmt(P.floor.h, 1)} m · ${P.walls.length} muros · ${P.aps.length} APs · ${P.clients.length} clientes<br>
        Selecciona un AP para cambiar su potencia, canales y anchos. Cambia el plano o sus dimensiones en <a data-go="project">Proyecto y plano</a>.</div>
        <div class="row" style="margin-top:10px"><button class="btn sm" id="exPng">${ic('download')}Exportar PNG</button><button class="btn sm" id="optRf">${ic('zap')}Optimizar RF</button></div>`;
    }
    el.innerHTML = h;
    bindTools();
    if (s?.kind === 'wall') {
      $('#wMat').onchange = e => { P.walls[s.i].mat = e.target.value; geometryChanged(); renderSel(); };
      $('#wDel').onclick = () => removeItem(s);
    }
    if (s?.kind === 'client') bindClientCard(P.clients.find(c => c.id === s.id));
    $('#exPng') && ($('#exPng').onclick = exportPng);
    $('#optRf') && ($('#optRf').onclick = () => UI.optimize());
    $$('[data-go]', el).forEach(a => a.onclick = () => UI.go(a.dataset.go));
  }

  function bindTools() {
    $('#tModel') && ($('#tModel').onchange = e => { apModelSel = e.target.value; setTool('ap'); });
    $('#tMat') && ($('#tMat').onchange = e => { wallMat = e.target.value; setTool(tool); });
    $('#tCli') && ($('#tCli').onchange = e => { cliTypeSel = e.target.value; setTool('client'); });
  }

  const matOptions = cur => Object.entries(RF.MATERIALS).map(([k, m]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  const matNote = k => { const l = RF.MATERIALS[k].loss; return `Atenuación: ${l['2.4']} dB (2,4) · ${l['5']} dB (5) · ${l['6']} dB (6 GHz)`; };

  function clientCard(cl) {
    const ct = RF.CLIENT_TYPES[cl.type], l = cl.link, ap = l && P.aps.find(a => a.id === l.ap);
    return `<h2>${esc(cl.name)} <span class="actions"><button class="btn sm danger" id="cDel">${ic('trash')}</button></span></h2>
      <div class="field"><label class="f">Tipo</label><select id="cType">${Object.entries(RF.CLIENT_TYPES).map(([k, t]) => `<option value="${k}" ${k === cl.type ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
      <div class="field"><label class="f">WLAN</label><select id="cWlan">${P.wlans.map(w => `<option value="${w.id}" ${w.id === cl.wlan ? 'selected' : ''}>${esc(w.ssid)}${w.on ? '' : ' (desactivada)'}</option>`).join('')}</select></div>
      ${l ? `<table><tr><td class="dim">AP</td><td><span class="dot" style="background:${apColor(ap)}"></span>${esc(ap.name)}</td></tr>
        <tr><td class="dim">Banda / canal</td><td>${RF.BAND_LABEL[l.band]} · ${l.ch} / ${l.width} MHz</td></tr>
        <tr><td class="dim">Señal (bajada)</td><td>${fdbm(l.rssi)}</td></tr>
        <tr><td class="dim">Señal (subida en AP)</td><td>${fdbm(l.ul)}</td></tr>
        <tr><td class="dim">SNR / SINR</td><td>${fmt(l.snr)} / ${fmt(l.sinr)} dB</td></tr>
        <tr><td class="dim">MCS</td><td>${l.mcs} · ${l.mod} · ${l.ss} SS</td></tr>
        <tr><td class="dim">PHY bajada / subida</td><td>${frate(l.rate)} / ${frate(l.ulRate)}</td></tr>
        <tr><td class="dim">Roamings</td><td>${cl.roams || 0}</td></tr></table>
        ${l.rssi - l.ul > 10 ? `<div class="note warn">Enlace asimétrico: el AP llega ${Math.round(l.rssi - l.ul)} dB más fuerte de lo que el cliente llega al AP.</div>` : ''}`
        : `<div class="note warn">Sin conexión: ninguna radio supera el RSSI mínimo (${P.rrm.minRssi} dBm) en las bandas de su WLAN.</div>`}
      <div class="note">${esc(ct.name)} · ${ct.ss}x${ct.ss} · ${ct.bands.map(b => RF.BAND_LABEL[b]).join(', ')} · hasta ${ct.maxWidth} MHz</div>`;
  }
  function bindClientCard(cl) {
    if (!cl) return;
    $('#cDel').onclick = () => removeItem({ kind: 'client', id: cl.id });
    $('#cType').onchange = e => { cl.type = e.target.value; associate(cl); changed(); };
    $('#cWlan').onchange = e => { cl.wlan = e.target.value; associate(cl); changed(); };
  }

  /* ---------------------------------------------------------- exportar */
  function exportPng() {
    const k = clamp(2400 / Math.max(P.floor.w, P.floor.h), 10, 80), pad = 30;
    const w = P.floor.w * k + pad * 2, h = P.floor.h * k + pad * 2 + 40;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    draw(g, { scale: k, ox: pad, oy: pad }, w, h, 1, true);
    g.font = '600 16px Inter,sans-serif'; g.fillStyle = '#e2e8f0'; g.textAlign = 'left';
    g.fillText(`${P.name} · ${METRICS[P.heat.metric].name}${P.heat.band !== 'all' ? ' · ' + RF.BAND_LABEL[P.heat.band] : ''}`, pad, h - 16);
    c.toBlob(b => downloadBlob(b, `${slug(P.name)}-mapa-calor.png`));
  }

  return {
    init() { setupControls(); setTool('select'); },
    refresh() {
      if (P.floor.image !== imgSrc) {
        imgSrc = P.floor.image;
        img = null;
        if (imgSrc) { img = new Image(); img.onload = () => draw(); img.src = imgSrc; }
      }
      heatDirty = true;
      if (sel?.kind === 'ap' && !P.aps.some(a => a.id === sel.id)) sel = null;
      if (sel?.kind === 'client' && !P.clients.some(c => c.id === sel.id)) sel = null;
      if (sel?.kind === 'wall' && !P.walls[sel.i]) sel = null;
      if (P.walk && !walk) computeWalk(); else renderWalk();
      renderSide();
      if (visible()) { if (!fitted) resize(); else draw(); }
    },
    shown() { resize(); if (!fitted) fit(); },
    fit, select, setTool, rescale, exportPng, centerOn,
    focusAp(id) { const ap = P.aps.find(a => a.id === id); select({ kind: 'ap', id }); centerOn(ap); },
    focusClient(id) { const c = P.clients.find(a => a.id === id); select({ kind: 'client', id }); centerOn(c); },
    locate(id) { blink = { id, until: Date.now() + 4000 }; draw(); },
    refit() { fitted = false; },
    invalidateHeat() { heatDirty = true; },
    redraw: draw,
    renderSel,
    get selection() { return sel; },
  };
})();
