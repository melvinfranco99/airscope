"""Gráficas personalizadas dibujadas con QPainter (sin dependencias externas)."""

from __future__ import annotations

import hashlib
import math
import time

from PyQt6.QtCore import QPointF, QRectF, Qt, QTimer, pyqtSignal
from PyQt6.QtGui import (QBrush, QColor, QConicalGradient, QFont, QFontMetrics,
                         QLinearGradient, QPainter, QPainterPath, QPen, QRadialGradient)
from PyQt6.QtWidgets import QToolTip, QWidget

from . import theme as T
from . import wifi_math as wm

DBM_MIN, DBM_MAX = -100.0, -20.0


def _font(size: float, bold: bool = False) -> QFont:
    f = QFont()
    f.setPointSizeF(size)
    f.setBold(bold)
    return f


def _alpha(c: QColor | str, a: int) -> QColor:
    c = QColor(c)
    c.setAlpha(a)
    return c


class ChartBase(QWidget):
    apSelected = pyqtSignal(str)

    def __init__(self, title: str = "", parent=None):
        super().__init__(parent)
        self.title = title
        self.aps = []
        self.selected = ""
        self.setMouseTracking(True)
        self.setMinimumHeight(220)
        self.ml, self.mr, self.mt, self.mb = 58, 18, 34, 42

    def set_data(self, aps, selected: str = ""):
        self.aps = aps
        self.selected = selected
        self.update()

    def set_selected(self, bssid: str):
        self.selected = bssid
        self.update()

    def plot_rect(self) -> QRectF:
        return QRectF(self.ml, self.mt, self.width() - self.ml - self.mr,
                      self.height() - self.mt - self.mb)

    def paint_bg(self, p: QPainter):
        p.fillRect(self.rect(), QColor(T.PANEL))
        if self.title:
            p.setPen(QColor(T.TEXT))
            p.setFont(_font(10.5, True))
            p.drawText(QRectF(14, 6, self.width() - 28, 24),
                       Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, self.title)

    def empty(self, p: QPainter, text="Sin datos — esperando escaneo…"):
        p.setPen(QColor(T.TEXT_DIM))
        p.setFont(_font(11))
        p.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, text)

    def y_of(self, dbm: float, r: QRectF) -> float:
        dbm = max(DBM_MIN, min(DBM_MAX, dbm))
        return r.bottom() - (dbm - DBM_MIN) / (DBM_MAX - DBM_MIN) * r.height()

    def draw_dbm_axis(self, p: QPainter, r: QRectF):
        # Franja de color de calidad a la izquierda
        bands = [(-20, -50, T.GOOD), (-50, -60, T.OK), (-60, -67, T.FAIR),
                 (-67, -75, T.WEAK), (-75, -100, T.BAD)]
        for top, bot, col in bands:
            y1, y2 = self.y_of(top, r), self.y_of(bot, r)
            p.fillRect(QRectF(r.left() - 6, y1, 4, y2 - y1), QColor(col))
            p.fillRect(QRectF(r.left(), y1, r.width(), y2 - y1), _alpha(col, 9))
        p.setFont(_font(8))
        for d in range(-100, -19, 10):
            y = self.y_of(d, r)
            p.setPen(QPen(QColor(T.GRID), 1, Qt.PenStyle.DashLine if d % 20 else Qt.PenStyle.SolidLine))
            p.drawLine(QPointF(r.left(), y), QPointF(r.right(), y))
            p.setPen(QColor(T.TEXT_DIM))
            p.drawText(QRectF(0, y - 8, r.left() - 10, 16),
                       Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter, f"{d}")
        p.save()
        p.translate(12, r.center().y())
        p.rotate(-90)
        p.drawText(QRectF(-60, -8, 120, 16), Qt.AlignmentFlag.AlignCenter, "Señal (dBm)")
        p.restore()


# ---------------------------------------------------------------------------
# Espectro de canales (estilo inSSIDer)
# ---------------------------------------------------------------------------

