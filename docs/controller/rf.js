/* AirScope Controller — motor de radiofrecuencia.
 * Propagación (log-distancia + atenuación por muros), canales y normativa,
 * ruido, MCS/velocidades 802.11ax/be y algoritmos RRM (DCA y TPC). */
'use strict';

const RF = (() => {
  const BANDS = ['2.4', '5', '6'];
  const BAND_LABEL = { '2.4': '2,4 GHz', '5': '5 GHz', '6': '6 GHz' };
  // Frecuencia representativa de cada banda para el modelo de propagación.
  const BAND_FREQ = { '2.4': 2437, '5': 5500, '6': 6500 };
  const WIDTHS = { '2.4': [20, 40], '5': [20, 40, 80, 160], '6': [20, 40, 80, 160, 320] };

  const range = (a, b, s = 4) => { const r = []; for (let c = a; c <= b; c += s) r.push(c); return r; };

  /* ------------------------------------------------------------ normativa */
  const COUNTRIES = {
    ES: {
      name: 'España (ETSI)',
      ch: { '2.4': range(1, 13, 1), '5': [...range(36, 64), ...range(100, 140)], '6': range(1, 93) },
      eirp(band, ch, width) {
        if (band === '2.4') return 20;
        if (band === '5') return ch >= 100 ? 30 : 23;
        return Math.min(23, 10 + 10 * Math.log10(width));          // LPI, 10 dBm/MHz
      },
    },
    EU: null, // se rellena abajo (idéntico a ES)
    US: {
      name: 'Estados Unidos (FCC)',
      ch: { '2.4': range(1, 11, 1), '5': [...range(36, 64), ...range(100, 144), ...range(149, 165)], '6': range(1, 233) },
      eirp(band, ch, width) {
        if (band === '2.4') return 36;
        if (band === '5') return (ch <= 48 || ch >= 149) ? 36 : 30;
        return Math.min(30, 5 + 10 * Math.log10(width));            // LPI, 5 dBm/MHz
      },
    },
    MX: null,
  };
  COUNTRIES.EU = { ...COUNTRIES.ES, name: 'Unión Europea (ETSI)' };
  COUNTRIES.MX = { ...COUNTRIES.US, name: 'México (IFT)' };

  const DFS = new Set([...range(52, 64), ...range(100, 144)]);
  const WEATHER_RADAR = new Set([120, 124, 128]);

  function chFreq(band, ch) {
    if (band === '2.4') return ch === 14 ? 2484 : 2407 + 5 * ch;
    if (band === '5') return 5000 + 5 * ch;
    return 5950 + 5 * ch;
  }

  /** Canales de 20 MHz que ocupa un canal primario con un ancho dado. */
  function block(band, ch, width) {
    if (band === '2.4') return width === 40 ? (ch <= 7 ? [ch, ch + 4] : [ch - 4, ch]) : [ch];
    const n = width / 20;
    if (n === 1) return [ch];
    const base = band === '6' ? 1 : (ch < 100 ? 36 : ch < 149 ? 100 : 149);
    const idx = Math.floor((ch - base) / 4);
    const start = base + Math.floor(idx / n) * n * 4;
    return Array.from({ length: n }, (_, i) => start + 4 * i);
  }

  /** [fmin, fmax, fcentro] en MHz del canal (todo el bloque). */
  function span(band, ch, width) {
    const b = block(band, ch, width);
    const fc = (chFreq(band, b[0]) + chFreq(band, b[b.length - 1])) / 2;
    return [fc - width / 2, fc + width / 2, fc];
  }

  function validChannel(country, band, ch, width) {
    const allowed = COUNTRIES[country].ch[band];
    if (!allowed.includes(ch)) return false;
    if (band === '2.4') {
      if (width === 40) return block(band, ch, width).every(c => allowed.includes(c));
      return true;
    }
    return block(band, ch, width).every(c => allowed.includes(c));
  }

  function channelsFor(country, band, width) {
    return COUNTRIES[country].ch[band].filter(c => validChannel(country, band, c, width));
  }

  function isDfs(band, ch, width) {
    return band === '5' && block(band, ch, width).some(c => DFS.has(c));
  }

  function maxEirp(country, band, ch, width) {
    const c = COUNTRIES[country];
    return Math.min(...block(band, ch, width).map(x => c.eirp(band, x, width)));
  }

  /** Fracción del espectro de B que cae dentro de A (0..1). */
  function overlap(sa, sb) {
    const o = Math.min(sa[1], sb[1]) - Math.max(sa[0], sb[0]);
    return o <= 0 ? 0 : o / (sb[1] - sb[0]);
  }

  /* ------------------------------------------------------- ruido / señal */
  function noiseFloor(width, band, env) {
    const nf = env?.noiseFigure ?? 7;
    const extra = env?.ambient?.[band] ?? 0;
    return -174 + 10 * Math.log10(width * 1e6) + nf + extra;
  }

  const dbmToMw = d => Math.pow(10, d / 10);
  const mwToDbm = m => 10 * Math.log10(Math.max(m, 1e-15));

  /* ------------------------------------------------------------ materiales */
  const MATERIALS = {
    drywall:  { name: 'Pladur / tabique',        loss: { '2.4': 3,  '5': 4,  '6': 5  }, color: '#dbeafe', w: 2 },
    brick:    { name: 'Ladrillo',                loss: { '2.4': 6,  '5': 10, '6': 12 }, color: '#f97316', w: 3 },
    concrete: { name: 'Hormigón',                loss: { '2.4': 12, '5': 17, '6': 20 }, color: '#a8a29e', w: 4 },
    heavy:    { name: 'Muro de carga (armado)',  loss: { '2.4': 18, '5': 25, '6': 30 }, color: '#e7e5e4', w: 5 },
    glass:    { name: 'Cristal',                 loss: { '2.4': 2,  '5': 3,  '6': 4  }, color: '#67e8f9', w: 2 },
    lowe:     { name: 'Cristal bajo emisivo',    loss: { '2.4': 12, '5': 16, '6': 18 }, color: '#2dd4bf', w: 2 },
    wood:     { name: 'Puerta de madera',        loss: { '2.4': 3,  '5': 4,  '6': 5  }, color: '#d97706', w: 3 },
    cubicle:  { name: 'Mampara / panel',         loss: { '2.4': 1,  '5': 2,  '6': 2  }, color: '#64748b', w: 1.5 },
    shelf:    { name: 'Estantería / almacén',    loss: { '2.4': 6,  '5': 9,  '6': 11 }, color: '#a78bfa', w: 3 },
    metal:    { name: 'Metal / ascensor',        loss: { '2.4': 30, '5': 35, '6': 40 }, color: '#f43f5e', w: 4 },
  };

  /* ------------------------------------------------------------- modelos AP */
  const MODELS = {
    'AS-610':  { name: 'AS-610',  desc: 'Wi-Fi 6 · 2x2:2 · interior',  gen: 6, bands: ['2.4', '5'],
      ss: { '2.4': 2, '5': 2 }, maxTx: { '2.4': 22, '5': 24 }, gain: { '2.4': 3, '5': 4 },
      maxWidth: { '2.4': 40, '5': 80 }, pattern: 'omni' },
    'AS-640':  { name: 'AS-640',  desc: 'Wi-Fi 6 · 4x4:4 · alta densidad', gen: 6, bands: ['2.4', '5'],
      ss: { '2.4': 2, '5': 4 }, maxTx: { '2.4': 24, '5': 26 }, gain: { '2.4': 4, '5': 5 },
      maxWidth: { '2.4': 40, '5': 160 }, pattern: 'omni' },
    'AS-660E': { name: 'AS-660E', desc: 'Wi-Fi 6E · tribanda · 2x2/4x4/2x2', gen: 6, bands: ['2.4', '5', '6'],
      ss: { '2.4': 2, '5': 4, '6': 2 }, maxTx: { '2.4': 23, '5': 25, '6': 23 }, gain: { '2.4': 4, '5': 5, '6': 5 },
      maxWidth: { '2.4': 40, '5': 160, '6': 160 }, pattern: 'omni' },
    'AS-770':  { name: 'AS-770',  desc: 'Wi-Fi 7 · tribanda · 4x4 · 320 MHz', gen: 7, bands: ['2.4', '5', '6'],
      ss: { '2.4': 4, '5': 4, '6': 4 }, maxTx: { '2.4': 24, '5': 26, '6': 25 }, gain: { '2.4': 4, '5': 5.5, '6': 6 },
      maxWidth: { '2.4': 40, '5': 160, '6': 320 }, pattern: 'omni' },
    'AS-610W': { name: 'AS-610W', desc: 'Wi-Fi 6 · placa de pared · 2x2', gen: 6, bands: ['2.4', '5'],
      ss: { '2.4': 2, '5': 2 }, maxTx: { '2.4': 18, '5': 20 }, gain: { '2.4': 2, '5': 3 },
      maxWidth: { '2.4': 20, '5': 80 }, pattern: 'wall', beam: { '2.4': 150, '5': 140 }, fb: 6 },
    'AS-650S': { name: 'AS-650S', desc: 'Wi-Fi 6 · sectorial 70° · exterior', gen: 6, bands: ['2.4', '5'],
      ss: { '2.4': 2, '5': 2 }, maxTx: { '2.4': 24, '5': 26 }, gain: { '2.4': 8, '5': 11 },
      maxWidth: { '2.4': 20, '5': 80 }, pattern: 'sector', beam: { '2.4': 80, '5': 65 }, fb: 22 },
  };

  /** Ganancia relativa (dB, ≤0) del diagrama de antena en dirección `ang` (rad). */
  function patternGain(model, band, azimuthDeg, ang) {
    if (model.pattern === 'omni') return 0;
    let d = Math.abs(ang * 180 / Math.PI - azimuthDeg) % 360;
    if (d > 180) d = 360 - d;
    const bw = model.beam[band];
    return -Math.min(12 * (d / bw) * (d / bw), model.fb);           // diagrama 3GPP
  }

  /* --------------------------------------------------------------- clientes */
  const CLIENT_TYPES = {
    phone:  { name: 'Smartphone (Wi-Fi 6E)', bands: ['2.4', '5', '6'], ss: 2, gen: 6, maxWidth: 160, tx: { '2.4': 15, '5': 14, '6': 12 }, gain: -2 },
    laptop: { name: 'Portátil (Wi-Fi 7)',    bands: ['2.4', '5', '6'], ss: 2, gen: 7, maxWidth: 320, tx: { '2.4': 18, '5': 17, '6': 15 }, gain: 0 },
    tablet: { name: 'Tablet (Wi-Fi 6)',      bands: ['2.4', '5'],      ss: 2, gen: 6, maxWidth: 80, tx: { '2.4': 15, '5': 15 }, gain: -1 },
    voip:   { name: 'Teléfono VoIP (Wi-Fi 5)', bands: ['2.4', '5'],    ss: 1, gen: 5, maxWidth: 80, tx: { '2.4': 14, '5': 14 }, gain: -2 },
    iot:    { name: 'Sensor IoT (Wi-Fi 4)',  bands: ['2.4'],           ss: 1, gen: 4, maxWidth: 20, tx: { '2.4': 10 }, gain: -3 },
  };

  /* ------------------------------------------------------------------- MCS */
  const MCS_SNR = [5, 8, 11, 14, 17, 21, 23, 25, 29, 31, 34, 37, 40, 43];
  const MCS_RATE20 = [8.6, 17.2, 25.8, 34.4, 51.6, 68.8, 77.4, 86.0, 103.2, 114.7, 129.0, 143.4, 154.9, 172.1];
  const MCS_MOD = ['BPSK 1/2', 'QPSK 1/2', 'QPSK 3/4', '16-QAM 1/2', '16-QAM 3/4', '64-QAM 2/3', '64-QAM 3/4',
    '64-QAM 5/6', '256-QAM 3/4', '256-QAM 5/6', '1024-QAM 3/4', '1024-QAM 5/6', '4096-QAM 3/4', '4096-QAM 5/6'];
  // Factor de subportadoras de datos respecto a 20 MHz (234/468/980/1960/3920).
  const WIDTH_FACTOR = { 20: 1, 40: 2, 80: 4.188, 160: 8.376, 320: 16.752 };
  // MCS máximo por generación (Wi-Fi 4: 64-QAM, 5: 256-QAM, 6: 1024-QAM, 7: 4096-QAM).
  const GEN_MAX_MCS = { 4: 7, 5: 9, 6: 11, 7: 13 };

  function phyRate(snr, width, ss, gen) {
    const max = GEN_MAX_MCS[gen] ?? 11;
    let m = -1;
    for (let i = 0; i <= max; i++) if (snr >= MCS_SNR[i]) m = i;
    if (m < 0) return { mcs: -1, ss: 0, rate: 0, mod: '—' };
    const streams = snr >= 15 ? ss : 1;                    // con SNR baja solo diversidad
    return { mcs: m, ss: streams, rate: MCS_RATE20[m] * WIDTH_FACTOR[width] * streams, mod: MCS_MOD[m] };
  }

  /* ----------------------------------------------------------- propagación */
  const fspl1m = f => 20 * Math.log10(f) - 27.55;

  /** Pérdida total (dB) entre dos puntos 3D atravesando muros. */
  function pathLoss(walls, band, ple, x1, y1, h1, x2, y2, h2) {
    const dx = x2 - x1, dy = y2 - y1, dh = h2 - h1;
    const d = Math.max(Math.sqrt(dx * dx + dy * dy + dh * dh), 0.3);
    const f = BAND_FREQ[band];
    let pl = fspl1m(f) + (d <= 1 ? 20 * Math.log10(d) : 10 * ple * Math.log10(d));
    for (const w of walls) if (segX(x1, y1, x2, y2, w.x1, w.y1, w.x2, w.y2)) pl += MATERIALS[w.mat].loss[band];
    return pl;
  }

  function segX(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    if ((d1 > 0) === (d2 > 0)) return false;
    const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    return (d3 > 0) !== (d4 > 0);
  }

  /**
   * Mapa de pérdidas de un AP sobre una rejilla: para cada banda un Float32Array
   * con (pérdida de trayecto + muros − diagrama de antena). RSSI = Ptx + G − mapa.
   */
  function lossMap(ap, model, walls, env, grid) {
    const { cols, rows, res } = grid;
    const x0 = grid.x0 || 0, y0 = grid.y0 || 0;
    const n = cols * rows;
    const out = {};
    const bands = model.bands;
    for (const b of bands) out[b] = new Float32Array(n);
    const W = walls.length;
    const wx1 = new Float64Array(W), wy1 = new Float64Array(W), wx2 = new Float64Array(W), wy2 = new Float64Array(W);
    const wl = bands.map(() => new Float64Array(W));
    walls.forEach((w, i) => {
      wx1[i] = w.x1; wy1[i] = w.y1; wx2[i] = w.x2; wy2[i] = w.y2;
      bands.forEach((b, k) => { wl[k][i] = MATERIALS[w.mat].loss[b]; });
    });
    const base = bands.map(b => fspl1m(BAND_FREQ[b]));
    const ple = bands.map(b => env.ple[b]);
    const dh = ap.h - env.clientHeight;
    const ax = ap.x, ay = ap.y;
    const acc = new Float64Array(bands.length);
    for (let r = 0; r < rows; r++) {
      const y = y0 + (r + 0.5) * res;
      for (let c = 0; c < cols; c++) {
        const x = x0 + (c + 0.5) * res;
        acc.fill(0);
        for (let i = 0; i < W; i++) {
          // test de cruce de segmentos (inline por rendimiento)
          const cx = wx1[i], cy = wy1[i], ex = wx2[i], ey = wy2[i];
          const d1 = (ex - cx) * (ay - cy) - (ey - cy) * (ax - cx);
          const d2 = (ex - cx) * (y - cy) - (ey - cy) * (x - cx);
          if ((d1 > 0) === (d2 > 0)) continue;
          const d3 = (x - ax) * (cy - ay) - (y - ay) * (cx - ax);
          const d4 = (x - ax) * (ey - ay) - (y - ay) * (ex - ax);
          if ((d3 > 0) === (d4 > 0)) continue;
          for (let k = 0; k < bands.length; k++) acc[k] += wl[k][i];
        }
        const ddx = x - ax, ddy = y - ay;
        const d = Math.max(Math.sqrt(ddx * ddx + ddy * ddy + dh * dh), 0.3);
        const ang = Math.atan2(ddy, ddx);
        const idx = r * cols + c;
        for (let k = 0; k < bands.length; k++) {
          const b = bands[k];
          const pl = base[k] + (d <= 1 ? 20 * Math.log10(d) : 10 * ple[k] * Math.log10(d));
          out[b][idx] = pl + acc[k] - patternGain(model, b, ap.azimuth || 0, ang);
        }
      }
    }
    return out;
  }

  /** RSSI puntual (dBm) de una radio de AP en (x,y) a la altura del cliente. */
  function rssiAt(ap, model, band, radio, walls, env, x, y, h = env.clientHeight, rxGain = 0) {
    const pl = pathLoss(walls, band, env.ple[band], ap.x, ap.y, ap.h, x, y, h);
    const g = patternGain(model, band, ap.azimuth || 0, Math.atan2(y - ap.y, x - ap.x));
    return radio.tx + model.gain[band] + g + rxGain - pl;
  }

  /* -------------------------------------------------------------------- RRM */
  /** Matriz de acoplamiento AP→AP (dBm con la potencia actual) para una banda. */
  function coupling(list, walls, env, band) {
    const n = list.length, M = [];
    for (let i = 0; i < n; i++) {
      M.push(new Float64Array(n));
      for (let j = 0; j < n; j++) {
        if (i === j) { M[i][j] = -Infinity; continue; }
        const a = list[i], b = list[j];
        // potencia de i recibida por j (antena de j omnidireccional aproximada)
        M[i][j] = rssiAt(a.ap, a.model, band, a.radio, walls, env, b.ap.x, b.ap.y, b.ap.h, b.model.gain[band]);
      }
    }
    return M;
  }

  /**
   * Asignación dinámica de canales: búsqueda local que minimiza el solapamiento
   * ponderado por lo fuerte que se oyen los APs entre sí.
   */
  function dca(list, walls, env, band, opts) {
    if (!list.length) return [];
    const M = coupling(list, walls, env, band);
    const cand = list.map(it => {
      if (it.fixed) return [it.radio.ch];
      let cs = channelsFor(opts.country, band, it.radio.width);
      if (band === '6' && opts.psc && it.radio.width === 20) cs = cs.filter(c => c % 16 === 5);
      if (band === '2.4' && it.radio.width === 20) cs = cs.filter(c => opts.set24.includes(c));
      if (band === '5' && opts.avoidDfs) {
        const nd = cs.filter(c => !isDfs(band, c, it.radio.width));
        if (nd.length) cs = nd;
      }
      const blocked = opts.blocked || {};
      const free = cs.filter(c => !(blocked[c] > Date.now()));
      if (free.length) cs = free;
      if (!cs.length) cs = [it.radio.ch];
      // un representante por bloque (el primario no cambia el solapamiento)
      const seen = new Set();
      return cs.filter(c => { const k = block(band, c, it.radio.width).join(); if (seen.has(k)) return false; seen.add(k); return true; });
    });
    const w = (i, j) => Math.max(0, Math.max(M[i][j], M[j][i]) + 92);
    const spanOf = (i, c) => span(band, c, list[i].radio.width);
    const pairCost = (i, ci, j, cj) => {
      const a = spanOf(i, ci), b = spanOf(j, cj);
      return w(i, j) * Math.max(overlap(a, b), overlap(b, a));
    };
    const pen = (i, c) => (isDfs(band, c, list[i].radio.width) ? 0.3 : 0) + (band === '5' && WEATHER_RADAR.has(c) ? 0.6 : 0);
    const total = asg => {
      let s = 0;
      for (let i = 0; i < asg.length; i++) {
        s += pen(i, asg[i]);
        for (let j = i + 1; j < asg.length; j++) s += pairCost(i, asg[i], j, asg[j]);
      }
      return s;
    };
    let best = null, bestCost = Infinity;
    const order = list.map((_, i) => i).sort((a, b) => {
      const da = M[a].reduce((s, v, j) => s + w(a, j), 0), db = M[b].reduce((s, v, j) => s + w(b, j), 0);
      return db - da;
    });
    for (let restart = 0; restart < 8; restart++) {
      const asg = list.map((it, i) => cand[i].includes(it.radio.ch) && (restart === 0 || it.fixed) ? it.radio.ch : cand[i][Math.floor(Math.random() * cand[i].length)]);
      for (let pass = 0; pass < 25; pass++) {
        let changed = false;
        const ord = restart === 0 ? order : [...order].sort(() => Math.random() - 0.5);
        for (const i of ord) {
          let bc = asg[i], bv = Infinity;
          for (const c of cand[i]) {
            let v = pen(i, c);
            for (let j = 0; j < asg.length; j++) if (j !== i) v += pairCost(i, c, j, asg[j]);
            if (v < bv - 1e-9) { bv = v; bc = c; }
          }
          if (bc !== asg[i]) { asg[i] = bc; changed = true; }
        }
        if (!changed) break;
      }
      const tc = total(asg);
      if (tc < bestCost) { bestCost = tc; best = asg.slice(); }
    }
    return best;
  }

  /**
   * Control de potencia (TPC): cada AP ajusta su potencia para que su
   * N-ésimo vecino lo oiga en el umbral configurado.
   */
  function tpc(list, walls, env, band, opts) {
    const M = coupling(list, walls, env, band);
    return list.map((it, i) => {
      const lo = opts.minTx, hi = Math.min(opts.maxTx, it.limitTx);
      const heard = [];
      for (let j = 0; j < list.length; j++) if (j !== i && M[i][j] > -90) heard.push(M[i][j]);
      heard.sort((a, b) => b - a);
      if (heard.length < opts.neighbors) return hi;
      const nth = heard[opts.neighbors - 1];
      const tx = it.radio.tx + (opts.threshold - nth);
      return Math.round(Math.max(lo, Math.min(hi, tx)));
    });
  }

  /* --------------------------------------------- sobrecarga de beacons */
  /** % de tiempo de aire usado por beacons de un AP (todas sus SSID) en un canal. */
  function beaconAirtime(ssids, band, minRate) {
    const bytes = 350;                                         // beacon típico con IEs HE/EHT
    const rate = band === '2.4' ? minRate : Math.max(minRate, 6);
    const us = (band === '2.4' && rate < 6 ? 192 : 20) + (bytes * 8) / rate;
    return ssids * us / 102400 * 100;
  }

  return {
    BANDS, BAND_LABEL, BAND_FREQ, WIDTHS, COUNTRIES, DFS, WEATHER_RADAR, MATERIALS, MODELS, CLIENT_TYPES,
    MCS_SNR, MCS_RATE20, MCS_MOD, chFreq, block, span, validChannel, channelsFor, isDfs, maxEirp, overlap,
    noiseFloor, dbmToMw, mwToDbm, phyRate, pathLoss, lossMap, rssiAt, patternGain, coupling, dca, tpc,
    beaconAirtime, segX,
  };
})();

if (typeof module !== 'undefined') module.exports = RF;
