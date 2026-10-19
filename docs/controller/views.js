/* AirScope Controller — vistas de configuración y monitorización. */
'use strict';

const slug = s => (s || 'proyecto').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const bandTag = b => `<span class="tag b${b.replace('.', '')}">${RF.BAND_LABEL[b]}</span>`;
const lvColor = u => u > 80 ? 'var(--bad)' : u > 60 ? 'var(--weak)' : u > 40 ? 'var(--fair)' : 'var(--good)';

/* =================================================================== modal */
const Modal = {
  open(title, body, buttons = [['Cerrar']]) {
    this.close();
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog"><div class="mh">${esc(title)}<button aria-label="Cerrar">×</button></div><div class="mb">${body}</div>
      <div class="mf">${buttons.map(([l, cls], i) => `<button class="btn ${cls || ''}" data-i="${i}">${esc(l)}</button>`).join('')}</div></div>`;
    document.body.append(bg);
    bg.querySelector('.mh button').onclick = () => this.close();
    bg.addEventListener('mousedown', e => { if (e.target === bg) this.close(); });
    bg.querySelectorAll('.mf button').forEach(b => b.onclick = () => {
      const fn = buttons[+b.dataset.i][2];
      if (fn && fn() === false) return;
      this.close();
    });
    bg.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); if (e.key === 'Enter' && e.target.tagName === 'INPUT') bg.querySelector('.mf .primary')?.click(); });
    return bg;
  },
  close() { $('.modal-bg')?.remove(); },
  confirm(title, msg, label, fn, cls = 'danger') { this.open(title, `<p>${msg}</p>`, [['Cancelar'], [label, cls, fn]]); },
};

/* ======================================================= editor de AP */
const ApEditor = {
  render(el, ap, { compact = false } = {}) {
    const m = RF.MODELS[ap.model];
    const util = utilization();
    const counts = {};
    P.clients.forEach(c => { if (c.link?.ap === ap.id) counts[c.link.band] = (counts[c.link.band] || 0) + 1; });
    const acts = `<span class="actions">${compact ? `<button class="btn sm" data-a="detail" title="Detalle completo">${ic('list')}</button>` : `<button class="btn sm" data-a="map" title="Ver en el plano">${ic('map')}</button>`}
      <button class="btn sm" data-a="locate" title="Localizar (parpadeo LED)">${ic('locate')}</button>
      <button class="btn sm" data-a="dup" title="Duplicar">${ic('copy')}</button>
      <button class="btn sm" data-a="reboot" title="Reiniciar" ${apUp(ap) ? '' : 'disabled'}>${ic('refresh')}</button>
      <button class="btn sm danger" data-a="del" title="Eliminar">${ic('trash')}</button></span>`;
    let h = (compact ? `<h2><span class="dot" style="background:${apColor(ap)}"></span>${esc(ap.name)}</h2><div class="row" style="margin:-4px 0 12px">${acts}</div>`
      : `<h2><span class="dot" style="background:${apColor(ap)}"></span>${esc(ap.name)}${acts}</h2>`) + `
      ${apUp(ap) ? '' : `<div class="note warn" style="margin:-4px 0 10px">Reiniciando… vuelve en ${Math.max(0, Math.ceil((ap.bootUntil - Date.now()) / 1000))} s</div>`}
      <div class="${compact ? '' : 'cols'}"><div>
      <div class="row field"><div><label class="f">Nombre</label><input type="text" data-k="name" value="${esc(ap.name)}" maxlength="32"></div>
        <div><label class="f">Modelo</label><select data-k="model">${Object.entries(RF.MODELS).map(([k, x]) => `<option value="${k}" ${k === ap.model ? 'selected' : ''}>${x.name}</option>`).join('')}</select></div></div>
      <div class="note" style="margin:-6px 0 10px">${esc(m.desc)} · antena ${m.pattern === 'omni' ? 'omnidireccional' : m.pattern === 'wall' ? 'de pared' : 'sectorial'} · ganancia ${m.bands.map(b => `${m.gain[b]} dBi`).join(' / ')}</div>
      <div class="row field"><div><label class="f">X (m)</label><input type="number" data-k="x" step="0.1" value="${ap.x.toFixed(2)}"></div>
        <div><label class="f">Y (m)</label><input type="number" data-k="y" step="0.1" value="${ap.y.toFixed(2)}"></div>
        <div><label class="f">Altura (m)</label><input type="number" data-k="h" step="0.1" min="0.5" max="20" value="${ap.h}"></div></div>
      ${m.pattern !== 'omni' ? `<div class="field"><label class="f">Orientación de la antena <output class="mono">${ap.azimuth}°</output></label><input type="range" data-k="azimuth" min="0" max="359" step="1" value="${ap.azimuth}"></div>` : ''}
      ${compact ? '' : `<table style="margin-bottom:12px"><tr><td class="dim">MAC</td><td class="mono">${ap.mac}</td><td class="dim">IP</td><td class="mono">${ap.ip}</td></tr>
        <tr><td class="dim">Estado</td><td>${apUp(ap) ? '<span class="tag ok">En línea</span>' : '<span class="tag crit">Reiniciando</span>'}</td><td class="dim">Activo</td><td>${apUp(ap) ? fdur((Date.now() - ap.since) / 1000) : '—'}</td></tr></table>`}
      </div><div>`;
    for (const b of m.bands) {
      const r = ap.radios[b];
      const lim = txLimit(ap, b), eirp = r.tx + m.gain[b], reg = RF.maxEirp(P.country, b, r.ch, r.width);
      const chs = RF.channelsFor(P.country, b, r.width);
      const dfs = RF.isDfs(b, r.ch, r.width);
      const u = util[`${ap.id}|${b}`];
      const nol = c => P.rrm.nol[c] > Date.now();
      h += `<div class="radio-box ${r.on ? '' : 'dis'}" data-b="${b}">
        <div class="hd"><label class="chk" style="margin:0"><input type="checkbox" data-r="on" ${r.on ? 'checked' : ''}> Radio ${RF.BAND_LABEL[b]}</label>
          ${dfs ? '<span class="tag dfs">DFS</span>' : ''}<span class="tag">${counts[b] || 0} cli.</span></div>
        <div class="row field"><div><label class="f">Canal ${r.chMode === 'auto' ? '<span class="tag">DCA</span>' : ''}</label><select data-r="ch">
          <option value="auto" ${r.chMode === 'auto' ? 'selected' : ''}>Automático (DCA) — ${r.ch}</option>
          ${chs.map(c => `<option value="${c}" ${r.chMode !== 'auto' && c === r.ch ? 'selected' : ''} ${nol(c) ? 'disabled' : ''}>${c} · ${Math.round(RF.span(b, c, r.width)[2])} MHz${RF.isDfs(b, c, r.width) ? ' · DFS' : ''}${nol(c) ? ' · NOL' : ''}</option>`).join('')}
        </select></div>
        <div><label class="f">Potencia</label><select data-r="txMode"><option value="auto" ${r.txMode === 'auto' ? 'selected' : ''}>Automática (TPC)</option><option value="manual" ${r.txMode !== 'auto' ? 'selected' : ''}>Manual</option></select></div></div>
        <div class="field"><label class="f">Ancho de canal</label><div class="seg">${RF.WIDTHS[b].map(w => `<button data-w="${w}" class="${w === r.width ? 'on' : ''}" ${w > m.maxWidth[b] || !RF.channelsFor(P.country, b, w).length ? 'disabled' : ''}>${w} MHz</button>`).join('')}</div></div>
        <div class="field"><label class="f">Potencia de transmisión</label><div class="pw"><input type="range" data-r="tx" min="1" max="${lim}" step="1" value="${r.tx}"><output>${r.tx} dBm</output></div>
          <div class="note">${fmw(r.tx)} conducidos · PIRE ${fmt(eirp, 1)} dBm (límite ${P.country} ${fmt(reg, 0)} dBm · máx. hardware ${m.maxTx[b]} dBm)</div>
          ${eirp - (b === '2.4' ? 15 : 14) > 8 ? `<div class="note warn">PIRE muy por encima de la de un móvil típico: los clientes oirán el AP pero el AP no les oirá igual de bien.</div>` : ''}
        </div>
        <div class="note">Rango ${Math.round(RF.span(b, r.ch, r.width)[0])}–${Math.round(RF.span(b, r.ch, r.width)[1])} MHz · ${m.ss[b]}x${m.ss[b]} MIMO · ruido ${fmt(RF.noiseFloor(r.width, b, P.env), 0)} dBm${u != null ? ` · utilización ${Math.round(u)} %` : ''}</div>
        ${b === '5' && dfs && apUp(ap) && r.on ? `<button class="btn sm" data-r="radar" style="margin-top:8px">${ic('radar')}Simular detección de radar</button>` : ''}
      </div>`;
    }
    h += '</div></div>';
    if (!compact) {
      const nb = neighbors(ap);
      h += `<h3>Vecinos RF (lo que oye este AP)</h3><div class="tbl-wrap"><table><tr><th>AP</th><th>Banda</th><th>Canal</th><th>RSSI</th><th></th></tr>
        ${nb.slice(0, 14).map(n => `<tr><td><span class="dot" style="background:${apColor(n.ap)}"></span>${esc(n.ap.name)}</td><td>${bandTag(n.band)}</td><td class="mono">${n.ch}/${n.width}</td><td>${fdbm(n.rssi)}</td><td>${n.co ? `<span class="tag ${n.rssi > -82 ? 'crit' : 'warn'}">co-canal</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="dim">No oye a ningún otro AP</td></tr>'}</table></div>
        <h3>Clientes asociados</h3><div class="tbl-wrap"><table><tr><th>Cliente</th><th>Banda</th><th>RSSI</th><th>SNR</th><th>PHY</th></tr>
        ${P.clients.filter(c => c.link?.ap === ap.id).map(c => `<tr><td>${esc(c.name)}</td><td>${bandTag(c.link.band)}</td><td>${fdbm(c.link.rssi)}</td><td>${fmt(c.link.snr)} dB</td><td>${frate(c.link.rate)}</td></tr>`).join('') || '<tr><td colspan="5" class="dim">Sin clientes</td></tr>'}</table></div>`;
    }
    el.innerHTML = h;
    this.bind(el, ap, compact);
  },

  bind(el, ap, compact) {
    const rerender = () => this.render(el, ap, { compact });
    const commit = (topo, reason) => {
      MapView.invalidateHeat(); associateAll();
      if (topo) autoRrm(reason);
      save(); UI.refresh({ keepEditor: el });
      rerender();
    };
    el.querySelectorAll('[data-k]').forEach(inp => {
      const k = inp.dataset.k;
      inp.addEventListener(inp.type === 'range' ? 'input' : 'change', () => {
        if (k === 'name') { const v = inp.value.trim() || ap.name; logEvent('info', ap.name, `Renombrado a ${v}`); ap.name = v; save(); UI.refresh({ keepEditor: el }); rerender(); return; }
        if (k === 'model') { setModel(ap, inp.value); logEvent('info', ap.name, `Modelo cambiado a ${inp.value}`); commit(true, 'modelo de AP'); return; }
        if (k === 'azimuth') { ap.azimuth = +inp.value; inp.previousElementSibling.querySelector('output').textContent = `${ap.azimuth}°`; MapView.preview(); clearTimeout(this._az); this._az = setTimeout(() => { MapView.full(); commit(true, 'orientación'); }, 300); return; }
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v)) return;
        if (k === 'x') ap.x = clamp(v, 0, P.floor.w);
        if (k === 'y') ap.y = clamp(v, 0, P.floor.h);
        if (k === 'h') ap.h = clamp(v, 0.5, 20);
        commit(true, 'AP movido');
      });
    });
    el.querySelectorAll('.radio-box').forEach(box => {
      const b = box.dataset.b, r = ap.radios[b];
      box.querySelector('[data-r=on]').onchange = e => {
        r.on = e.target.checked;
        logEvent(r.on ? 'info' : 'warn', ap.name, `Radio ${RF.BAND_LABEL[b]} ${r.on ? 'activada' : 'desactivada'}`);
        commit(true, 'radio activada/desactivada');
      };
      box.querySelector('[data-r=ch]').onchange = e => {
        if (e.target.value === 'auto') { r.chMode = 'auto'; r.ch = bestChannelFor(ap, b); logEvent('info', ap.name, `${RF.BAND_LABEL[b]}: canal automático (DCA → ${r.ch})`); }
        else {
          r.chMode = 'manual'; const old = r.ch; r.ch = +e.target.value;
          logEvent('info', ap.name, `${RF.BAND_LABEL[b]}: canal ${old} → ${r.ch} (manual)`);
          if (b === '5' && RF.isDfs(b, r.ch, r.width)) logEvent('info', ap.name, `Canal DFS ${r.ch}: CAC de ${RF.block(b, r.ch, r.width).some(c => RF.WEATHER_RADAR.has(c)) ? '10 min' : '60 s'} antes de emitir`);
        }
        normalizeAp(ap).forEach(n => logEvent('warn', ap.name, n));
        commit(false);
      };
      box.querySelector('[data-r=txMode]').onchange = e => {
        r.txMode = e.target.value;
        if (r.txMode === 'auto') runTpc(b);
        logEvent('info', ap.name, `${RF.BAND_LABEL[b]}: potencia ${r.txMode === 'auto' ? 'automática (TPC)' : 'manual'}`);
        commit(false);
      };
      const tx = box.querySelector('[data-r=tx]');
      tx.oninput = () => {
        r.tx = +tx.value; r.txMode = 'manual';
        tx.nextElementSibling.textContent = `${r.tx} dBm`;
        MapView.preview();
      };
      tx.onchange = () => {
        Heat.coarse = false; logEvent('info', ap.name, `${RF.BAND_LABEL[b]}: potencia ${r.tx} dBm (${fmw(r.tx)}, manual)`); commit(false); };
      box.querySelectorAll('[data-w]').forEach(btn => btn.onclick = () => {
        const w = +btn.dataset.w; if (w === r.width) return;
        r.width = w;
        normalizeAp(ap).forEach(n => logEvent('warn', ap.name, n));
        if (r.chMode === 'auto') r.ch = bestChannelFor(ap, b);
        logEvent('info', ap.name, `${RF.BAND_LABEL[b]}: ancho ${w} MHz, canal ${r.ch}`);
        commit(false);
      });
      const rd = box.querySelector('[data-r=radar]');
      if (rd) rd.onclick = () => { simulateRadar(ap); toast(`Radar detectado: ${ap.name} cambia de canal`, 'crit'); commit(false); };
    });
    el.querySelectorAll('[data-a]').forEach(btn => btn.onclick = () => {
      const a = btn.dataset.a;
      if (a === 'map') { UI.go('map'); MapView.focusAp(ap.id); }
      if (a === 'detail') { UI.go('aps'); APs.open(ap.id); }
      if (a === 'locate') { UI.go('map'); MapView.focusAp(ap.id); MapView.locate(ap.id); logEvent('info', ap.name, 'LED de localización activado'); }
      if (a === 'reboot') { rebootAp(ap); MapView.invalidateHeat(); UI.refresh(); rerender(); }
      if (a === 'dup') {
        const n = newAp(clamp(ap.x + 3, 0, P.floor.w), ap.y, ap.model);
        n.h = ap.h; n.azimuth = ap.azimuth;
        for (const b of Object.keys(ap.radios)) n.radios[b] = { ...ap.radios[b] };
        P.aps.push(n); logEvent('ok', n.name, `Duplicado de ${ap.name}`);
        MapView.invalidateHeat(); associateAll(); autoRrm('AP añadido'); save(); UI.refresh();
        if (compact) MapView.focusAp(n.id); else APs.open(n.id);
      }
      if (a === 'del') Modal.confirm('Eliminar punto de acceso', `¿Eliminar <b>${esc(ap.name)}</b> del controlador?`, 'Eliminar', () => {
        P.aps = P.aps.filter(x => x !== ap); view.hidden.delete(ap.id);
        logEvent('warn', ap.name, 'Punto de acceso eliminado del controlador');
        MapView.invalidateHeat(); associateAll(); autoRrm('AP eliminado'); save(); APs.openId = null; UI.refresh();
      });
    });
  },
};

/* ================================================================= panel */
const Dash = {
  render() {
    const heat = Heat.compute({ metric: 'rssi', band: 'all', source: 'all', hidden: new Set(), cutoff: -200, profile: P.heat.profile });
    const s = heat.stats;
    const up = P.aps.filter(apUp).length;
    const conn = P.clients.filter(c => c.link);
    const avg = conn.length ? conn.reduce((a, c) => a + c.link.rssi, 0) / conn.length : NaN;
    const avgSnr = conn.length ? conn.reduce((a, c) => a + c.link.snr, 0) / conn.length : NaN;
    const agg = conn.reduce((a, c) => a + c.link.rate * 0.7, 0);
    const radios = RF.BANDS.reduce((n, b) => n + radioItems(b).length, 0);
    const alerts = analyze(s);
    const crit = alerts.filter(a => a.lv === 'crit').length;
    const kpi = (l, v, sub, col) => `<div class="kpi"><div class="l">${l}</div><div class="v" ${col ? `style="color:${col}"` : ''}>${v}</div><div class="s">${sub}</div></div>`;
    const pct = v => `${fmt(v / s.cells * 100)}<small>%</small>`;
    $('#kpis').innerHTML = [
      kpi('Puntos de acceso', `${up}<small>/ ${P.aps.length}</small>`, `${radios} radios activas`, up < P.aps.length ? 'var(--fair)' : null),
      kpi('Clientes', `${conn.length}<small>/ ${P.clients.length}</small>`, `RSSI medio ${fdbm(avg)}`, conn.length < P.clients.length ? 'var(--fair)' : null),
      kpi('Cobertura ≥ -67 dBm', P.aps.length ? pct(s.c67) : '—', 'Voz y datos exigentes'),
      kpi('Cobertura ≥ -75 dBm', P.aps.length ? pct(s.c75) : '—', 'Conectividad básica'),
      kpi('SNR media (clientes)', Number.isFinite(avgSnr) ? `${fmt(avgSnr)}<small>dB</small>` : '—', 'Objetivo ≥ 25 dB'),
      kpi('Capacidad agregada', frate(agg), 'Suma estimada (PHY × 0,7)'),
      kpi('Alertas', `${alerts.filter(a => a.lv !== 'info').length}`, `${crit} críticas`, crit ? 'var(--bad)' : null),
    ].join('');
    const icn = { crit: '<span class="lv crit">CRÍTICO</span>', warn: '<span class="lv warn">AVISO</span>', info: '<span class="lv info">INFO</span>' };
    $('#alerts').innerHTML = alerts.length
      ? `<table>${alerts.slice(0, 14).map(a => `<tr><td style="width:1%">${icn[a.lv]}</td><td style="white-space:normal">${esc(a.msg)}</td></tr>`).join('')}</table>
         ${alerts.length > 14 ? `<div class="note">… y ${alerts.length - 14} más</div>` : ''}
         <div style="margin-top:10px"><button class="btn sm" id="dashOpt">${ic('zap')}Optimizar RF (DCA + TPC)</button></div>`
      : '<div class="dim">Sin alertas. La red simulada está sana.</div>';
    $('#dashOpt') && ($('#dashOpt').onclick = () => UI.optimize());
    const byBand = RF.BANDS.map(b => [b, conn.filter(c => c.link.band === b).length]);
    const max = Math.max(1, ...byBand.map(x => x[1]));
    const col = { '2.4': '#fbbf24', '5': '#38bdf8', '6': '#c084fc' };
    $('#bandChart').innerHTML = byBand.map(([b, n]) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="width:64px">${RF.BAND_LABEL[b]}</span>
      <div class="bar" style="flex:1;height:14px"><i style="width:${n / max * 100}%;background:${col[b]}"></i></div><b style="width:24px;text-align:right">${n}</b></div>`).join('');
    const util = utilization();
    const rows = Object.entries(util).sort((a, b) => b[1] - a[1]).slice(0, 8);
    $('#utilList').innerHTML = rows.map(([k, u]) => {
      const [id, b] = k.split('|'); const ap = P.aps.find(a => a.id === id);
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;font-size:13px"><span style="width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ap.name)}</span>${bandTag(b)}
        <div class="bar" style="flex:1"><i style="width:${u}%;background:${lvColor(u)}"></i></div><span class="mono" style="width:38px;text-align:right">${Math.round(u)}%</span></div>`;
    }).join('') || '<div class="dim">Sin radios activas</div>';
    Spectrum.renderAll($('#dashSpec'));
  },
};

/* ============================================================== espectro */
const Spectrum = {
  renderAll(el) {
    const bands = RF.BANDS.filter(b => P.aps.some(a => a.radios[b]));
    el.innerHTML = bands.map(b => `<h3>${RF.BAND_LABEL[b]}</h3><canvas class="spec" data-b="${b}"></canvas>`).join('') || '<div class="dim">Sin radios</div>';
    requestAnimationFrame(() => $$('canvas.spec', el).forEach(c => this.draw(c, c.dataset.b)));
  },
  draw(cv, band) {
    const w = cv.clientWidth, h = cv.clientHeight, r = window.devicePixelRatio || 1;
    if (!w) return;
    cv.width = w * r; cv.height = h * r;
    const g = cv.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0);
    const allowed = RF.COUNTRIES[P.country].ch[band];
    const f0 = RF.chFreq(band, allowed[0]) - 10, f1 = RF.chFreq(band, allowed[allowed.length - 1]) + 10 + (band === '2.4' ? 2 : 0);
    const pad = 8, base = h - 26;
    const X = f => pad + (w - pad * 2) * (f - f0) / (f1 - f0);
    g.fillStyle = '#0a1222'; g.fillRect(0, 0, w, h);
    if (band === '5') {
      g.fillStyle = 'rgba(245,158,11,.08)';
      for (const [a, b] of [[52, 64], [100, 144]]) if (allowed.includes(a)) {
        const last = Math.max(...allowed.filter(c => c >= a && c <= b));
        g.fillRect(X(RF.chFreq(band, a) - 10), 0, X(RF.chFreq(band, last) + 10) - X(RF.chFreq(band, a) - 10), base);
      }
      g.fillStyle = 'rgba(245,158,11,.7)'; g.font = '600 10px Inter,sans-serif'; g.textAlign = 'left';
      g.fillText('DFS', X(RF.chFreq(band, 52) - 8), 12);
      if (allowed.includes(100)) g.fillText('DFS', X(RF.chFreq(band, 100) - 8), 12);
    }
    g.strokeStyle = '#2b3a5c'; g.beginPath(); g.moveTo(pad, base + .5); g.lineTo(w - pad, base + .5); g.stroke();
    g.font = '10px "JetBrains Mono",monospace'; g.fillStyle = '#64748b'; g.textAlign = 'center';
    const every = band === '6' ? (w < 700 ? 32 : 16) : band === '5' ? (w < 600 ? 2 : 1) : 1;
    allowed.forEach((c, i) => {
      const step = band === '2.4' ? 1 : 4;
      if (band === '6' ? ((c - 1) % every) : (i % every)) return;
      const x = X(RF.chFreq(band, c));
      g.fillText(c, x, base + 13); g.fillRect(x, base, 1, 3);
      void step;
    });
    const items = radioItems(band);
    const maxE = 36;
    items.forEach((it, i) => {
      const [a, b] = RF.span(band, it.radio.ch, it.radio.width);
      const eirp = it.radio.tx + it.model.gain[band];
      const top = base - (base - 22) * clamp(eirp / maxE, 0.15, 1);
      const xa = X(a), xb = X(b), sl = Math.min(8, (xb - xa) * 0.15);
      const col = apColor(it.ap);
      g.beginPath(); g.moveTo(xa, base); g.lineTo(xa + sl, top); g.lineTo(xb - sl, top); g.lineTo(xb, base);
      g.fillStyle = col + '2e'; g.fill(); g.strokeStyle = col; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = col; g.font = '600 10px Inter,sans-serif';
      g.fillText(`${it.ap.name} · ${it.radio.ch}`, (xa + xb) / 2, top - 4 - (i % 3) * 11);
    });
    g.fillStyle = '#64748b'; g.textAlign = 'right'; g.font = '10px Inter,sans-serif';
    g.fillText(`${Math.round(f0)}–${Math.round(f1)} MHz · altura = PIRE`, w - pad, h - 2);
  },
};

/* ================================================================== APs */
const APs = {
  openId: null,
  render() { this.renderTable(); this.renderDetail(); },
  renderTable() {
    const util = utilization();
    const counts = {};
    P.clients.forEach(c => { if (c.link) counts[c.link.ap] = (counts[c.link.ap] || 0) + 1; });
    const cell = (ap, b) => {
      const r = ap.radios[b];
      if (!r) return '<td class="dim">—</td>';
      if (!r.on) return '<td class="dim">apagada</td>';
      const u = util[`${ap.id}|${b}`] ?? 0;
      return `<td><span class="mono">${r.ch}/${r.width}</span>${RF.isDfs(b, r.ch, r.width) ? ' <span class="tag dfs">DFS</span>' : ''}<div class="dim mono" style="font-size:11px">${r.tx} dBm${r.txMode === 'auto' ? ' · TPC' : ''}</div>
        <div class="bar" style="margin-top:3px"><i style="width:${u}%;background:${lvColor(u)}"></i></div></td>`;
    };
    $('#apTable').innerHTML = `<tr><th>Estado</th><th>Nombre</th><th>Modelo</th><th>MAC / IP</th><th>2,4 GHz</th><th>5 GHz</th><th>6 GHz</th><th>Clientes</th><th>Activo</th></tr>` +
      (P.aps.map(ap => `<tr class="click" data-id="${ap.id}" ${this.openId === ap.id ? 'style="background:var(--panel2)"' : ''}>
        <td>${apUp(ap) ? '<span class="tag ok">En línea</span>' : '<span class="tag crit">Reinicio</span>'}</td>
        <td><span class="dot" style="background:${apColor(ap)}"></span><b>${esc(ap.name)}</b></td>
        <td>${ap.model}<div class="dim" style="font-size:11px">Wi-Fi ${RF.MODELS[ap.model].gen}</div></td>
        <td class="mono">${ap.mac}<div class="dim">${ap.ip}</div></td>
        ${RF.BANDS.map(b => cell(ap, b)).join('')}
        <td>${counts[ap.id] || 0}</td><td class="mono">${apUp(ap) ? fdur((Date.now() - ap.since) / 1000) : '—'}</td></tr>`).join('')
        || '<tr><td colspan="9" class="dim">No hay puntos de acceso. Añádelos aquí o desde el plano.</td></tr>');
    $$('#apTable tr.click').forEach(tr => tr.onclick = () => this.open(tr.dataset.id));
  },
  renderDetail() {
    const ap = P.aps.find(a => a.id === this.openId);
    const d = $('#apDetail');
    if (ap) { if (!d.firstElementChild?.classList.contains('panel')) d.innerHTML = '<div class="panel"></div>'; ApEditor.render(d.firstElementChild, ap); }
    else d.innerHTML = P.aps.length ? '<div class="dim" style="padding:4px 2px">Selecciona un AP para ver y editar su configuración completa.</div>' : '';
  },
  open(id) { this.openId = id; this.render(); $('#apDetail').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
};

/* ================================================================ RF / RRM */
const RfView = {
  render() {
    const c = P.rrm;
    const bandCol = b => {
      const t = c.tpc[b];
      const items = radioItems(b);
      return `<div class="panel"><h2>${RF.BAND_LABEL[b]} <span class="actions"><span class="tag">${items.length} radios</span></span></h2>
        ${b === '2.4' ? `<div class="field"><label class="f">Plan de canales DCA (20 MHz)</label><select data-c="set24"><option value="1-6-11" ${c.set24 === '1-6-11' ? 'selected' : ''}>1 · 6 · 11</option>
          <option value="1-5-9-13" ${c.set24 === '1-5-9-13' ? 'selected' : ''} ${P.country === 'US' || P.country === 'MX' ? 'disabled' : ''}>1 · 5 · 9 · 13 (ETSI)</option></select></div>` : ''}
        ${b === '5' ? `<label class="chk"><input type="checkbox" data-c="avoidDfs" ${c.avoidDfs ? 'checked' : ''}> Evitar canales DFS</label>` : ''}
        ${b === '6' ? `<label class="chk"><input type="checkbox" data-c="psc" ${c.psc ? 'checked' : ''}> Solo canales PSC en 20 MHz</label>` : ''}
        <div class="field"><label class="f">Ancho para todas las radios</label><div class="seg">${RF.WIDTHS[b].map(w => `<button data-bw="${b}|${w}">${w}</button>`).join('')}</div></div>
        <div class="field"><label class="f">Umbral TPC (3.er vecino) <output class="mono">${t.threshold} dBm</output></label><input type="range" data-t="${b}|threshold" min="-85" max="-55" value="${t.threshold}"></div>
        <div class="row field"><div><label class="f">Potencia mín. (dBm)</label><input type="number" data-t="${b}|min" min="1" max="30" value="${t.min}"></div>
          <div><label class="f">Potencia máx. (dBm)</label><input type="number" data-t="${b}|max" min="1" max="30" value="${t.max}"></div></div>
        <div class="row"><button class="btn sm" data-run="dca|${b}">${ic('refresh')}Ejecutar DCA</button><button class="btn sm" data-run="tpc|${b}">${ic('zap')}Ejecutar TPC</button></div>
        <div class="note">Canales permitidos en ${P.country}: ${RF.COUNTRIES[P.country].ch[b].length} · PIRE máx. ${b === '6' ? `${[...new Set(RF.WIDTHS[b].map(w => Math.round(RF.maxEirp(P.country, b, 1, w))))].join('/')} dBm según ancho (LPI)` : [...new Set(RF.COUNTRIES[P.country].ch[b].map(ch => RF.maxEirp(P.country, b, ch, 20)))].join('/') + ' dBm'}</div>
      </div>`;
    };
    $('#rfCols').innerHTML = `
      <div class="panel" style="grid-column:1/-1"><h2>Normativa y algoritmos</h2>
        <div class="cols3">
          <div><div class="field"><label class="f">País / dominio regulatorio</label><select data-c="country">${Object.entries(RF.COUNTRIES).map(([k, x]) => `<option value="${k}" ${k === P.country ? 'selected' : ''}>${x.name}</option>`).join('')}</select></div>
            <label class="chk"><input type="checkbox" data-c="dcaAuto" ${c.dcaAuto ? 'checked' : ''}> DCA automático (reoptimiza al cambiar la topología)</label>
            <label class="chk"><input type="checkbox" data-c="tpcAuto" ${c.tpcAuto ? 'checked' : ''}> TPC automático</label>
            <div class="field"><label class="f">Vecinos para TPC</label><select data-c="neighbors">${[1, 2, 3, 4].map(n => `<option ${n === c.neighbors ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
          <div><label class="chk"><input type="checkbox" data-c="bandSteering" ${c.bandSteering ? 'checked' : ''}> Band steering (preferir 6 y 5 GHz)</label>
            <div class="field"><label class="f">RSSI mínimo de asociación <output class="mono">${c.minRssi} dBm</output></label><input type="range" data-c="minRssi" min="-95" max="-65" value="${c.minRssi}"></div>
            <div class="field"><label class="f">Umbral de roaming del cliente <output class="mono">${c.roamTrigger} dBm</output></label><input type="range" data-c="roamTrigger" min="-85" max="-60" value="${c.roamTrigger}"></div>
            <div class="field"><label class="f">Histéresis de roaming <output class="mono">${c.roamDelta} dB</output></label><input type="range" data-c="roamDelta" min="0" max="15" value="${c.roamDelta}"></div></div>
          <div><div class="note" style="margin-top:0">El <b>DCA</b> asigna canales minimizando el solapamiento entre APs que se oyen (ponderado por su RSSI mutuo). Las radios con canal manual se respetan.<br><br>
            El <b>TPC</b> ajusta cada radio para que su ${c.neighbors}.º vecino más fuerte la oiga al umbral configurado, reduciendo la interferencia co-canal.<br><br>
            ${Object.keys(c.nol).filter(k => c.nol[k] > Date.now()).length ? `<span style="color:var(--dfs)">Canales en NOL (radar): ${Object.keys(c.nol).filter(k => c.nol[k] > Date.now()).join(', ')}</span> <button class="btn sm" id="nolClear">Liberar</button>` : 'Sin canales bloqueados por radar.'}</div></div>
        </div></div>
      ${RF.BANDS.map(bandCol).join('')}`;
    const root = $('#rfCols');
    root.querySelectorAll('[data-c]').forEach(inp => {
      const k = inp.dataset.c;
      inp.addEventListener(inp.type === 'range' ? 'input' : 'change', () => {
        const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' || k === 'neighbors' ? +inp.value : inp.value;
        if (inp.type === 'range') { inp.previousElementSibling.querySelector('output').textContent = `${v} ${k === 'roamDelta' ? 'dB' : 'dBm'}`; c[k] = v; clearTimeout(this._t); this._t = setTimeout(() => { associateAll(); MapView.invalidateHeat(); save(); UI.refresh(); }, 300); return; }
        if (k === 'country') {
          P.country = v;
          if (v !== 'ES' && v !== 'EU' && c.set24 === '1-5-9-13') c.set24 = '1-6-11';
          const notes = P.aps.flatMap(a => normalizeAp(a));
          logEvent('warn', 'Sistema', `Dominio regulatorio cambiado a ${RF.COUNTRIES[v].name}`);
          notes.forEach(n => logEvent('warn', 'Normativa', n));
          for (const b of RF.BANDS) runDca(b);
        } else c[k] = v;
        if (k === 'set24' || k === 'avoidDfs' || k === 'psc') runDca(k === 'set24' ? '2.4' : k === 'avoidDfs' ? '5' : '6');
        associateAll(); MapView.invalidateHeat(); save(); UI.refresh();
      });
    });
    root.querySelectorAll('[data-t]').forEach(inp => {
      const [b, k] = inp.dataset.t.split('|');
      inp.addEventListener(inp.type === 'range' ? 'input' : 'change', () => {
        c.tpc[b][k] = +inp.value;
        if (inp.type === 'range') inp.previousElementSibling.querySelector('output').textContent = `${inp.value} dBm`;
        save();
      });
    });
    root.querySelectorAll('[data-bw]').forEach(btn => btn.onclick = () => {
      const [b, w] = btn.dataset.bw.split('|');
      let n = 0;
      for (const ap of P.aps) {
        const r = ap.radios[b]; if (!r) continue;
        r.width = Math.min(+w, RF.MODELS[ap.model].maxWidth[b]); normalizeAp(ap); n++;
      }
      runDca(b);
      logEvent('info', 'RRM', `${RF.BAND_LABEL[b]}: ancho ${w} MHz aplicado a ${n} radios (limitado por modelo)`);
      associateAll(); MapView.invalidateHeat(); save(); UI.refresh();
    });
    root.querySelectorAll('[data-run]').forEach(btn => btn.onclick = () => {
      const [alg, b] = btn.dataset.run.split('|');
      const n = alg === 'dca' ? runDca(b, { force: true }) : runTpc(b);
      logEvent('ok', alg.toUpperCase(), `${RF.BAND_LABEL[b]}: ejecución manual, ${n} cambio(s)`);
      toast(`${alg.toUpperCase()} ${RF.BAND_LABEL[b]}: ${n} cambio(s)`, 'ok');
      associateAll(); MapView.invalidateHeat(); save(); UI.refresh();
    });
    $('#nolClear') && ($('#nolClear').onclick = () => { c.nol = {}; logEvent('info', 'DFS', 'Lista NOL liberada manualmente'); save(); UI.refresh(); });
    this.renderEnv();
    Spectrum.renderAll($('#rfSpec'));
  },

  renderEnv() {
    const e = P.env;
    $('#envForm').innerHTML = `<div class="cols3">
      <div><div class="field"><label class="f">Tipo de entorno</label><select id="envPreset">${Object.entries(ENV_PRESETS).map(([k, p]) => `<option value="${k}" ${k === e.preset ? 'selected' : ''}>${p.name}</option>`).join('')}</select></div>
        <div class="row field">${RF.BANDS.map(b => `<div><label class="f">Exponente ${RF.BAND_LABEL[b]}</label><input type="number" step="0.1" min="1.6" max="4.5" data-ple="${b}" value="${e.ple[b]}"></div>`).join('')}</div>
        <div class="note">Exponente de pérdidas (n): 2 = espacio libre. Con los muros dibujados, 2,2–2,5 suele ajustarse bien a una oficina.</div></div>
      <div><div class="row field"><div><label class="f">Altura del cliente (m)</label><input type="number" step="0.1" min="0" max="3" id="envCh" value="${e.clientHeight}"></div>
        <div><label class="f">Figura de ruido (dB)</label><input type="number" step="0.5" min="3" max="12" id="envNf" value="${e.noiseFigure}"></div></div>
        <div class="row field">${RF.BANDS.map(b => `<div><label class="f">Ruido extra ${RF.BAND_LABEL[b]}</label><input type="number" step="1" min="0" max="20" data-amb="${b}" value="${e.ambient[b]}"></div>`).join('')}</div>
        <div class="note">Suelo de ruido = −174 + 10·log(ancho) + figura de ruido + ruido ambiental. Canales más anchos ⇒ más ruido ⇒ menos SNR.</div></div>
      <div><div class="field"><label class="f">Resolución del mapa</label><select id="envRes">${[[0.1, '10 cm (lento)'], [0.25, '25 cm'], [0.5, '50 cm'], [1, '1 m (rápido)']].map(([v, l]) => `<option value="${v}" ${v === e.gridRes ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="note">Modelo: FSPL a 1 m + 10·n·log(d) en 3D (altura AP → altura cliente) + atenuación de cada muro atravesado + diagrama de antena. Es una predicción: los valores reales pueden variar ±5–8 dB.</div></div></div>`;
    const apply = () => { Heat.invalidate(); MapView.invalidateHeat(); associateAll(); save(); UI.refresh(); };
    $('#envPreset').onchange = ev => { e.preset = ev.target.value; const p = ENV_PRESETS[e.preset].ple; if (p) e.ple = { ...p }; apply(); };
    $$('[data-ple]').forEach(i => i.onchange = () => { const v = parseFloat(i.value); if (v > 1) { e.ple[i.dataset.ple] = v; e.preset = 'custom'; apply(); } });
    $$('[data-amb]').forEach(i => i.onchange = () => { e.ambient[i.dataset.amb] = +i.value || 0; apply(); });
    $('#envCh').onchange = ev => { e.clientHeight = clamp(+ev.target.value || 1, 0, 3); apply(); };
    $('#envNf').onchange = ev => { e.noiseFigure = clamp(+ev.target.value || 7, 3, 12); apply(); };
    $('#envRes').onchange = ev => { e.gridRes = +ev.target.value; apply(); };
  },
};

/* ================================================================== WLAN */
const Wlans = {
  render() {
    const cnt = {};
    P.clients.forEach(c => { if (c.link) cnt[c.wlan] = (cnt[c.wlan] || 0) + 1; });
    $('#wlanTable').innerHTML = `<tr><th>Activa</th><th>SSID</th><th>Seguridad</th><th>Bandas</th><th>VLAN</th><th>Roaming</th><th>Opciones</th><th>Clientes</th><th></th></tr>` +
      (P.wlans.map(w => `<tr data-id="${w.id}"><td><input type="checkbox" data-on ${w.on ? 'checked' : ''}></td><td><b>${esc(w.ssid)}</b>${w.hidden ? ' <span class="tag">oculta</span>' : ''}</td>
        <td>${SECURITY[w.sec].name}</td><td>${w.bands.map(bandTag).join('')}</td><td class="mono">${w.vlan}</td>
        <td>${['ft', 'k', 'v'].filter(k => w[k]).map(k => `<span class="tag">802.11${k === 'ft' ? 'r' : k}</span>`).join('') || '<span class="dim">—</span>'}</td>
        <td class="dim" style="font-size:12px">${[w.isolation && 'aislamiento', w.limit && `${w.limit} Mbps/cliente`, `mín. ${w.minRate} Mbps`].filter(Boolean).join(' · ')}</td>
        <td>${cnt[w.id] || 0}</td><td><button class="btn sm" data-ed>${ic('edit')}</button> <button class="btn sm danger" data-del>${ic('trash')}</button></td></tr>`).join('')
        || '<tr><td colspan="9" class="dim">No hay WLAN. Crea una para que los clientes puedan asociarse.</td></tr>');
    $$('#wlanTable tr[data-id]').forEach(tr => {
      const w = P.wlans.find(x => x.id === tr.dataset.id);
      tr.querySelector('[data-on]').onchange = e => { w.on = e.target.checked; logEvent(w.on ? 'info' : 'warn', 'WLAN', `${w.ssid} ${w.on ? 'activada' : 'desactivada'}`); associateAll(); save(); UI.refresh(); };
      tr.querySelector('[data-ed]').onclick = () => this.edit(w);
      tr.querySelector('[data-del]').onclick = () => Modal.confirm('Eliminar WLAN', `¿Eliminar la red <b>${esc(w.ssid)}</b>? Sus clientes quedarán desconectados.`, 'Eliminar', () => {
        P.wlans = P.wlans.filter(x => x !== w); logEvent('warn', 'WLAN', `${w.ssid} eliminada`); associateAll(); save(); UI.refresh();
      });
    });
    // sobrecarga de beacons
    const minRate = P.wlans.filter(w => w.on).reduce((a, w) => Math.min(a, w.minRate), 24);
    $('#beaconInfo').innerHTML = `<table><tr><th>Banda</th><th>SSID emitidas</th><th>Tasa de beacon</th><th>Aire por AP</th><th>Peor caso (APs co-canal oídos)</th></tr>` +
      RF.BANDS.map(b => {
        const n = P.wlans.filter(w => w.on && w.bands.includes(b)).length;
        const rate = b === '2.4' ? minRate : Math.max(6, minRate);
        const one = RF.beaconAirtime(n, b, rate);
        let worst = 0;
        for (const ap of P.aps) { const co = neighbors(ap).filter(x => x.band === b && x.co && x.rssi >= -82).length; worst = Math.max(worst, co); }
        const tot = one * (1 + worst);
        return `<tr><td>${bandTag(b)}</td><td>${n}</td><td>${rate} Mbps</td><td>${fmt(one, 1)} %</td><td style="color:${tot > 15 ? 'var(--bad)' : tot > 8 ? 'var(--fair)' : 'inherit'}">${fmt(tot, 1)} % (${worst} vecino${worst === 1 ? '' : 's'})</td></tr>`;
      }).join('') + '</table><div class="note">Los beacons se envían a la tasa básica mínima cada 102,4 ms por SSID. Subir la tasa mínima y reducir SSID libera tiempo de aire, especialmente en 2,4 GHz.</div>';
  },

  edit(w) {
    const isNew = !w;
    w = w ? { ...w, bands: [...w.bands] } : { id: uid('wl'), ssid: '', on: true, sec: 'wpa3sae', bands: ['2.4', '5', '6'], vlan: 1, hidden: false, ft: true, k: true, v: true, isolation: false, minRate: 12, limit: 0 };
    const bg = Modal.open(isNew ? 'Nueva WLAN' : `Editar ${w.ssid}`, `
      <div class="row field"><div><label class="f">SSID</label><input type="text" id="wSsid" maxlength="32" value="${esc(w.ssid)}"></div><div style="flex:.4"><label class="f">VLAN</label><input type="number" id="wVlan" min="1" max="4094" value="${w.vlan}"></div></div>
      <div class="field"><label class="f">Seguridad</label><select id="wSec">${Object.entries(SECURITY).map(([k, s]) => `<option value="${k}" ${k === w.sec ? 'selected' : ''}>${s.name}</option>`).join('')}</select></div>
      <div class="field" id="wPskF"><label class="f">Contraseña (8–63 caracteres)</label><input type="password" id="wPsk" value="${esc(w.psk || '')}" autocomplete="new-password"></div>
      <div class="field"><label class="f">Bandas</label>${RF.BANDS.map(b => `<label class="chk" style="display:inline-flex;margin-right:16px"><input type="checkbox" data-wb="${b}" ${w.bands.includes(b) ? 'checked' : ''}> ${RF.BAND_LABEL[b]}</label>`).join('')}<div class="note" id="w6note"></div></div>
      <div class="row field"><div><label class="f">Tasa básica mínima</label><select id="wRate">${[1, 6, 12, 24].map(r => `<option value="${r}" ${r === w.minRate ? 'selected' : ''}>${r} Mbps</option>`).join('')}</select></div>
        <div><label class="f">Límite por cliente (Mbps, 0 = sin límite)</label><input type="number" id="wLim" min="0" value="${w.limit}"></div></div>
      <label class="chk"><input type="checkbox" id="wFt" ${w.ft ? 'checked' : ''}> 802.11r Fast Transition</label>
      <label class="chk"><input type="checkbox" id="wK" ${w.k ? 'checked' : ''}> 802.11k (informes de vecinos)</label>
      <label class="chk"><input type="checkbox" id="wV" ${w.v ? 'checked' : ''}> 802.11v (gestión de transición BSS)</label>
      <label class="chk"><input type="checkbox" id="wHid" ${w.hidden ? 'checked' : ''}> SSID oculta</label>
      <label class="chk"><input type="checkbox" id="wIso" ${w.isolation ? 'checked' : ''}> Aislamiento de clientes</label>`,
    [['Cancelar'], [isNew ? 'Crear' : 'Guardar', 'primary', () => {
      const ssid = $('#wSsid').value.trim();
      if (!ssid) { toast('El SSID no puede estar vacío', 'warn'); return false; }
      if (P.wlans.some(x => x.ssid === ssid && x.id !== w.id)) { toast('Ya existe una WLAN con ese SSID', 'warn'); return false; }
      const sec = $('#wSec').value;
      const psk = $('#wPsk').value;
      if (/psk|23|sae/.test(sec) && (psk.length < 8 || psk.length > 63) && !(w.psk && psk === w.psk)) { toast('La contraseña debe tener entre 8 y 63 caracteres', 'warn'); return false; }
      const bands = RF.BANDS.filter(b => $(`[data-wb="${b}"]`).checked && (b !== '6' || SECURITY[sec].six));
      if (!bands.length) { toast('Elige al menos una banda', 'warn'); return false; }
      Object.assign(w, { ssid, sec, psk, bands, vlan: clamp(+$('#wVlan').value || 1, 1, 4094), minRate: +$('#wRate').value, limit: Math.max(0, +$('#wLim').value || 0),
        ft: $('#wFt').checked, k: $('#wK').checked, v: $('#wV').checked, hidden: $('#wHid').checked, isolation: $('#wIso').checked });
      if (isNew) { P.wlans.push(w); logEvent('ok', 'WLAN', `${ssid} creada (${SECURITY[sec].name}, ${bands.map(b => RF.BAND_LABEL[b]).join('/')})`); }
      else { Object.assign(P.wlans.find(x => x.id === w.id), w); logEvent('info', 'WLAN', `${ssid} modificada`); }
      P.clients.forEach(c => { if (!c.wlan) c.wlan = w.id; });
      associateAll(); save(); UI.refresh();
    }]]);
    const sync = () => {
      const sec = $('#wSec').value, six = SECURITY[sec].six, b6 = $('[data-wb="6"]', bg);
      b6.disabled = !six; if (!six) b6.checked = false;
      $('#w6note').textContent = six ? (sec === 'wpa23' ? 'En 6 GHz solo se anunciará WPA3 (no se permite WPA2 en esa banda).' : '') : '6 GHz exige WPA3 u OWE: no disponible con esta seguridad.';
      $('#wPskF').style.display = /psk|23|sae/.test(sec) ? '' : 'none';
    };
    $('#wSec').onchange = sync; sync();
    setTimeout(() => $('#wSsid')?.focus(), 30);
  },
};

/* ============================================================== clientes */
const Clients = {
  render() {
    $('#cliType').innerHTML = Object.entries(RF.CLIENT_TYPES).map(([k, t]) => `<option value="${k}" ${k === this.type ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    $('#cliMove').checked = !!this.moving;
    const ap = id => P.aps.find(a => a.id === id);
    const wl = id => P.wlans.find(w => w.id === id);
    $('#cliTable').innerHTML = `<tr><th>Cliente</th><th>Tipo</th><th>WLAN</th><th>AP</th><th>Banda / canal</th><th>RSSI ↓</th><th>RSSI ↑</th><th>SNR</th><th>MCS</th><th>PHY ↓ / ↑</th><th>Roam.</th></tr>` +
      (P.clients.map(c => {
        const l = c.link, a = l && ap(l.ap);
        const col = l ? `rgb(${rampFn(RSSI_STOPS)(l.rssi).map(Math.round)})` : 'var(--bad)';
        return `<tr class="click" data-id="${c.id}"><td><b>${esc(c.name)}</b><div class="dim mono" style="font-size:11px">${c.mac}</div></td><td>${esc(RF.CLIENT_TYPES[c.type].name)}</td>
          <td>${esc(wl(c.wlan)?.ssid ?? '—')}</td>
          ${l ? `<td><span class="dot" style="background:${apColor(a)}"></span>${esc(a.name)}</td><td>${bandTag(l.band)} <span class="mono">${l.ch}/${l.width}</span></td>
            <td style="color:${col};font-weight:600">${fdbm(l.rssi)}</td><td>${fdbm(l.ul)}</td><td>${fmt(l.snr)} dB</td><td class="mono">${l.mcs} · ${l.ss}SS</td><td>${frate(l.rate)} / ${frate(l.ulRate)}</td>`
            : `<td colspan="7"><span class="tag crit">Sin conexión</span></td>`}
          <td>${c.roams || 0}</td></tr>`;
      }).join('') || '<tr><td colspan="11" class="dim">No hay clientes. Añádelos aquí o con la herramienta «Cliente» del plano.</td></tr>');
    $$('#cliTable tr.click').forEach(tr => tr.onclick = () => { UI.go('map'); MapView.focusClient(tr.dataset.id); });
  },
  type: 'phone', moving: false,
  addRandom(n) {
    for (let i = 0; i < n; i++) {
      const c = newClient(this.type, 0.5 + Math.random() * (P.floor.w - 1), 0.5 + Math.random() * (P.floor.h - 1));
      P.clients.push(c); associate(c);
    }
    save(); UI.refresh();
  },
  /** Paseo aleatorio: los clientes se mueven y no atraviesan muros. */
  step() {
    let any = false;
    for (const c of P.clients) {
      if (Math.random() < 0.35) continue;
      c.dir = (c.dir ?? Math.random() * 6.28) + (Math.random() - 0.5) * 1.2;
      const d = 0.4 + Math.random() * 0.8;
      let nx = c.x + Math.cos(c.dir) * d, ny = c.y + Math.sin(c.dir) * d;
      const blocked = nx < 0.3 || ny < 0.3 || nx > P.floor.w - 0.3 || ny > P.floor.h - 0.3 ||
        P.walls.some(w => RF.segX(c.x, c.y, nx, ny, w.x1, w.y1, w.x2, w.y2) && w.mat !== 'wood');
      if (blocked) { c.dir += Math.PI * (0.6 + Math.random() * 0.8); continue; }
      c.x = nx; c.y = ny; associate(c); any = true;
    }
    return any;
  },
};

/* =============================================================== eventos */
const Events = {
  filter: 'all',
  render() {
    $('#evFilter').innerHTML = [['all', 'Todos'], ['crit', 'Críticos'], ['warn', 'Avisos'], ['info', 'Info']].map(([k, l]) => `<button data-f="${k}" class="${k === this.filter ? 'on' : ''}">${l}</button>`).join('');
    $$('#evFilter button').forEach(b => b.onclick = () => { this.filter = b.dataset.f; this.render(); });
    const list = P.events.filter(e => this.filter === 'all' || e.lv === this.filter || (this.filter === 'info' && e.lv === 'ok'));
    const lbl = { info: 'INFO', ok: 'OK', warn: 'AVISO', crit: 'CRÍTICO' };
    $('#evTable').innerHTML = `<tr><th>Hora</th><th>Nivel</th><th>Origen</th><th>Mensaje</th></tr>` +
      (list.slice(0, 300).map(e => `<tr><td class="dim">${new Date(e.t).toLocaleString('es-ES', { hour12: false })}</td><td><span class="lv ${e.lv}">${lbl[e.lv]}</span></td><td>${esc(e.src)}</td><td>${esc(e.msg)}</td></tr>`).join('')
        || '<tr><td colspan="4" class="dim">Sin eventos</td></tr>');
  },
};

/* ============================================================== proyecto */
const Project = {
  render() {
    const f = P.floor;
    $('#floorForm').innerHTML = `
      <div class="row field"><button class="btn" id="fImg">${ic('image')}${f.image ? 'Cambiar plano' : 'Cargar plano (imagen)'}</button>${f.image ? `<button class="btn danger" id="fImgDel">${ic('trash')}Quitar plano</button>` : ''}</div>
      <div class="note" style="margin:-4px 0 12px">PNG, JPG, SVG o WebP. Si tu plano está en PDF, expórtalo antes como imagen.${f.image ? ` Imagen actual: ${f.imgW}×${f.imgH} px.` : ''}</div>
      <div class="row field"><div><label class="f">Ancho (m)</label><input type="number" id="fW" step="0.1" min="2" max="1000" value="${+f.w.toFixed(2)}"></div>
        <div><label class="f">Alto / fondo (m)</label><input type="number" id="fH" step="0.1" min="2" max="1000" value="${+f.h.toFixed(2)}"></div></div>
      <label class="chk"><input type="checkbox" id="fLock" ${f.image ? 'checked' : ''} ${f.image ? '' : 'disabled'}> Mantener proporción de la imagen</label>
      <label class="chk"><input type="checkbox" id="fScale" checked> Escalar muros, APs y clientes con el plano</label>
      <div class="row" style="margin-bottom:12px"><button class="btn primary" id="fApply">Aplicar dimensiones</button><button class="btn" id="fCal">${ic('scale')}Calibrar con dos puntos</button></div>
      <div class="field"><label class="f">Opacidad del plano <output class="mono">${Math.round(f.imgOpacity * 100)} %</output></label><input type="range" id="fOp" min="10" max="100" value="${Math.round(f.imgOpacity * 100)}"></div>
      <label class="chk"><input type="checkbox" id="fGrid" ${f.showGrid ? 'checked' : ''}> Mostrar cuadrícula de metros</label>`;
    $('#fImg').onclick = () => $('#fileImg').click();
    $('#fImgDel') && ($('#fImgDel').onclick = () => { f.image = null; f.imgW = f.imgH = 0; save(); UI.refresh(); });
    const lock = () => $('#fLock').checked && f.image;
    $('#fW').oninput = () => { if (lock()) $('#fH').value = (+$('#fW').value * f.imgH / f.imgW).toFixed(2); };
    $('#fH').oninput = () => { if (lock()) $('#fW').value = (+$('#fH').value * f.imgW / f.imgH).toFixed(2); };
    $('#fApply').onclick = () => {
      const w = parseFloat($('#fW').value), h = parseFloat($('#fH').value);
      if (!(w >= 2 && h >= 2 && w <= 1000 && h <= 1000)) { toast('Dimensiones entre 2 y 1000 m', 'warn'); return; }
      if ($('#fScale').checked) MapView.rescale(w / f.w, h / f.h);
      else { f.w = w; f.h = h; P.aps.forEach(a => { a.x = Math.min(a.x, w); a.y = Math.min(a.y, h); }); Heat.invalidate(); MapView.refit(); associateAll(); }
      logEvent('info', 'Plano', `Dimensiones: ${fmt(f.w, 2)} × ${fmt(f.h, 2)} m`);
      save(); UI.refresh(); toast('Dimensiones aplicadas', 'ok');
    };
    $('#fCal').onclick = () => { UI.go('map'); MapView.setTool('calib'); };
    $('#fOp').oninput = e => { f.imgOpacity = +e.target.value / 100; e.target.previousElementSibling.querySelector('output').textContent = `${e.target.value} %`; save(); MapView.redraw(); };
    $('#fGrid').onchange = e => { f.showGrid = e.target.checked; save(); MapView.redraw(); };

    $('#projForm').innerHTML = `
      <div class="field"><label class="f">Nombre del proyecto</label><input type="text" id="pName" value="${esc(P.name)}" maxlength="80"></div>
      <div class="note" style="margin:-4px 0 12px">${P.aps.length} APs · ${P.walls.length} muros · ${P.clients.length} clientes · ${P.wlans.length} WLAN · se guarda automáticamente en este navegador.</div>
      <div class="row field"><button class="btn" id="pExp">${ic('download')}Exportar proyecto (.json)</button><button class="btn" id="pImp">${ic('upload')}Importar</button></div>
      <div class="row field"><button class="btn" id="pPng">${ic('image')}Exportar mapa de calor (PNG)</button></div>
      <h3>Restablecer</h3>
      <div class="row field"><button class="btn" id="pDemo">Cargar ejemplo</button><button class="btn danger" id="pNew">Proyecto vacío</button></div>
      <div class="row"><button class="btn sm danger" id="pWalls">Borrar muros</button><button class="btn sm danger" id="pClients">Borrar clientes</button></div>`;
    $('#pName').onchange = e => { P.name = e.target.value.trim() || P.name; save(); UI.refresh(); };
    $('#pExp').onclick = () => downloadBlob(new Blob([JSON.stringify(P, null, 1)], { type: 'application/json' }), `${slug(P.name)}.airscope.json`);
    $('#pImp').onclick = () => $('#fileJson').click();
    $('#pPng').onclick = () => MapView.exportPng();
    $('#pDemo').onclick = () => Modal.confirm('Cargar ejemplo', 'Se sustituirá el proyecto actual por la oficina de ejemplo.', 'Cargar', () => { demoProject(); UI.reload(); }, 'primary');
    $('#pNew').onclick = () => Modal.confirm('Proyecto vacío', 'Se borrará todo (plano, muros, APs, clientes y WLAN).', 'Empezar de cero', () => {
      P = newProject();
      P.wlans.push({ id: uid('wl'), ssid: 'MiWiFi', on: true, sec: 'wpa23', psk: 'cambiar1234', bands: ['2.4', '5', '6'], vlan: 1, hidden: false, ft: true, k: true, v: true, isolation: false, minRate: 12, limit: 0 });
      logEvent('ok', 'Sistema', 'Proyecto nuevo creado');
      UI.reload();
    });
    $('#pWalls').onclick = () => Modal.confirm('Borrar muros', `¿Borrar los ${P.walls.length} muros?`, 'Borrar', () => { P.walls = []; Heat.invalidate(); associateAll(); save(); UI.refresh(); });
    $('#pClients').onclick = () => Modal.confirm('Borrar clientes', `¿Borrar los ${P.clients.length} clientes?`, 'Borrar', () => { P.clients = []; save(); UI.refresh(); });

    $('#matTable').innerHTML = `<tr><th>Material</th><th>2,4 GHz (dB)</th><th>5 GHz (dB)</th><th>6 GHz (dB)</th><th>Muros</th></tr>` +
      Object.entries(RF.MATERIALS).map(([k, m]) => `<tr><td><span class="dot" style="background:${m.color}"></span>${esc(m.name)}</td>
        ${RF.BANDS.map(b => `<td><input type="number" style="width:80px" min="0" max="60" step="0.5" data-mat="${k}|${b}" value="${m.loss[b]}"></td>`).join('')}
        <td>${P.walls.filter(w => w.mat === k).length}</td></tr>`).join('');
    $$('[data-mat]').forEach(i => i.onchange = () => {
      const [k, b] = i.dataset.mat.split('|'); const v = clamp(parseFloat(i.value) || 0, 0, 60);
      RF.MATERIALS[k].loss[b] = v;
      (P.matLoss[k] ||= {})[b] = v;
      Heat.invalidate(); MapView.invalidateHeat(); associateAll(); save();
    });
  },

  loadImage(file) {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      const im = new Image();
      im.onload = () => {
        // reduce a 2400 px para que quepa en el autoguardado
        const k = Math.min(1, 2400 / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        P.floor.image = c.toDataURL('image/jpeg', 0.85);
        P.floor.imgW = c.width; P.floor.imgH = c.height;
        const ratio = c.height / c.width;
        P.floor.h = +(P.floor.w * ratio).toFixed(2);
        Heat.invalidate(); MapView.refit();
        logEvent('ok', 'Plano', `Plano cargado (${file.name}). Ajusta las dimensiones o calibra la escala.`);
        save(); UI.refresh();
        Modal.open('Plano cargado', `<p>Se ha ajustado el fondo a <b>${fmt(P.floor.w, 1)} × ${fmt(P.floor.h, 1)} m</b> manteniendo la proporción de la imagen.</p>
          <p class="dim" style="margin-top:8px">Indica las dimensiones reales o calibra la escala marcando una distancia conocida (una puerta, un pilar, una cota del plano).</p>`,
        [['Más tarde'], ['Calibrar ahora', 'primary', () => { UI.go('map'); MapView.setTool('calib'); }]]);
      };
      im.onerror = () => toast('No se pudo leer la imagen', 'crit');
      im.src = rd.result;
    };
    rd.readAsDataURL(file);
  },

  importJson(file) {
    if (!file) return;
    file.text().then(t => {
      const o = JSON.parse(t);
      if (!o || !o.floor || !Array.isArray(o.aps)) throw new Error('formato');
      loadProject(o);
      logEvent('ok', 'Sistema', `Proyecto importado: ${P.name}`);
      UI.reload();
      toast('Proyecto importado', 'ok');
    }).catch(() => toast('El archivo no es un proyecto de AirScope Controller válido', 'crit'));
  },
};

/* ================================================================ marco */
(function init() {
  $$('[data-ic]').forEach(i => { i.outerHTML = ic(i.dataset.ic); });
  let cur = 'dash';
  const VIEWS = { dash: Dash, map: null, aps: APs, rf: RfView, wlans: Wlans, clients: Clients, events: Events, project: Project };

  UI.go = v => {
    if (!VIEWS.hasOwnProperty(v)) v = 'dash';
    cur = v;
    $$('.view').forEach(s => s.classList.toggle('on', s.id === `v-${v}`));
    $$('nav.side a').forEach(a => a.classList.toggle('on', a.dataset.view === v));
    $('#side').classList.remove('open');
    if (location.hash !== `#${v}`) history.replaceState(null, '', `#${v}`);
    if (v === 'map') { MapView.shown(); MapView.refresh(); } else VIEWS[v].render();
    $('#main').scrollTop = 0;
  };
  UI.refresh = (opts = {}) => {
    $('#projName').textContent = P.name;
    $('#countryPill').textContent = P.country;
    $('#apOnline').textContent = `${P.aps.filter(apUp).length}/${P.aps.length}`;
    $('#nAps').textContent = P.aps.length; $('#nClients').textContent = P.clients.length; $('#nWlans').textContent = P.wlans.length;
    UI.badge();
    if (cur === 'map') MapView.refresh();
    else if (cur === 'aps' && opts.keepEditor) APs.renderTable();   // el editor se redibuja solo
    else VIEWS[cur].render();
  };
  UI.badge = () => { const n = P.events.filter(e => e.lv === 'crit' || e.lv === 'warn').length; $('#nEvents').textContent = P.events.length; void n; };
  UI.reload = () => { view.hidden.clear(); view.source = 'all'; Heat.cache.clear(); Heat.invalidate(); MapView.refit(); save(); UI.refresh(); };
  UI.optimize = () => {
    let n = 0;
    for (const b of RF.BANDS) { n += runTpc(b); n += runDca(b, { force: false }); }
    logEvent('ok', 'RRM', `Optimización manual completa: ${n} cambio(s)`);
    toast(n ? `RF optimizada: ${n} cambio(s) de canal/potencia` : 'La RF ya estaba optimizada', 'ok');
    associateAll(); MapView.invalidateHeat(); save(); UI.refresh();
  };

  $$('nav.side a').forEach(a => a.onclick = () => UI.go(a.dataset.view));
  $$('[data-go]').forEach(b => b.onclick = () => UI.go(b.dataset.go));
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
  $('#apAddBtn').onclick = () => {
    const ap = newAp(P.floor.w / 2, P.floor.h / 2); P.aps.push(ap); normalizeAp(ap);
    logEvent('ok', ap.name, `Punto de acceso ${ap.model} adoptado (${ap.ip})`);
    MapView.invalidateHeat(); associateAll(); autoRrm('AP añadido'); save(); APs.openId = ap.id; UI.refresh();
    toast(`${ap.name} añadido en el centro del plano. Muévelo desde «Plano y mapa de calor».`, 'ok');
  };
  $('#rrmRunAll').onclick = () => UI.optimize();
  $('#wlanAdd').onclick = () => Wlans.edit(null);
  $('#cliType').onchange = e => { Clients.type = e.target.value; };
  $('#cliAdd5').onclick = () => Clients.addRandom(5);
  $('#cliClear').onclick = () => Modal.confirm('Quitar clientes', '¿Eliminar todos los clientes simulados?', 'Quitar', () => { P.clients = []; save(); UI.refresh(); });
  $('#cliMove').onchange = e => { Clients.moving = e.target.checked; logEvent('info', 'Simulación', `Movimiento de clientes ${Clients.moving ? 'activado' : 'desactivado'}`); };
  $('#evClear').onclick = () => { P.events = []; save(); UI.refresh(); };
  $('#fileImg').onchange = e => { Project.loadImage(e.target.files[0]); e.target.value = ''; };
  $('#fileJson').onchange = e => { Project.importJson(e.target.files[0]); e.target.value = ''; };

  // proyecto guardado o ejemplo
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { stored = null; }
  if (stored && stored.floor) { try { loadProject(stored); } catch (e) { console.error(e); demoProject(); } }
  else demoProject();

  MapView.init();
  UI.refresh();
  UI.go((location.hash || '#dash').slice(1));

  // reloj y simulación en segundo plano
  let tick = 0;
  setInterval(() => {
    tick++;
    $('#clock').textContent = new Date().toLocaleTimeString('es-ES', { hour12: false });
    let dirty = false;
    for (const ap of P.aps) if (ap.status === 'boot' && Date.now() >= ap.bootUntil) {
      ap.status = 'up'; ap.since = Date.now();
      logEvent('ok', ap.name, 'En línea tras reinicio. Configuración aplicada desde el controlador');
      dirty = true;
    }
    if (dirty) { MapView.invalidateHeat(); associateAll(); autoRrm('AP en línea'); save(); UI.refresh(); }
    if (Clients.moving && tick % 2 === 0 && Clients.step()) {
      save();
      if (cur === 'map') MapView.redraw(); else if (cur === 'clients' || cur === 'dash') VIEWS[cur].render();
      UI.badge();
    }
    if (cur === 'aps' && tick % 5 === 0) APs.renderTable();
  }, 1000);
  $('#clock').textContent = new Date().toLocaleTimeString('es-ES', { hour12: false });
})();