class SpectrumChart(ChartBase):
    RANGES = {"2.4": (2399.0, 2497.0), "5": (5145.0, 5900.0), "6": (5920.0, 7130.0)}

    def __init__(self, band: str, parent=None):
        super().__init__(f"Espectro de canales · {wm.band_label(band)}", parent)
        self.band = band
        self._shapes = []
        if band == "5":
            self.mt = 50

    def x_of(self, f: float, r: QRectF) -> float:
        a, b = self.RANGES[self.band]
        return r.left() + (f - a) / (b - a) * r.width()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.paint_bg(p)
        r = self.plot_rect()
        aps = [a for a in self.aps if a.band == self.band]

        # Regiones regulatorias 5 GHz
        if self.band == "5":
            for name, c1, c2, desc in wm.UNII_BANDS:
                x1 = self.x_of(wm.channel_to_freq(c1, "5") - 10, r)
                x2 = self.x_of(wm.channel_to_freq(c2, "5") + 10, r)
                if "DFS" in desc:
                    p.fillRect(QRectF(x1, r.top(), x2 - x1, r.height()), _alpha(T.DFS_FILL, 22))
                    p.setPen(QPen(_alpha(T.DFS_FILL, 120), 1, Qt.PenStyle.DotLine))
                    p.drawLine(QPointF(x1, r.top()), QPointF(x1, r.bottom()))
                    p.drawLine(QPointF(x2, r.top()), QPointF(x2, r.bottom()))
                    p.setPen(QColor(T.DFS_FILL))
                    p.setFont(_font(8, True))
                    p.drawText(QRectF(x1, r.top() + 2, x2 - x1, 14), Qt.AlignmentFlag.AlignCenter,
                               "DFS · radar")
                p.setPen(QColor(T.TEXT_DIM))
                p.setFont(_font(7.5))
                p.drawText(QRectF(x1, self.mt - 14, x2 - x1, 12), Qt.AlignmentFlag.AlignCenter, name)

        self.draw_dbm_axis(p, r)

        # Eje X: canales
        p.setFont(_font(7.5 if self.band != "2.4" else 8.5))
        if self.band == "2.4":
            chans = wm.CHANNELS_24
        elif self.band == "5":
            chans = wm.CHANNELS_5
        else:
            chans = wm.CHANNELS_6
        fm = QFontMetrics(p.font())
        last_x = -1e9
        for ch in chans:
            f = wm.channel_to_freq(ch, self.band)
            x = self.x_of(f, r)
            p.setPen(QPen(QColor(T.GRID), 1))
            p.drawLine(QPointF(x, r.bottom()), QPointF(x, r.bottom() + 4))
            label = str(ch)
            w = fm.horizontalAdvance(label)
            if x - last_x > w + 4:
                nonoverlap = self.band == "2.4" and ch in (1, 6, 11)
                p.setPen(QColor(T.ACCENT if nonoverlap else (T.DFS_FILL if wm.is_dfs(ch, self.band) else T.TEXT_DIM)))
                p.drawText(QRectF(x - 20, r.bottom() + 5, 40, 14), Qt.AlignmentFlag.AlignCenter, label)
                last_x = x
        p.setPen(QColor(T.TEXT_DIM))
        p.setFont(_font(8))
        p.drawText(QRectF(r.left(), self.height() - 18, r.width(), 16), Qt.AlignmentFlag.AlignCenter,
                   "Canal" + ("   (1 · 6 · 11 = canales sin solapamiento)" if self.band == "2.4" else ""))

        if not aps:
            p.setClipRect(r)
            self.empty(p, f"No se detectan redes en {wm.band_label(self.band)}")
            return

        p.setClipRect(r.adjusted(0, -self.mt, 0, 0))
        self._shapes = []
        ordered = sorted(aps, key=lambda a: (a.bssid == self.selected, a.dbm))
        labels = []
        for ap in ordered:
            x1, x2 = self.x_of(ap.low_freq, r), self.x_of(ap.high_freq, r)
            yt, yb = self.y_of(ap.dbm, r), r.bottom()
            w = x2 - x1
            path = QPainterPath(QPointF(x1, yb))
            k = w * 0.12
            path.cubicTo(QPointF(x1 + k * 0.6, yb), QPointF(x1 + k * 0.4, yt), QPointF(x1 + k * 1.4, yt))
            path.lineTo(QPointF(x2 - k * 1.4, yt))
            path.cubicTo(QPointF(x2 - k * 0.4, yt), QPointF(x2 - k * 0.6, yb), QPointF(x2, yb))
            col = T.ap_color(ap.bssid)
            dim = bool(self.selected) and ap.bssid != self.selected
            grad = QLinearGradient(0, yt, 0, yb)
            grad.setColorAt(0, _alpha(col, 30 if dim else 110))
            grad.setColorAt(1, _alpha(col, 5 if dim else 25))
            p.setBrush(QBrush(grad))
            width = 3.0 if ap.bssid == self.selected else (2.2 if ap.in_use else 1.6)
            p.setPen(QPen(_alpha(col, 70 if dim else 255), width))
            p.drawPath(path)
            self._shapes.append((path, ap))
            labels.append((ap, (x1 + x2) / 2, yt, col, dim))
        # Etiquetas (evitar solapes simples)
        p.setFont(_font(8.5, True))
        fm = QFontMetrics(p.font())
        placed: list[QRectF] = []
        for ap, cx, yt, col, dim in reversed(labels):
            txt = ("★ " if ap.in_use else "") + ap.display_ssid
            tw = fm.horizontalAdvance(txt) + 6
            rect = QRectF(cx - tw / 2, yt - 18, tw, 15)
            for _ in range(8):
                if any(rect.intersects(o) for o in placed):
                    rect.translate(0, -15)
                else:
                    break
            placed.append(rect)
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(_alpha(T.PANEL, 170))
            p.drawRoundedRect(rect, 3, 3)
            p.setPen(_alpha(col, 90 if dim else 255))
            p.drawText(rect, Qt.AlignmentFlag.AlignCenter, txt)

    def _ap_at(self, pos):
        for path, ap in reversed(self._shapes):
            if path.contains(QPointF(pos)):
                return ap
        return None

    def mouseMoveEvent(self, e):
        ap = self._ap_at(e.position())
        if ap:
            QToolTip.showText(e.globalPosition().toPoint(),
                              f"<b>{ap.display_ssid}</b><br>{ap.bssid}<br>"
                              f"Canal {ap.channel} · {ap.width} MHz · {ap.freq:.0f} MHz<br>"
                              f"Señal: <b>{ap.dbm:.0f} dBm</b> · {ap.generation}", self)
        else:
            QToolTip.hideText()

    def mousePressEvent(self, e):
        ap = self._ap_at(e.position())
        if ap:
            self.apSelected.emit(ap.bssid)


