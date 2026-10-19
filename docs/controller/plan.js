/* AirScope Controller — herramientas del plano de fondo: enderezar una foto,
 * girarla, detectar paredes automáticamente, columnas y puertas/ventanas. */
'use strict';

const Plan = (() => {
  /* ------------------------------------------------------------ utilidades */
  function loadImg(src) {
    return new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
  }
  function pixels(img, maxSide = 0) {
    const k = maxSide ? Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return { c, g, w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
  }
  const toWorld = (px, py) => ({ x: px / P.floor.imgW * P.floor.w, y: py / P.floor.imgH * P.floor.h });
  const toImg = (x, y) => ({ x: x / P.floor.w * P.floor.imgW, y: y / P.floor.h * P.floor.imgH });

  /* --------------------------------------------------------- perspectiva */
  /** Resuelve A·x = b por eliminación gaussiana con pivote parcial. */
  function solve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
      x[i] = s / A[i][i];
    }
    return x;
  }

  /** Homografía que lleva puntos del rectángulo destino al cuadrilátero origen. */
  function homography(dst, src) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = dst[i], [X, Y] = src[i];
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
    }
    return [...solve(A, b), 1];
  }

  /** Ordena 4 puntos como sup-izq, sup-der, inf-der, inf-izq. */
  function orderQuad(pts) {
    const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
    const s = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    let k = 0;
    s.forEach((p, i) => { if (p.x + p.y < s[k].x + s[k].y) k = i; });
    return [...s.slice(k), ...s.slice(0, k)];
  }

  /** Endereza la foto: las 4 esquinas marcadas (en metros) pasan a ser un rectángulo. */
  async function warp(cornersWorld) {
    const img = await loadImg(P.floor.image);
    const src = pixels(img);
    const sx = src.w / P.floor.imgW, sy = src.h / P.floor.imgH;
    const q = orderQuad(cornersWorld).map(p => { const i = toImg(p.x, p.y); return [i.x * sx, i.y * sy]; });
    const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    let W = Math.max(len(q[0], q[1]), len(q[3], q[2])), H = Math.max(len(q[0], q[3]), len(q[1], q[2]));
    const k = Math.min(1, 2400 / Math.max(W, H));
    W = Math.round(W * k); H = Math.round(H * k);
    const Hm = homography([[0, 0], [W, 0], [W, H], [0, H]], q);
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const og = out.getContext('2d'), od = og.createImageData(W, H), d = od.data, s = src.data, sw = src.w, sh = src.h;
    for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
      const z = Hm[6] * u + Hm[7] * v + 1;
      const x = (Hm[0] * u + Hm[1] * v + Hm[2]) / z, y = (Hm[3] * u + Hm[4] * v + Hm[5]) / z;
      const o = (v * W + u) * 4;
      if (x < 0 || y < 0 || x >= sw - 1 || y >= sh - 1) { d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = 255; continue; }
      const x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        const a = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * tx, b = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * tx;
        d[o + c] = a + (b - a) * ty;
      }
      d[o + 3] = 255;
    }
    og.putImageData(od, 0, 0);
    P.floor.image = out.toDataURL('image/jpeg', 0.88);
    P.floor.imgW = W; P.floor.imgH = H;
    P.floor.h = +(P.floor.w * H / W).toFixed(2);
  }

  /** Gira el plano 90° (sentido horario) con todo su contenido. */
  async function rotate() {
    const Hh = P.floor.h;
    if (P.floor.image) {
      const img = await loadImg(P.floor.image);
      const c = document.createElement('canvas'); c.width = img.naturalHeight; c.height = img.naturalWidth;
      const g = c.getContext('2d');
      g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(img, 0, 0);
      P.floor.image = c.toDataURL('image/jpeg', 0.88);
      [P.floor.imgW, P.floor.imgH] = [c.width, c.height];
    }
    const rot = o => { const x = o.x; o.x = Hh - o.y; o.y = x; };
    for (const w of P.walls) { [w.x1, w.y1] = [Hh - w.y1, w.x1]; [w.x2, w.y2] = [Hh - w.y2, w.x2]; }
    for (const c of P.columns) { rot(c); [c.w, c.h] = [c.h, c.w]; }
    for (const a of P.aps) { rot(a); a.azimuth = ((a.azimuth || 0) + 90) % 360; }
    for (const c of P.clients) rot(c);
    if (P.walk) P.walk.pts.forEach(rot);
    [P.floor.w, P.floor.h] = [P.floor.h, P.floor.w];
  }

  /* -------------------------------------------------- detección de paredes */
  /**
   * Busca trazos oscuros, largos y gruesos horizontales y verticales en la
   * imagen (las paredes de un plano) y devuelve segmentos en metros.
   */
  async function detectWalls({ sens = 0.25, minLen = 0.8, minThick = 0.05, maxThick = 0.6 } = {}) {
    const img = await loadImg(P.floor.image);
    const px = pixels(img, 1500);
    const { w, h, data } = px;
    const mpp = P.floor.w / w;                                     // metros por píxel
    // luminancia + imagen integral para un umbral adaptativo (sirve con fotos)
    const L = new Float32Array(w * h), I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, l = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
        L[y * w + x] = l; row += l;
        I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
      }
    }
    const r = Math.max(8, Math.round(Math.min(w, h) / 40));
    const dark = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const mean = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
        const l = L[y * w + x];
        dark[y * w + x] = l < 175 && l < mean * (1 - sens) || l < 70 ? 1 : 0;
      }
    }
    const minLenPx = minLen / mpp, minT = Math.max(1, minThick / mpp), maxT = maxThick / mpp;
    const segs = [];
    // barrido en una orientación; get(a, b) = píxel en (posición a lo largo, fila)
    const sweep = (A, B, get, horiz) => {
      let active = [];
      const close = gr => {
        const t = gr.end - gr.start + 1;
        if (t < minT || t > maxT) return;
        const a0 = gr.sa0 / gr.n, a1 = gr.sa1 / gr.n;
        if (a1 - a0 < minLenPx) return;
        const c = (gr.start + gr.end) / 2 + 0.5;
        segs.push(horiz ? { x1: a0, y1: c, x2: a1, y2: c, t: t * mpp, h: true } : { x1: c, y1: a0, x2: c, y2: a1, t: t * mpp, h: false });
      };
      for (let b = 0; b <= B; b++) {
        const runs = [];
        if (b < B) {
          let s = -1, gap = 0;
          for (let a = 0; a <= A; a++) {
            const on = a < A && get(a, b);
            if (on) { if (s < 0) s = a; gap = 0; }
            else if (s >= 0 && (++gap > 3 || a === A)) { const e = a - gap; if (e - s + 1 >= minLenPx) runs.push([s, e]); s = -1; gap = 0; }
          }
        }
        // cada pared activa continúa con la pasada que más la solapa (una pasada larga puede
        // continuar varias paredes: p. ej. una fila donde la línea de una ventana une dos tramos)
        const next = [], usedRun = new Uint8Array(runs.length);
        for (const g of active) {
          let bi = -1, bo = 0;
          runs.forEach(([s, e], k) => { const o = Math.min(e, g.a1) - Math.max(s, g.a0); if (o > bo) { bo = o; bi = k; } });
          if (bi >= 0 && bo > 0.7 * (g.a1 - g.a0)) {
            const [s, e] = runs[bi]; usedRun[bi] = 1; g.used = true; g.end = b;
            const s2 = Math.max(s, g.a0 - 3), e2 = Math.min(e, g.a1 + 3);       // no se deja «arrastrar» por la pasada larga
            g.a0 = s2; g.a1 = e2; g.sa0 += s2; g.sa1 += e2; g.n++; next.push(g);
          }
        }
        runs.forEach(([s, e], k) => { if (!usedRun[k] && !next.some(g => Math.min(e, g.a1) - Math.max(s, g.a0) > 0.7 * (e - s))) next.push({ start: b, end: b, a0: s, a1: e, sa0: s, sa1: e, n: 1, used: true }); });
        for (const g of active) if (!g.used) close(g);
        active = next; active.forEach(g => { g.used = false; });
      }
      active.forEach(close);
    };
    sweep(w, h, (a, b) => dark[b * w + a], true);
    sweep(h, w, (a, b) => dark[a * w + b], false);
    // a metros
    const out = segs.map(s => ({ x1: s.x1 * mpp, y1: s.y1 * mpp, x2: s.x2 * mpp, y2: s.y2 * mpp, t: s.t, h: s.h }));
    // une esquinas: prolonga los extremos hasta la pared perpendicular más cercana
    const H = out.filter(s => s.h), V = out.filter(s => !s.h);
    const tol = s => Math.max(0.3, s.t * 1.5);
    for (const a of H) for (const v of V) {
      const tl = Math.max(tol(a), tol(v));
      if (a.y1 >= Math.min(v.y1, v.y2) - tl && a.y1 <= Math.max(v.y1, v.y2) + tl) {
        if (Math.abs(a.x1 - v.x1) < tl) a.x1 = v.x1;
        if (Math.abs(a.x2 - v.x1) < tl) a.x2 = v.x1;
      }
      if (v.x1 >= a.x1 - tl && v.x1 <= a.x2 + tl) {
        if (Math.abs(v.y1 - a.y1) < tl) v.y1 = a.y1;
        if (Math.abs(v.y2 - a.y1) < tl) v.y2 = a.y1;
      }
    }
    return out.filter(s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= minLen * 0.8).map(s => ({
      x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
      t: +clamp(s.t, 0.05, 0.5).toFixed(2),
      mat: s.t >= 0.24 ? 'concrete' : s.t >= 0.13 ? 'brick' : 'drywall',
    }));
  }

  /* ------------------------------------------------ puertas y ventanas */
  const OPENINGS = {
    door:      { name: 'Puerta de madera', mat: 'wood', w: 0.9 },
    metaldoor: { name: 'Puerta metálica / cortafuegos', mat: 'metaldoor', w: 0.9 },
    glassdoor: { name: 'Puerta de cristal', mat: 'glass', w: 0.9 },
    window:    { name: 'Ventana', mat: 'window', w: 1.2 },
    gap:       { name: 'Hueco / paso sin puerta', mat: null, w: 0.9 },
  };

  /** Inserta una puerta/ventana en el muro i, centrada en el punto p. */
  function insertOpening(i, p, type, width) {
    const w = P.walls[i], o = OPENINGS[type];
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = Math.hypot(dx, dy);
    if (L < width + 0.05) {                            // muro más corto que el hueco: se sustituye entero
      if (o.mat) { w.mat = o.mat; w.t = undefined; } else P.walls.splice(i, 1);
      return;
    }
    let t = ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / (L * L);
    const half = width / 2 / L;
    t = clamp(t, half, 1 - half);
    const pt = k => ({ x: w.x1 + dx * k, y: w.y1 + dy * k });
    const a = pt(t - half), b = pt(t + half);
    const parts = [];
    if (t - half > 1e-3) parts.push({ ...w, x2: a.x, y2: a.y });
    if (o.mat) parts.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, mat: o.mat, t: w.t, opening: type });
    if (t + half < 1 - 1e-3) parts.push({ ...w, x1: b.x, y1: b.y });
    P.walls.splice(i, 1, ...parts);
  }

  /* -------------------------------------------------------------- columnas */
  const COLUMN_PRESETS = {
    col30:  { name: 'Columna 30×30 cm', shape: 'rect', w: 0.3, h: 0.3, mat: 'concrete' },
    col40:  { name: 'Columna 40×40 cm', shape: 'rect', w: 0.4, h: 0.4, mat: 'concrete' },
    round40: { name: 'Columna redonda Ø40 cm', shape: 'round', w: 0.4, h: 0.4, mat: 'concrete' },
    steel:  { name: 'Pilar metálico 25×25 cm', shape: 'rect', w: 0.25, h: 0.25, mat: 'metal' },
    lift:   { name: 'Ascensor 2×2 m', shape: 'rect', w: 2, h: 2, mat: 'metal' },
    rack:   { name: 'Rack / armario metálico', shape: 'rect', w: 0.6, h: 1.0, mat: 'metal' },
    shelf:  { name: 'Estantería 0,5×2 m', shape: 'rect', w: 0.5, h: 2, mat: 'shelf' },
    fridge: { name: 'Frigorífico / electrodoméstico', shape: 'rect', w: 0.7, h: 0.7, mat: 'metal' },
    tank:   { name: 'Acuario / depósito de agua', shape: 'rect', w: 1.2, h: 0.5, mat: 'water' },
  };

  /** Contorno de una columna como lista de puntos. */
  function columnOutline(c) {
    const pts = [];
    if (c.shape === 'round') {
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; pts.push({ x: c.x + Math.cos(a) * c.w / 2, y: c.y + Math.sin(a) * c.h / 2 }); }
    } else {
      const hw = c.w / 2, hh = c.h / 2;
      pts.push({ x: c.x - hw, y: c.y - hh }, { x: c.x + hw, y: c.y - hh }, { x: c.x + hw, y: c.y + hh }, { x: c.x - hw, y: c.y + hh });
    }
    return pts;
  }

  /** Segmentos RF de una columna: un rayo cruza dos caras, cada una aporta la mitad. */
  function columnSegments(c) {
    const pts = columnOutline(c), m = RF.MATERIALS[c.mat];
    // un pilar pequeño se rodea por difracción: su sombra es menor que la de un muro igual de grueso
    const k = m.fixed ? 0.4 : clamp(0.3 * ((c.w + c.h) / 2) / m.t, 0.15, 8);
    return pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return { x1: p.x, y1: p.y, x2: q.x, y2: q.y, mat: c.mat, k }; });
  }

  return { warp, rotate, detectWalls, insertOpening, OPENINGS, COLUMN_PRESETS, columnOutline, columnSegments, orderQuad, toWorld };
})();