# ---------------------------------------------------------------------------
# Historial de señal
# ---------------------------------------------------------------------------

class TimeChart(ChartBase):
    def __init__(self, parent=None):
        super().__init__("Historial de señal en el tiempo", parent)
        self.history: dict[str, list] = {}
        self.names: dict[str, str] = {}
        self.window = 300.0

    def set_history(self, history, aps, selected=""):
        self.history = history
        self.aps = aps
        self.names = {a.bssid: a.display_ssid for a in aps}
        self.selected = selected
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.mr = 170
        self.paint_bg(p)
        r = self.plot_rect()
        self.draw_dbm_axis(p, r)
        now = time.time()
        p.setFont(_font(8))
        for s in range(0, int(self.window) + 1, 30):
            x = r.right() - s / self.window * r.width()
            p.setPen(QPen(QColor(T.GRID), 1, Qt.PenStyle.DotLine))
            p.drawLine(QPointF(x, r.top()), QPointF(x, r.bottom()))
            p.setPen(QColor(T.TEXT_DIM))
            lab = "ahora" if s == 0 else f"-{s // 60}:{s % 60:02d}"
            p.drawText(QRectF(x - 25, r.bottom() + 5, 50, 14), Qt.AlignmentFlag.AlignCenter, lab)
        p.drawText(QRectF(r.left(), self.height() - 18, r.width(), 16), Qt.AlignmentFlag.AlignCenter,
                   "Tiempo (min:seg)")
        if not self.aps:
            self.empty(p)
            return
        visible = [a.bssid for a in self.aps][:14]
        if self.selected and self.selected not in visible:
            visible.append(self.selected)
        p.save()
        p.setClipRect(r)
        for b in sorted(visible, key=lambda x: x == self.selected):
            pts = [(t, d) for t, d in self.history.get(b, []) if now - t <= self.window]
            if not pts:
                continue
            col = T.ap_color(b)
            dim = bool(self.selected) and b != self.selected
            path = QPainterPath()
            for i, (t, d) in enumerate(pts):
                pt = QPointF(r.right() - (now - t) / self.window * r.width(), self.y_of(d, r))
                path.moveTo(pt) if i == 0 else path.lineTo(pt)
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.setPen(QPen(_alpha(col, 60 if dim else 255), 3 if b == self.selected else 1.8))
            p.drawPath(path)
            last = pts[-1]
            p.setBrush(_alpha(col, 60 if dim else 255))
            p.drawEllipse(QPointF(r.right() - (now - last[0]) / self.window * r.width(),
                                  self.y_of(last[1], r)), 3, 3)
        p.restore()
        # Leyenda
        p.setFont(_font(8.5))
        y = r.top()
        for b in visible:
            ap = next((a for a in self.aps if a.bssid == b), None)
            if not ap:
                continue
            col = T.ap_color(b)
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(col)
            p.drawRoundedRect(QRectF(r.right() + 12, y + 4, 10, 10), 2, 2)
            p.setPen(QColor(T.TEXT if b == self.selected or not self.selected else T.TEXT_DIM))
            name = QFontMetrics(p.font()).elidedText(ap.display_ssid, Qt.TextElideMode.ElideRight, 100)
            p.drawText(QRectF(r.right() + 28, y, 110, 18), Qt.AlignmentFlag.AlignVCenter, name)
            p.setPen(QColor(wm.signal_color(ap.dbm)))
            p.drawText(QRectF(r.right() + 28, y, 136, 18),
                       Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight, f"{ap.dbm:.0f}")
            y += 19
            if y > r.bottom() - 10:
                break


# ---------------------------------------------------------------------------
# Congestión de canales
# ---------------------------------------------------------------------------

def channel_scores(aps, band: str):
    if band == "2.4":
        chans = list(range(1, 14))
    elif band == "5":
        chans = [c for c in wm.CHANNELS_5 if c <= 165]
    else:
        chans = wm.CHANNELS_6[::4]
    res = []
    for ch in chans:
        f = wm.channel_to_freq(ch, band)
        lo, hi = f - 10, f + 10
        count, score = 0, 0.0
        for a in aps:
            if a.band != band:
                continue
            ov = min(hi, a.high_freq) - max(lo, a.low_freq)
            if ov > 0:
                count += 1
                # peso: potencia relativa (0..1.3) por fracción de solapamiento
                score += max(0.0, (a.dbm + 100) / 60.0) * (ov / 20.0)
        res.append((ch, count, round(score, 2)))
    return res


def best_channels(aps, band: str):
    sc = channel_scores(aps, band)
    if band == "2.4":
        cand = [s for s in sc if s[0] in (1, 6, 11)]
        best = min(cand, key=lambda s: s[2]) if cand else None
        return best, best
    if band == "5":
        non_dfs = [s for s in sc if not wm.is_dfs(s[0], "5")]
        best_nd = min(non_dfs, key=lambda s: s[2]) if non_dfs else None
        best_all = min(sc, key=lambda s: s[2]) if sc else None
        return best_nd, best_all
    best = min(sc, key=lambda s: s[2]) if sc else None
    return best, best


class CongestionChart(ChartBase):
    def __init__(self, band: str, parent=None):
        super().__init__(f"Congestión por canal · {wm.band_label(band)}", parent)
        self.band = band

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.ml = 46
        self.paint_bg(p)
        r = self.plot_rect()
        sc = channel_scores(self.aps, self.band)
        if not sc:
            self.empty(p)
            return
        mx = max(2.0, max(s[2] for s in sc) * 1.15)
        n = len(sc)
        bw = r.width() / n
        best_nd, best_all = best_channels(self.aps, self.band)
        p.setFont(_font(8))
        for i in range(5):
            v = mx * i / 4
            y = r.bottom() - v / mx * r.height()
            p.setPen(QPen(QColor(T.GRID), 1, Qt.PenStyle.DashLine))
            p.drawLine(QPointF(r.left(), y), QPointF(r.right(), y))
            p.setPen(QColor(T.TEXT_DIM))
            p.drawText(QRectF(0, y - 8, r.left() - 6, 16),
                       Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter, f"{v:.1f}")
        for i, (ch, cnt, s) in enumerate(sc):
            x = r.left() + i * bw
            h = s / mx * r.height()
            ratio = min(1.0, s / 2.0)
            col = QColor(T.GOOD) if ratio < 0.25 else QColor(T.OK) if ratio < 0.45 else \
                QColor(T.FAIR) if ratio < 0.65 else QColor(T.WEAK) if ratio < 0.85 else QColor(T.BAD)
            rect = QRectF(x + bw * 0.15, r.bottom() - h, bw * 0.7, max(h, 1.5))
            grad = QLinearGradient(0, rect.top(), 0, rect.bottom())
            grad.setColorAt(0, col)
            grad.setColorAt(1, _alpha(col, 90))
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QBrush(grad))
            p.drawRoundedRect(rect, 3, 3)
            if self.band == "5" and wm.is_dfs(ch, "5"):
                p.fillRect(QRectF(x, r.top(), bw, r.height()), _alpha(T.DFS_FILL, 14))
            if cnt and bw > 16:
                p.setPen(QColor(T.TEXT))
                p.drawText(QRectF(x, rect.top() - 15, bw, 14), Qt.AlignmentFlag.AlignCenter, str(cnt))
            is_best = best_nd and ch == best_nd[0]
            is_best_all = best_all and ch == best_all[0] and not is_best
            p.setPen(QColor(T.ACCENT if is_best else T.DFS_FILL if wm.is_dfs(ch, self.band) else T.TEXT_DIM))
            p.setFont(_font(8, bool(is_best)))
            if bw > 14 or i % 2 == 0:
                p.drawText(QRectF(x - 4, r.bottom() + 4, bw + 8, 14), Qt.AlignmentFlag.AlignCenter, str(ch))
            if is_best or is_best_all:
                p.setFont(_font(12, True))
                p.setPen(QColor(T.ACCENT if is_best else T.DFS_FILL))
                p.drawText(QRectF(x - 10, rect.top() - 34, bw + 20, 18), Qt.AlignmentFlag.AlignCenter, "★")
            p.setFont(_font(8))
        p.setPen(QColor(T.TEXT_DIM))
        txt = "Nº sobre la barra = redes que solapan · altura = índice de interferencia ponderado por potencia"
        if best_nd:
            txt += f"   ·   ★ Recomendado: canal {best_nd[0]}"
        if self.band == "5" and best_all and best_all != best_nd:
            txt += f"  (DFS: {best_all[0]})"
        p.drawText(QRectF(r.left(), self.height() - 18, r.width(), 16), Qt.AlignmentFlag.AlignCenter, txt)


# ---------------------------------------------------------------------------
# Radar de proximidad
# ---------------------------------------------------------------------------

class RadarChart(ChartBase):
    RINGS = [2, 5, 10, 25, 50, 100]
    MAXD = 150.0

    def __init__(self, parent=None):
        super().__init__("Radar de proximidad (distancia estimada)", parent)
        self.angle = 0.0
        self._pts = []
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._tick)
        self.timer.start(40)

    def _tick(self):
        if self.isVisible():
            self.angle = (self.angle + 2.5) % 360
            self.update()

    def _radius(self, d, R):
        return R * math.log10(1 + min(d, self.MAXD)) / math.log10(1 + self.MAXD)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.paint_bg(p)
        cx, cy = self.width() / 2 - 80, self.height() / 2 + 10
        R = min(self.width() - 220, self.height() - 60) / 2
        if R < 40:
            return
        bg = QRadialGradient(QPointF(cx, cy), R)
        bg.setColorAt(0, QColor("#0f2a33"))
        bg.setColorAt(1, QColor("#0b1626"))
        p.setBrush(bg)
        p.setPen(QPen(QColor(T.GRID_STRONG), 1.5))
        p.drawEllipse(QPointF(cx, cy), R, R)
        colors = [T.GOOD, T.OK, T.FAIR, T.FAIR, T.WEAK, T.BAD]
        p.setFont(_font(8))
        for d, col in zip(self.RINGS, colors):
            rr = self._radius(d, R)
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.setPen(QPen(_alpha(col, 90), 1, Qt.PenStyle.DashLine))
            p.drawEllipse(QPointF(cx, cy), rr, rr)
            p.setPen(_alpha(col, 200))
            p.drawText(QPointF(cx + 4, cy - rr - 3), f"{d} m")
        p.setPen(QPen(QColor(T.GRID), 1))
        for a in range(0, 360, 30):
            rad = math.radians(a)
            p.drawLine(QPointF(cx, cy), QPointF(cx + R * math.cos(rad), cy + R * math.sin(rad)))
        # barrido
        cg = QConicalGradient(QPointF(cx, cy), -self.angle)
        cg.setColorAt(0.0, _alpha(T.ACCENT, 110))
        cg.setColorAt(0.12, _alpha(T.ACCENT, 0))
        cg.setColorAt(1.0, _alpha(T.ACCENT, 0))
        p.setBrush(QBrush(cg))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawEllipse(QPointF(cx, cy), R, R)
        # centro (tú)
        p.setBrush(QColor(T.ACCENT))
        p.drawEllipse(QPointF(cx, cy), 5, 5)
        p.setPen(QColor(T.ACCENT))
        p.drawText(QRectF(cx - 30, cy + 7, 60, 14), Qt.AlignmentFlag.AlignCenter, "TÚ")
        self._pts = []
        p.setFont(_font(8, True))
        for ap in self.aps:
            h = int(hashlib.md5(ap.bssid.encode()).hexdigest()[:6], 16)
            ang = math.radians(h % 360)
            rr = self._radius(ap.distance, R)
            x, y = cx + rr * math.cos(ang), cy + rr * math.sin(ang)
            col = QColor(wm.signal_color(ap.dbm))
            # brillo cuando el barrido pasa
            diff = (self.angle - math.degrees(ang)) % 360
            glow = max(0.0, 1 - diff / 90.0)
            size = 5 + 3 * glow + (2 if ap.bssid == self.selected else 0)
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(_alpha(col, int(60 + 120 * glow)))
            p.drawEllipse(QPointF(x, y), size + 5, size + 5)
            p.setBrush(col)
            p.drawEllipse(QPointF(x, y), size, size)
            if ap.bssid == self.selected or ap.in_use:
                p.setBrush(Qt.BrushStyle.NoBrush)
                p.setPen(QPen(QColor(T.TEXT), 1.5))
                p.drawEllipse(QPointF(x, y), size + 8, size + 8)
            p.setPen(_alpha(T.TEXT, 230 if (not self.selected or ap.bssid == self.selected) else 110))
            p.drawText(QPointF(x + size + 4, y + 4), ap.display_ssid[:18])
            self._pts.append((x, y, ap))
        # leyenda
        lx = self.width() - 200
        p.setFont(_font(9, True))
        p.setPen(QColor(T.TEXT))
        p.drawText(QPointF(lx, 50), "Intensidad de señal")
        p.setFont(_font(8.5))
        for i, (thr, lab, col) in enumerate(wm.SIGNAL_LEVELS):
            y = 64 + i * 20
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QColor(col))
            p.drawEllipse(QPointF(lx + 6, y + 6), 5, 5)
            p.setPen(QColor(T.TEXT_DIM))
            rng = f"≥ {thr} dBm" if thr > -200 else "< -75 dBm"
            p.drawText(QPointF(lx + 18, y + 10), f"{lab}  ({rng})")
        p.setPen(QColor(T.TEXT_DIM))
        p.setFont(_font(8))
        p.drawText(QRectF(lx, 180, 190, 80), Qt.TextFlag.TextWordWrap,
                   "Escala logarítmica. La distancia se estima con el modelo de pérdidas log-distancia; "
                   "paredes y obstáculos aumentan el error.")

    def mousePressEvent(self, e):
        for x, y, ap in self._pts:
            if math.hypot(e.position().x() - x, e.position().y() - y) < 12:
                self.apSelected.emit(ap.bssid)
                return

    def mouseMoveEvent(self, e):
        for x, y, ap in self._pts:
            if math.hypot(e.position().x() - x, e.position().y() - y) < 12:
                QToolTip.showText(e.globalPosition().toPoint(),
                                  f"<b>{ap.display_ssid}</b><br>~{ap.distance:.1f} m · {ap.dbm:.0f} dBm", self)
                return
        QToolTip.hideText()


# ---------------------------------------------------------------------------
# Donut
# ---------------------------------------------------------------------------

class DonutChart(QWidget):
    def __init__(self, title: str, parent=None):
        super().__init__(parent)
        self.title = title
        self.data: list[tuple[str, float, str]] = []
        self.setMinimumSize(240, 200)

    def set_data(self, data):
        self.data = [d for d in data if d[1] > 0]
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.fillRect(self.rect(), QColor(T.PANEL))
        p.setPen(QColor(T.TEXT))
        p.setFont(_font(10, True))
        p.drawText(QRectF(12, 6, self.width(), 22), Qt.AlignmentFlag.AlignVCenter, self.title)
        total = sum(d[1] for d in self.data)
        size = min(self.width() * 0.5, self.height() - 50)
        rect = QRectF(16, 38 + (self.height() - 50 - size) / 2, size, size)
        if total <= 0:
            p.setPen(QPen(QColor(T.GRID), 14))
            p.drawEllipse(rect.adjusted(8, 8, -8, -8))
            return
        start = 90 * 16
        thick = max(10.0, size * 0.16)
        for lab, v, col in self.data:
            span = -int(round(v / total * 360 * 16))
            p.setPen(QPen(QColor(col), thick, Qt.PenStyle.SolidLine, Qt.PenCapStyle.FlatCap))
            p.drawArc(rect.adjusted(thick / 2, thick / 2, -thick / 2, -thick / 2), start, span)
            start += span
        p.setPen(QColor(T.TEXT))
        p.setFont(_font(16, True))
        p.drawText(rect, Qt.AlignmentFlag.AlignCenter, str(int(total)))
        # leyenda
        x = rect.right() + 18
        y = 44
        p.setFont(_font(9))
        for lab, v, col in self.data:
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QColor(col))
            p.drawRoundedRect(QRectF(x, y + 3, 10, 10), 2, 2)
            p.setPen(QColor(T.TEXT))
            p.drawText(QRectF(x + 16, y, self.width() - x - 20, 16), Qt.AlignmentFlag.AlignVCenter,
                       f"{lab}")
            p.setPen(QColor(T.TEXT_DIM))
            p.drawText(QRectF(x + 16, y, self.width() - x - 24, 16),
                       Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight,
                       f"{int(v)}  ({v / total * 100:.0f}%)")
            y += 20


# ---------------------------------------------------------------------------
# Medidor de señal
# ---------------------------------------------------------------------------

class SignalGauge(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.dbm = None
        self.caption = ""
        self.setMinimumSize(220, 230)

    def set_value(self, dbm, caption=""):
        self.dbm = dbm
        self.caption = caption
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.fillRect(self.rect(), QColor(T.PANEL))
        w, h = self.width(), self.height()
        R = min(w / 2 - 24, h - 92)
        cx, cy = w / 2, 14 + R
        rect = QRectF(cx - R, cy - R, 2 * R, 2 * R)
        thick = max(10.0, R * 0.16)
        segs = [(-100, -75, T.BAD), (-75, -67, T.WEAK), (-67, -60, T.FAIR), (-60, -50, T.OK), (-50, -20, T.GOOD)]

        def ang(d):  # 180° (izq) -> 0° (der)
            return 180 - (max(DBM_MIN, min(DBM_MAX, d)) - DBM_MIN) / (DBM_MAX - DBM_MIN) * 180

        inner = rect.adjusted(thick / 2, thick / 2, -thick / 2, -thick / 2)
        for a, b, col in segs:
            p.setPen(QPen(_alpha(col, 70), thick, Qt.PenStyle.SolidLine, Qt.PenCapStyle.FlatCap))
            p.drawArc(inner, int(ang(a) * 16), int((ang(b) - ang(a)) * 16))
        if self.dbm is not None:
            for a, b, col in segs:
                if self.dbm > a:
                    bb = min(b, self.dbm)
                    p.setPen(QPen(QColor(col), thick, Qt.PenStyle.SolidLine, Qt.PenCapStyle.FlatCap))
                    p.drawArc(inner, int(ang(a) * 16), int((ang(bb) - ang(a)) * 16))
            rad = math.radians(ang(self.dbm))
            nx, ny = cx + (R - thick * 1.6) * math.cos(rad), cy - (R - thick * 1.6) * math.sin(rad)
            p.setPen(QPen(QColor(T.TEXT), 2.5, cap=Qt.PenCapStyle.RoundCap))
            p.drawLine(QPointF(cx, cy), QPointF(nx, ny))
            p.setBrush(QColor(T.TEXT))
            p.drawEllipse(QPointF(cx, cy), 5, 5)
            lab, col = wm.signal_level(self.dbm)
            p.setPen(QColor(col))
            p.setFont(_font(20, True))
            p.drawText(QRectF(0, cy + 10, w, 32), Qt.AlignmentFlag.AlignCenter, f"{self.dbm:.0f} dBm")
            p.setFont(_font(10, True))
            p.drawText(QRectF(0, cy + 42, w, 18), Qt.AlignmentFlag.AlignCenter, lab)
        else:
            p.setPen(QColor(T.TEXT_DIM))
            p.setFont(_font(10))
            p.drawText(QRectF(0, cy - R * 0.5, w, 30), Qt.AlignmentFlag.AlignCenter, "Selecciona una red")
        p.setPen(QColor(T.TEXT_DIM))
        p.setFont(_font(8))
        p.drawText(QRectF(cx - R - 10, cy + 4, 50, 14), Qt.AlignmentFlag.AlignLeft, "-100")
        p.drawText(QRectF(cx + R - 40, cy + 4, 50, 14), Qt.AlignmentFlag.AlignRight, "-20")
        if self.caption:
            p.drawText(QRectF(0, cy + 62, w, 16), Qt.AlignmentFlag.AlignCenter, self.caption)
