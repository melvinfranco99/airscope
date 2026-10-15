"""Ventana principal de AirScope."""

from __future__ import annotations

import csv
import os
import sys
import time

from PyQt6.QtCore import (QAbstractTableModel, QModelIndex, QObject, QRectF, QSettings,
                          QSortFilterProxyModel, Qt, QThread, QTimer, pyqtSignal, pyqtSlot)
from PyQt6.QtGui import QAction, QColor, QFont, QIcon, QPainter, QPen
from PyQt6.QtWidgets import (QAbstractItemView, QApplication, QComboBox, QDoubleSpinBox,
                             QFileDialog, QFrame, QGridLayout, QHBoxLayout, QHeaderView,
                             QLabel, QLineEdit, QMainWindow, QMessageBox, QPushButton,
                             QScrollArea, QSpinBox, QSplitter, QStyle, QStyledItemDelegate, QStyleOptionViewItem,
                             QTableView, QTabWidget, QTextBrowser, QToolBar, QVBoxLayout,
                             QWidget, QSizePolicy)

from . import APP_NAME, __version__
from . import charts as C
from . import controller
from . import scanner
from . import theme as T
from . import wifi_math as wm

HERE = os.path.dirname(os.path.abspath(__file__))
DEMO = "--demo" in sys.argv

# ---------------------------------------------------------------------------
# Hilo de escaneo
# ---------------------------------------------------------------------------


class ScanWorker(QObject):
    finished = pyqtSignal(list, object, float)

    @pyqtSlot(str, bool, float, float)
    def run(self, iface, active, txp, n):
        t0 = time.time()
        try:
            if DEMO:
                aps, link = scanner.demo_scan(txp, n)
            else:
                aps, link = scanner.scan(iface or None, active, txp, n)
        except Exception as exc:  # noqa: BLE001
            print("Error de escaneo:", exc, file=sys.stderr)
            aps, link = [], scanner.LinkInfo()
        self.finished.emit(aps, link, time.time() - t0)


# ---------------------------------------------------------------------------
# Tabla
# ---------------------------------------------------------------------------

COLS = ["", "SSID", "BSSID", "Fabricante", "Señal", "Calidad", "SNR", "Distancia", "Canal",
        "Banda", "Ancho", "Frecuencia", "Estándar", "Tasa máx.", "Seguridad", "PMF", "DFS",
        "U-NII", "Clientes", "Uso canal", "P2P GO", "Roaming", "País", "Visto"]
COL_SIGNAL = 4


class APModel(QAbstractTableModel):
    def __init__(self):
        super().__init__()
        self.aps: list[scanner.AccessPoint] = []

    def set_aps(self, aps):
        self.beginResetModel()
        self.aps = aps
        self.endResetModel()

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.aps)

    def columnCount(self, parent=QModelIndex()):
        return len(COLS)

    def headerData(self, s, o, role=Qt.ItemDataRole.DisplayRole):
        if o == Qt.Orientation.Horizontal and role == Qt.ItemDataRole.DisplayRole:
            return COLS[s]
        if o == Qt.Orientation.Horizontal and role == Qt.ItemDataRole.ToolTipRole:
            tips = {
                "Señal": "Potencia recibida (RSSI) en dBm. Verde = cerca/fuerte, rojo = lejos/débil",
                "SNR": "Relación señal/ruido estimada (dB) respecto al ruido de fondo típico",
                "Distancia": "Distancia estimada con el modelo log-distancia",
                "DFS": "Dynamic Frequency Selection: canal compartido con radares (5 GHz)",
                "PMF": "Protected Management Frames (802.11w)",
                "P2P GO": "Wi-Fi Direct Group Owner (impresoras, TV, móviles…)",
                "Roaming": "Itinerancia rápida 802.11k/v/r",
                "Uso canal": "Utilización del canal anunciada por el AP (BSS Load)",
                "Clientes": "Estaciones asociadas anunciadas por el AP (BSS Load)",
                "Estándar": "Generación Wi-Fi. * = estimado por tasa/ancho",
            }
            return tips.get(COLS[s])
        return None

    def data(self, idx, role=Qt.ItemDataRole.DisplayRole):
        if not idx.isValid():
            return None
        ap = self.aps[idx.row()]
        c = COLS[idx.column()]
        if role == Qt.ItemDataRole.UserRole:  # objeto
            return ap
        if role == Qt.ItemDataRole.UserRole + 1:  # clave de ordenación
            return {
                "Señal": ap.dbm, "Calidad": ap.quality, "SNR": ap.snr, "Distancia": ap.distance,
                "Canal": ap.channel, "Ancho": ap.width, "Frecuencia": ap.center,
                "Tasa máx.": ap.max_rate, "Clientes": ap.stations if ap.stations is not None else -1,
                "Uso canal": ap.utilization if ap.utilization is not None else -1,
                "Visto": -ap.last_seen_ms, "": ap.in_use,
            }.get(c, str(self.data(idx) or "").lower())
        if role == Qt.ItemDataRole.DisplayRole:
            if c == "":
                return "★" if ap.in_use else ""
            if c == "SSID":
                return ap.display_ssid
            if c == "BSSID":
                return ap.bssid.upper()
            if c == "Fabricante":
                return ap.vendor or "-"
            if c == "Señal":
                return f"{ap.dbm:.0f} dBm"
            if c == "Calidad":
                return f"{ap.quality}%"
            if c == "SNR":
                return f"{ap.snr:.0f} dB"
            if c == "Distancia":
                return f"~{ap.distance:.1f} m" if ap.distance < 1000 else ">1 km"
            if c == "Canal":
                return str(ap.channel)
            if c == "Banda":
                return wm.band_label(ap.band)
            if c == "Ancho":
                return f"{ap.width} MHz"
            if c == "Frecuencia":
                return f"{ap.freq:.0f} MHz  [{ap.low_freq:.0f}–{ap.high_freq:.0f}]"
            if c == "Estándar":
                return ap.generation + ("" if ap.gen_exact else " *")
            if c == "Tasa máx.":
                return f"{ap.max_rate:.0f} Mbps"
            if c == "Seguridad":
                return ap.security + (f" ({ap.auth})" if ap.auth else "")
            if c == "PMF":
                return ap.pmf
            if c == "DFS":
                if ap.dfs:
                    return "Sí (CAC 10 min)" if ap.channel in wm.WEATHER_RADAR_CHANNELS else "Sí"
                return "No" if ap.band == "5" else "-"
            if c == "U-NII":
                return ap.unii
            if c == "Clientes":
                return str(ap.stations) if ap.stations is not None else "-"
            if c == "Uso canal":
                return f"{ap.utilization:.0f}%" if ap.utilization is not None else "-"
            if c == "P2P GO":
                return "Sí" if ap.p2p_go else ("P2P" if ap.p2p else "No")
            if c == "Roaming":
                return ap.roaming or "-"
            if c == "País":
                return ap.country or "-"
            if c == "Visto":
                if ap.stale:
                    return f"hace {time.time() - ap.updated:.0f} s"
                return f"{ap.last_seen_ms / 1000:.0f} s" if ap.last_seen_ms else "ahora"
        if role == Qt.ItemDataRole.ForegroundRole:
            if ap.stale:
                return QColor("#55627a")
            if c == "":
                return QColor(T.ACCENT)
            if c == "SSID":
                return T.ap_color(ap.bssid)
            if c in ("Señal", "Calidad"):
                return QColor(wm.signal_color(ap.dbm))
            if c == "SNR":
                return QColor(T.GOOD if ap.snr >= 40 else T.OK if ap.snr >= 25 else T.FAIR if ap.snr >= 15 else T.BAD)
            if c == "Distancia":
                return QColor(wm.distance_color(ap.distance))
            if c == "Estándar":
                return QColor(wm.GEN_COLORS.get(ap.generation, T.TEXT))
            if c == "Seguridad":
                return QColor(wm.security_rank(ap.security)[1])
            if c == "DFS" and ap.dfs:
                return QColor(T.DFS_FILL)
            if c == "PMF":
                return QColor(T.GOOD if ap.pmf == "Obligatorio" else T.OK if ap.pmf == "Opcional" else T.TEXT_DIM)
            if c == "Uso canal" and ap.utilization is not None:
                return QColor(T.GOOD if ap.utilization < 30 else T.FAIR if ap.utilization < 60 else T.BAD)
            if c == "P2P GO" and ap.p2p:
                return QColor(T.ACCENT_2)
            if c in ("BSSID", "Fabricante", "Visto", "País", "U-NII"):
                return QColor(T.TEXT_DIM)
        if role == Qt.ItemDataRole.FontRole:
            if c in ("SSID", "Señal") or ap.in_use:
                f = QFont()
                f.setBold(True)
                return f
            if c == "BSSID":
                f = QFont("monospace")
                f.setStyleHint(QFont.StyleHint.Monospace)
                return f
        if role == Qt.ItemDataRole.TextAlignmentRole:
            if c in ("", "Canal", "Calidad", "SNR", "Ancho", "Clientes", "Uso canal", "DFS", "PMF", "P2P GO"):
                return Qt.AlignmentFlag.AlignCenter
        if role == Qt.ItemDataRole.ToolTipRole:
            lab, _ = wm.signal_level(ap.dbm)
            return (f"{ap.display_ssid} — {ap.dbm:.0f} dBm ({lab})"
                    + ("" if ap.dbm_exact else " · dBm estimado a partir del %"))
        return None


class SignalDelegate(QStyledItemDelegate):
    """Dibuja una barra de señal coloreada (verde=cerca, rojo=lejos)."""

    def paint(self, p: QPainter, opt, idx):
        ap = idx.data(Qt.ItemDataRole.UserRole)
        if ap is None:
            return super().paint(p, opt, idx)
        o = QStyleOptionViewItem(opt)
        self.initStyleOption(o, idx)
        o.text = ""
        style = o.widget.style() if o.widget else QApplication.style()
        style.drawControl(QStyle.ControlElement.CE_ItemViewItem, o, p, o.widget)
        p.save()
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        r = QRectF(opt.rect).adjusted(6, 7, -6, -7)
        bar_w = r.width() * 0.48
        frac = max(0.0, min(1.0, (ap.dbm + 100) / 70.0))
        col = QColor(wm.signal_color(ap.dbm))
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(T.GRID))
        p.drawRoundedRect(QRectF(r.left(), r.top(), bar_w, r.height()), 3, 3)
        p.setBrush(col)
        p.drawRoundedRect(QRectF(r.left(), r.top(), max(3, bar_w * frac), r.height()), 3, 3)
        p.setPen(col)
        f = QFont()
        f.setBold(True)
        p.setFont(f)
        p.drawText(QRectF(r.left() + bar_w + 6, opt.rect.top(), r.width() - bar_w - 6, opt.rect.height()),
                   Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft,
                   f"{ap.dbm:.0f} dBm" + ("" if ap.dbm_exact else "≈"))
        p.restore()


class SortProxy(QSortFilterProxyModel):
    def __init__(self):
        super().__init__()
        self.band = "all"
        self.text = ""
        self.setSortRole(Qt.ItemDataRole.UserRole + 1)

    def set_filter(self, band, text):
        self.band = band
        self.text = text.lower()
        self.invalidateFilter()

    def filterAcceptsRow(self, row, parent):
        ap = self.sourceModel().aps[row]
        if self.band != "all" and ap.band != self.band:
            return False
        if self.text and self.text not in (ap.ssid + " " + ap.bssid + " " + ap.vendor).lower():
            return False
        return True

    def lessThan(self, a, b):
        va, vb = a.data(self.sortRole()), b.data(self.sortRole())
        try:
            return va < vb
        except TypeError:
            return str(va) < str(vb)


# ---------------------------------------------------------------------------
# Widgets auxiliares
# ---------------------------------------------------------------------------


class Card(QFrame):
    def __init__(self, title, accent=T.ACCENT):
        super().__init__()
        self.setObjectName("card")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(14, 10, 14, 10)
        lay.setSpacing(2)
        self.t = QLabel(title.upper())
        self.t.setObjectName("cardTitle")
        self.v = QLabel("—")
        self.v.setObjectName("cardValue")
        self.v.setStyleSheet(f"color: {accent};")
        self.s = QLabel("")
        self.s.setObjectName("cardSub")
        lay.addWidget(self.t)
        lay.addWidget(self.v)
        lay.addWidget(self.s)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

    def set(self, value, sub="", color=None):
        self.v.setText(str(value))
        self.s.setText(sub)
        if color:
            self.v.setStyleSheet(f"color: {color};")


class DetailPanel(QWidget):
    FIELDS = [
        ("SSID", "ssid"), ("BSSID", "bssid"), ("Fabricante", "vendor"), ("Señal", "dbm"),
        ("Calidad", "quality"), ("SNR", "snr"), ("Potencia rx", "mw"), ("Distancia", "distance"),
        ("Banda", "band"), ("Canal primario", "channel"), ("Ancho de canal", "width"),
        ("Frecuencia", "freq"), ("Rango ocupado", "range"), ("Canal secundario", "sec"),
        ("Bloque U-NII", "unii"), ("DFS", "dfs"), ("Estándar", "gen"), ("Streams (NSS)", "nss"),
        ("Tasa PHY máx.", "rate"), ("Seguridad", "security"), ("Autenticación", "auth"),
        ("Cifrado", "ciphers"), ("PMF (802.11w)", "pmf"), ("WPS", "wps"), ("Wi-Fi Direct", "p2p"),
        ("Roaming", "roaming"), ("Clientes", "stations"), ("Uso del canal", "util"),
        ("Pot. TX anunciada", "txp"), ("Intervalo beacon", "beacon"), ("País", "country"),
    ]

    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        title = QLabel("Detalles del punto de acceso")
        title.setObjectName("sectionTitle")
        lay.addWidget(title)
        self.gauge = C.SignalGauge()
        lay.addWidget(self.gauge)
        box = QFrame()
        box.setObjectName("card")
        self.grid = QGridLayout(box)
        self.grid.setContentsMargins(12, 10, 12, 10)
        self.grid.setVerticalSpacing(4)
        self.vals = {}
        for i, (lab, key) in enumerate(self.FIELDS):
            l = QLabel(lab)
            l.setStyleSheet(f"color: {T.TEXT_DIM}; background: transparent;")
            v = QLabel("-")
            v.setStyleSheet("background: transparent;")
            v.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
            v.setWordWrap(True)
            self.grid.addWidget(l, i, 0, Qt.AlignmentFlag.AlignTop)
            self.grid.addWidget(v, i, 1)
            self.vals[key] = v
        self.grid.setColumnStretch(1, 1)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(box)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        lay.addWidget(scroll, 1)

    def _set(self, key, text, color=None):
        v = self.vals[key]
        v.setText(str(text))
        v.setStyleSheet(f"background: transparent; color: {color or T.TEXT};")

    def show_ap(self, ap):
        if ap is None:
            self.gauge.set_value(None)
            for v in self.vals.values():
                v.setText("-")
            return
        self.gauge.set_value(ap.dbm, f"{ap.display_ssid} · calidad {ap.quality}%")
        sc = wm.signal_color(ap.dbm)
        self._set("ssid", ap.display_ssid + ("  (conectado)" if ap.in_use else ""), T.ap_color(ap.bssid).name())
        self._set("bssid", ap.bssid.upper())
        self._set("vendor", ap.vendor or "-")
        self._set("dbm", f"{ap.dbm:.0f} dBm  ({wm.signal_level(ap.dbm)[0]})" + ("" if ap.dbm_exact else " ≈"), sc)
        self._set("quality", f"{ap.quality} %", sc)
        self._set("snr", f"{ap.snr:.0f} dB", sc)
        self._set("mw", f"{wm.dbm_to_mw(ap.dbm):.2e} mW")
        self._set("distance", f"≈ {ap.distance:.1f} m", wm.distance_color(ap.distance))
        self._set("band", wm.band_label(ap.band))
        self._set("channel", ap.channel)
        self._set("width", f"{ap.width} MHz")
        self._set("freq", f"{ap.freq:.0f} MHz (centro {ap.center:.0f} MHz)")
        self._set("range", f"{ap.low_freq:.0f} – {ap.high_freq:.0f} MHz")
        self._set("sec", {"above": "Superior (+1)", "below": "Inferior (−1)"}.get(ap.sec_offset, "-"))
        self._set("unii", ap.unii)
        if ap.dfs:
            self._set("dfs", "Sí — el AP debe vigilar radares y puede cambiar de canal"
                      + (" · radar meteorológico (CAC 10 min)" if ap.channel in wm.WEATHER_RADAR_CHANNELS else ""),
                      T.DFS_FILL)
        else:
            self._set("dfs", "No")
        self._set("gen", f"{ap.generation} · {wm.GEN_STANDARD.get(ap.generation, '')}"
                  + ("" if ap.gen_exact else " (estimado)"), wm.GEN_COLORS.get(ap.generation))
        self._set("nss", f"{ap.nss}×{ap.nss} MIMO" if ap.has_ht is not None else "-")
        self._set("rate", f"{ap.max_rate:.0f} Mbps")
        rank, col = wm.security_rank(ap.security)
        self._set("security", f"{ap.security}  [{rank}]", col)
        self._set("auth", ap.auth or "-")
        self._set("ciphers", ap.ciphers or "-")
        self._set("pmf", ap.pmf)
        self._set("wps", ("Activo" + (f" · {ap.wps_info}" if ap.wps_info else "")) if ap.wps else "No",
                  T.WEAK if ap.wps else None)
        self._set("p2p", "Group Owner (GO)" if ap.p2p_go else ("Sí" if ap.p2p else "No"))
        self._set("roaming", ap.roaming or "-")
        self._set("stations", ap.stations if ap.stations is not None else "-")
        self._set("util", f"{ap.utilization:.0f} %" if ap.utilization is not None else "-")
        self._set("txp", f"{ap.tx_power:.0f} dBm" if ap.tx_power else "-")
        self._set("beacon", f"{ap.beacon_int} TU ({ap.beacon_int * 1.024:.0f} ms)" if ap.beacon_int else "-")
        self._set("country", ap.country or "-")


# ---------------------------------------------------------------------------
# Ventana principal
# ---------------------------------------------------------------------------

ENVIRONMENTS = [
    ("Espacio abierto (n=2.0)", 2.0),
    ("Vivienda (n=2.8)", 2.8),
    ("Oficina (n=3.2)", 3.2),
    ("Edificio denso (n=3.8)", 3.8),
]


class MainWindow(QMainWindow):
    requestScan = pyqtSignal(str, bool, float, float)

    def __init__(self):
        super().__init__()
        self.setWindowTitle(f"{APP_NAME} {__version__} — Analizador WiFi" + ("  [DEMO]" if DEMO else ""))
        icon_path = os.path.join(HERE, "airscope.svg")
        if os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))
        self.resize(1500, 950)
        self.settings = QSettings("AirScope", "AirScope")
        self.aps: list[scanner.AccessPoint] = []
        self.link = scanner.LinkInfo()
        self.history: dict[str, list] = {}
        self.selected = ""
        self.busy = False
        self.scan_count = 0

        self._build_toolbar()
        self._build_ui()

        self.thread = QThread(self)
        self.worker = ScanWorker()
        self.worker.moveToThread(self.thread)
        self.requestScan.connect(self.worker.run)
        self.worker.finished.connect(self.on_scan)
        self.thread.start()

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.trigger_scan)
        self.set_running(True)
        QTimer.singleShot(100, lambda: self.trigger_scan(active=False))

    # -- UI ---------------------------------------------------------------
    def _build_toolbar(self):
        tb = QToolBar("Principal")
        tb.setMovable(False)
        self.addToolBar(tb)
        logo = QLabel(f"<span style='color:{T.ACCENT};font-size:15pt;font-weight:700'>◉ Air</span>"
                      f"<span style='color:{T.TEXT};font-size:15pt;font-weight:700'>Scope</span>")
        tb.addWidget(logo)
        tb.addSeparator()
        tb.addWidget(QLabel("Interfaz"))
        self.iface = QComboBox()
        ifs = scanner.wifi_interfaces()
        self.iface.addItems(ifs or ["(ninguna)"])
        tb.addWidget(self.iface)
        self.btn_run = QPushButton("⏸  Pausar")
        self.btn_run.setObjectName("primary")
        self.btn_run.setCheckable(True)
        self.btn_run.clicked.connect(lambda: self.set_running(not self.timer.isActive()))
        tb.addWidget(self.btn_run)
        btn_now = QPushButton("⟳  Escanear ahora")
        btn_now.clicked.connect(lambda: self.trigger_scan(force=True))
        tb.addWidget(btn_now)
        tb.addWidget(QLabel("Intervalo"))
        self.interval = QSpinBox()
        self.interval.setRange(3, 120)
        self.interval.setSuffix(" s")
        self.interval.setValue(int(self.settings.value("interval", 5)))
        self.interval.valueChanged.connect(self._interval_changed)
        tb.addWidget(self.interval)
        tb.addSeparator()
        tb.addWidget(QLabel("Banda"))
        self.band = QComboBox()
        for lab, val in (("Todas", "all"), ("2.4 GHz", "2.4"), ("5 GHz", "5"), ("6 GHz", "6")):
            self.band.addItem(lab, val)
        self.band.currentIndexChanged.connect(self.apply_filter)
        tb.addWidget(self.band)
        self.search = QLineEdit()
        self.search.setPlaceholderText("🔍  Filtrar SSID / BSSID / fabricante")
        self.search.setMinimumWidth(230)
        self.search.textChanged.connect(self.apply_filter)
        tb.addWidget(self.search)
        tb.addSeparator()
        tb.addWidget(QLabel("Pot. TX AP"))
        self.txp = QDoubleSpinBox()
        self.txp.setRange(0, 36)
        self.txp.setSuffix(" dBm")
        self.txp.setValue(float(self.settings.value("txp", 20.0)))
        self.txp.setToolTip("Potencia de transmisión supuesta del AP para estimar la distancia "
                            "(si el AP la anuncia vía TPC se usa la anunciada)")
        tb.addWidget(self.txp)
        self.env = QComboBox()
        for lab, n in ENVIRONMENTS:
            self.env.addItem(lab, n)
        self.env.setCurrentIndex(int(self.settings.value("env", 1)))
        self.env.setToolTip("Entorno: exponente de pérdidas del modelo de distancia")
        tb.addWidget(self.env)
        spacer = QWidget()
        spacer.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        tb.addWidget(spacer)
        btn_ctl = QPushButton("▦  Controlador WLAN")
        btn_ctl.setToolTip("Simulador de controlador: plano, puntos de acceso y mapas de calor")
        btn_ctl.clicked.connect(self.open_controller)
        tb.addWidget(btn_ctl)
        btn_csv = QPushButton("⤓  Exportar CSV")
        btn_csv.clicked.connect(self.export_csv)
        tb.addWidget(btn_csv)
        btn_about = QPushButton("?")
        btn_about.clicked.connect(self.about)
        tb.addWidget(btn_about)

    def _build_ui(self):
        central = QWidget()
        root = QVBoxLayout(central)
        root.setContentsMargins(10, 10, 10, 6)
        root.setSpacing(8)

        cards = QHBoxLayout()
        self.c_total = Card("Puntos de acceso")
        self.c_bands = Card("2.4 / 5 / 6 GHz", T.ACCENT_2)
        self.c_conn = Card("Conectado a", T.GOOD)
        self.c_sig = Card("Señal del enlace", T.GOOD)
        self.c_best24 = Card("Mejor canal 2.4 GHz", T.ACCENT)
        self.c_best5 = Card("Mejor canal 5 GHz", T.ACCENT)
        self.c_sec = Card("Redes inseguras", T.BAD)
        for c in (self.c_total, self.c_bands, self.c_conn, self.c_sig, self.c_best24, self.c_best5, self.c_sec):
            cards.addWidget(c)
        root.addLayout(cards)

        hsplit = QSplitter(Qt.Orientation.Horizontal)
        vsplit = QSplitter(Qt.Orientation.Vertical)

        self.model = APModel()
        self.proxy = SortProxy()
        self.proxy.setSourceModel(self.model)
        self.table = QTableView()
        self.table.setModel(self.proxy)
        self.table.setSortingEnabled(True)
        self.table.sortByColumn(COL_SIGNAL, Qt.SortOrder.DescendingOrder)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.setAlternatingRowColors(True)
        self.table.verticalHeader().setVisible(False)
        self.table.verticalHeader().setDefaultSectionSize(30)
        self.table.setShowGrid(False)
        self.table.setItemDelegateForColumn(COL_SIGNAL, SignalDelegate(self.table))
        hh = self.table.horizontalHeader()
        hh.setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
        hh.setStretchLastSection(True)
        widths = [28, 190, 140, 140, 150, 64, 60, 84, 56, 70, 70, 190, 100, 90, 210, 84, 64, 76, 66, 76, 64, 90, 50, 60]
        for i, w in enumerate(widths):
            self.table.setColumnWidth(i, w)
        self.table.selectionModel().selectionChanged.connect(self.on_select)
        vsplit.addWidget(self.table)

        self.tabs = QTabWidget()
        self.spec24 = C.SpectrumChart("2.4")
        self.spec5 = C.SpectrumChart("5")
        self.spec6 = C.SpectrumChart("6")
        self.timeline = C.TimeChart()
        cong = QWidget()
        cl = QVBoxLayout(cong)
        cl.setContentsMargins(0, 0, 0, 0)
        self.cong24 = C.CongestionChart("2.4")
        self.cong5 = C.CongestionChart("5")
        cl.addWidget(self.cong24)
        cl.addWidget(self.cong5)
        self.radar = C.RadarChart()
        stats = QWidget()
        sl = QGridLayout(stats)
        sl.setContentsMargins(6, 6, 6, 6)
        self.d_band = C.DonutChart("Redes por banda")
        self.d_gen = C.DonutChart("Estándar Wi-Fi")
        self.d_sec = C.DonutChart("Seguridad")
        self.d_sig = C.DonutChart("Calidad de señal")
        self.d_width = C.DonutChart("Ancho de canal")
        self.d_vendor = C.DonutChart("Fabricantes (top 6)")
        for i, d in enumerate((self.d_band, self.d_gen, self.d_sec, self.d_sig, self.d_width, self.d_vendor)):
            sl.addWidget(d, i // 3, i % 3)
        self.diag = QTextBrowser()
        self.diag.setOpenExternalLinks(False)
        self.diag.setStyleSheet(f"background:{T.PANEL}; border:none; padding:10px;")

        self.tabs.addTab(self.spec24, "Espectro 2.4 GHz")
        self.tabs.addTab(self.spec5, "Espectro 5 GHz")
        self.tabs.addTab(self.spec6, "Espectro 6 GHz")
        self.tabs.addTab(self.timeline, "Historial")
        self.tabs.addTab(cong, "Congestión de canales")
        self.tabs.addTab(self.radar, "Radar de proximidad")
        self.tabs.addTab(stats, "Estadísticas")
        self.tabs.addTab(self.diag, "Diagnóstico")
        for ch in (self.spec24, self.spec5, self.spec6, self.radar):
            ch.apSelected.connect(self.select_bssid)
        vsplit.addWidget(self.tabs)
        vsplit.setSizes([380, 470])

        hsplit.addWidget(vsplit)
        self.detail = DetailPanel()
        self.detail.setMinimumWidth(320)
        hsplit.addWidget(self.detail)
        hsplit.setSizes([1150, 350])
        hsplit.setStretchFactor(0, 1)
        root.addWidget(hsplit, 1)
        self.setCentralWidget(central)
        self.status = self.statusBar()
        self.status.showMessage("Iniciando…")

    # -- Escaneo ------------------------------------------------------------
    def set_running(self, run: bool):
        if run:
            self.timer.start(self.interval.value() * 1000)
            self.btn_run.setText("⏸  Pausar")
            self.btn_run.setChecked(False)
        else:
            self.timer.stop()
            self.btn_run.setText("▶  Reanudar")
            self.btn_run.setChecked(True)

    def _interval_changed(self, v):
        self.settings.setValue("interval", v)
        if self.timer.isActive():
            self.timer.start(v * 1000)

    def trigger_scan(self, force=False, active=True):
        if self.busy:
            return
        self.busy = True
        self.status.showMessage("Escaneando…")
        iface = self.iface.currentText()
        if iface.startswith("("):
            iface = ""
        self.requestScan.emit(iface, active, self.txp.value(), self.env.currentData())

    def on_scan(self, aps, link, dt):
        self.busy = False
        self.scan_count += 1
        self.settings.setValue("txp", self.txp.value())
        self.settings.setValue("env", self.env.currentIndex())
        now = time.time()
        prev = {a.bssid: a for a in self.aps}
        seen = {a.bssid for a in aps}
        for old in self.aps:
            # Mantener 30 s las redes que no aparecen en un escaneo puntual
            if old.bssid not in seen and now - old.updated < 30:
                old.stale = True
                aps.append(old)
        aps.sort(key=lambda a: a.dbm, reverse=True)
        if DEMO and self.scan_count == 1:
            import random
            for ap in aps:  # historial simulado de 5 minutos
                v = ap.dbm
                for k in range(100, 0, -1):
                    v = max(-95, min(-25, v + random.uniform(-1.5, 1.5)))
                    self.history.setdefault(ap.bssid, []).append((now - k * 3, v))
        for ap in aps:
            if ap.stale:
                continue
            ap.updated = now
            h = self.history.setdefault(ap.bssid, [])
            h.append((now, ap.dbm))
            old = prev.get(ap.bssid)
            ap.first_seen = old.first_seen if old else now
            ap.dbm_min = min(ap.dbm, old.dbm_min if old else ap.dbm)
            ap.dbm_max = max(ap.dbm, old.dbm_max if old else ap.dbm)
        for b in list(self.history):
            self.history[b] = [x for x in self.history[b] if now - x[0] <= 900]
            if not self.history[b]:
                del self.history[b]
        self.aps = aps
        self.link = link
        self.model.set_aps(aps)
        self.restore_selection()
        self.refresh_views()
        aps = [a for a in aps if not a.stale]
        n_exact = sum(a.dbm_exact for a in aps)
        self.status.showMessage(
            f"Escaneo #{self.scan_count} · {len(aps)} redes · {dt:.1f} s · "
            f"{n_exact}/{len(aps)} con dBm e IEs completos (iw) · {time.strftime('%H:%M:%S')}")

    def filtered(self):
        return [self.proxy.mapToSource(self.proxy.index(r, 0)).row() for r in range(self.proxy.rowCount())]

    def visible_aps(self):
        return [self.model.aps[i] for i in self.filtered()]

    def refresh_views(self):
        vis = self.visible_aps()
        for ch in (self.spec24, self.spec5, self.spec6, self.radar):
            ch.set_data(vis, self.selected)
        self.cong24.set_data(self.aps)
        self.cong5.set_data(self.aps)
        self.timeline.set_history(self.history, vis, self.selected)
        self.update_cards()
        self.update_stats()
        self.update_diag()
        cur = next((a for a in self.aps if a.bssid == self.selected), None)
        self.detail.show_ap(cur)

    def update_cards(self):
        aps = self.aps
        n24 = sum(a.band == "2.4" for a in aps)
        n5 = sum(a.band == "5" for a in aps)
        n6 = sum(a.band == "6" for a in aps)
        self.c_total.set(len(aps), f"{len({a.ssid for a in aps if a.ssid})} SSID únicos · "
                                   f"{sum(a.hidden for a in aps)} ocultas")
        self.c_bands.set(f"{n24} / {n5} / {n6}", f"{sum(a.dfs for a in aps)} en canales DFS")
        if self.link.connected:
            self.c_conn.set(self.link.ssid[:20], f"{self.link.bssid.upper()} · {self.link.freq:.0f} MHz", T.GOOD)
            col = wm.signal_color(self.link.dbm)
            self.c_sig.set(f"{self.link.dbm:.0f} dBm", f"RX {self.link.rx_rate.split(' MBit')[0]} · "
                                                       f"TX {self.link.tx_rate.split(' MBit')[0]} Mbps", col)
        else:
            self.c_conn.set("Sin conexión", "", T.TEXT_DIM)
            self.c_sig.set("—", "", T.TEXT_DIM)
        b24, _ = C.best_channels(aps, "2.4")
        b5, b5all = C.best_channels(aps, "5")
        self.c_best24.set(f"Canal {b24[0]}" if b24 else "—",
                          f"{b24[1]} redes solapadas" if b24 else "")
        sub = f"{b5[1]} redes solapadas" if b5 else ""
        if b5all and b5 and b5all[0] != b5[0]:
            sub += f" · DFS: {b5all[0]}"
        self.c_best5.set(f"Canal {b5[0]}" if b5 else "—", sub)
        insecure = [a for a in aps if wm.security_rank(a.security)[0] in ("Abierta", "Insegura")]
        legacy = [a for a in aps if "WPA1" in a.security or "TKIP" in a.ciphers]
        self.c_sec.set(len(insecure), f"abiertas / WEP · {len(legacy)} con WPA1/TKIP",
                       T.BAD if insecure else (T.FAIR if legacy else T.GOOD))

    def update_stats(self):
        aps = self.aps
        self.d_band.set_data([("2.4 GHz", sum(a.band == "2.4" for a in aps), "#38bdf8"),
                              ("5 GHz", sum(a.band == "5" for a in aps), "#a78bfa"),
                              ("6 GHz", sum(a.band == "6" for a in aps), "#f472b6")])
        self.d_gen.set_data([(g, sum(a.generation == g for a in aps), col) for g, col in wm.GEN_COLORS.items()])
        secs = {}
        for a in aps:
            secs.setdefault(wm.security_rank(a.security), 0)
            secs[wm.security_rank(a.security)] += 1
        self.d_sec.set_data([(k[0], v, k[1]) for k, v in sorted(secs.items(), key=lambda x: -x[1])])
        self.d_sig.set_data([(lab, sum(wm.signal_level(a.dbm)[0] == lab for a in aps), col)
                             for _, lab, col in wm.SIGNAL_LEVELS])
        self.d_width.set_data([(f"{w} MHz", sum(a.width == w for a in aps), col)
                               for w, col in ((20, "#94a3b8"), (40, "#38bdf8"), (80, "#34d399"),
                                              (160, "#a78bfa"), (320, "#f472b6"))])
        vend = {}
        for a in aps:
            vend[a.vendor or "Desconocido"] = vend.get(a.vendor or "Desconocido", 0) + 1
        top = sorted(vend.items(), key=lambda x: -x[1])[:6]
        self.d_vendor.set_data([(k[:22], v, T.AP_PALETTE[i]) for i, (k, v) in enumerate(top)])

    def update_diag(self):
        aps = self.aps
        ok, warn, bad, info = T.GOOD, T.FAIR, T.BAD, T.ACCENT
        items = []

        def add(color, title, text):
            items.append(f"<div style='margin:6px 0;padding:8px 12px;border-left:4px solid {color};"
                         f"background:{T.PANEL_2}'><b style='color:{color}'>{title}</b><br>"
                         f"<span style='color:{T.TEXT}'>{text}</span></div>")

        mine = next((a for a in aps if a.in_use), None)
        if mine:
            lab, col = wm.signal_level(mine.dbm)
            add(col, f"Tu red: {mine.display_ssid} ({mine.dbm:.0f} dBm · {lab})",
                f"Canal {mine.channel} ({wm.band_label(mine.band)}, {mine.width} MHz) · {mine.generation} · "
                f"distancia estimada ≈ {mine.distance:.1f} m · SNR {mine.snr:.0f} dB.")
            same = [a for a in aps if a is not mine and a.band == mine.band and
                    min(a.high_freq, mine.high_freq) - max(a.low_freq, mine.low_freq) > 0 and
                    a.ssid != mine.ssid]
            if same:
                strong = [a for a in same if a.dbm > -75]
                add(bad if len(strong) >= 3 else warn,
                    f"Interferencia: {len(same)} redes ajenas solapan tu canal",
                    f"{len(strong)} con señal relevante (> -75 dBm): "
                    + ", ".join(f"{a.display_ssid} ({a.dbm:.0f})" for a in sorted(same, key=lambda x: -x.dbm)[:6]))
            else:
                add(ok, "Canal limpio", "Ninguna red ajena solapa el canal de tu red.")
            best, _ = C.best_channels(aps, mine.band)
            if best and best[0] != mine.channel and mine.band in ("2.4", "5"):
                add(info, "Recomendación de canal",
                    f"Considera cambiar tu router al canal <b>{best[0]}</b> en {wm.band_label(mine.band)} "
                    f"(índice de interferencia {best[2]:.2f}).")
            if mine.band == "2.4":
                fives = [a for a in aps if a.ssid == mine.ssid and a.band == "5"]
                alt = [a for a in aps if a.band == "5" and a.bssid[:14] == mine.bssid[:14]]
                if fives or alt:
                    a5 = (fives or alt)[0]
                    add(info, "Banda de 5 GHz disponible",
                        f"Tu router emite también en 5 GHz (<b>{a5.display_ssid}</b>, {a5.dbm:.0f} dBm). "
                        "Suele ofrecer más velocidad y menos interferencias a corta distancia.")
        else:
            add(warn, "No conectado", "No hay una red WiFi asociada en esta interfaz.")

        bad24 = [a for a in aps if a.band == "2.4" and a.channel not in (1, 6, 11, 13)]
        if bad24:
            add(warn, f"{len(bad24)} redes de 2.4 GHz en canales solapados",
                "Los canales distintos de 1/6/11 se interfieren con dos grupos a la vez: "
                + ", ".join(f"{a.display_ssid} (c{a.channel})" for a in bad24[:8]))
        wide24 = [a for a in aps if a.band == "2.4" and a.width >= 40]
        if wide24:
            add(warn, f"{len(wide24)} redes usan 40 MHz en 2.4 GHz",
                "Ocupan ~2/3 de la banda: " + ", ".join(a.display_ssid for a in wide24[:8]))
        opens = [a for a in aps if wm.security_rank(a.security)[0] in ("Abierta", "Insegura")]
        if opens:
            add(bad, f"{len(opens)} redes abiertas o con WEP",
                ", ".join(a.display_ssid for a in opens[:10]) + " — el tráfico puede ser interceptado.")
        tkip = [a for a in aps if "WPA1" in a.security or "TKIP" in a.ciphers]
        if tkip:
            add(warn, f"{len(tkip)} redes admiten WPA1/TKIP (obsoleto)",
                ", ".join(a.display_ssid for a in tkip[:10]))
        wps = [a for a in aps if a.wps]
        if wps:
            add(warn, f"{len(wps)} redes con WPS activo", "WPS por PIN es vulnerable a fuerza bruta: "
                + ", ".join(a.display_ssid for a in wps[:10]))
        dfs = [a for a in aps if a.dfs]
        if dfs:
            add(T.DFS_FILL, f"{len(dfs)} redes en canales DFS",
                "Comparten espectro con radares: si se detecta uno, el AP debe abandonar el canal "
                "(desconexiones breves). " + ", ".join(f"{a.display_ssid} (c{a.channel})" for a in dfs[:8]))
        p2p = [a for a in aps if a.p2p]
        if p2p:
            add(T.ACCENT_2, f"{len(p2p)} dispositivos Wi-Fi Direct (P2P GO)",
                ", ".join(a.display_ssid for a in p2p[:8]) + " — impresoras, TVs o móviles actuando como Group Owner.")
        busy = [a for a in aps if a.utilization is not None and a.utilization >= 50]
        if busy:
            add(warn, "Canales muy ocupados (BSS Load)",
                ", ".join(f"{a.display_ssid}: {a.utilization:.0f}% (c{a.channel})" for a in busy[:8]))
        gens = {g: sum(a.generation == g for a in aps) for g in wm.GEN_COLORS}
        add(info, "Resumen de estándares",
            " · ".join(f"{g}: {n}" for g, n in gens.items() if n) or "—")
        self.diag.setHtml(f"<div style='font-size:10pt'>{''.join(items)}</div>")

    # -- Selección / filtros -------------------------------------------------
    def apply_filter(self):
        self.proxy.set_filter(self.band.currentData(), self.search.text())
        self.refresh_views()

    def on_select(self, *_):
        idx = self.table.selectionModel().selectedRows()
        if not idx:
            return
        ap = self.proxy.data(idx[0], Qt.ItemDataRole.UserRole)
        if ap and ap.bssid != self.selected:
            self.selected = ap.bssid
            self.refresh_views()

    def select_bssid(self, bssid):
        self.selected = bssid
        self.restore_selection()
        self.refresh_views()

    def restore_selection(self):
        if not self.selected:
            return
        for r in range(self.proxy.rowCount()):
            idx = self.proxy.index(r, 0)
            ap = self.proxy.data(idx, Qt.ItemDataRole.UserRole)
            if ap and ap.bssid == self.selected:
                self.table.selectionModel().blockSignals(True)
                self.table.selectRow(r)
                self.table.selectionModel().blockSignals(False)
                return

    # -- Otros ------------------------------------------------------------------
    def export_csv(self):
        path, _ = QFileDialog.getSaveFileName(self, "Exportar CSV",
                                              os.path.expanduser(f"~/airscope_{time.strftime('%Y%m%d_%H%M%S')}.csv"),
                                              "CSV (*.csv)")
        if not path:
            return
        fields = ["ssid", "bssid", "vendor", "dbm", "quality", "snr", "distance", "channel", "band", "width",
                  "freq", "center", "generation", "max_rate", "nss", "security", "auth", "ciphers", "pmf",
                  "dfs", "unii", "stations", "utilization", "p2p_go", "wps", "roaming", "country", "in_use"]
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(fields)
            for a in self.aps:
                w.writerow([getattr(a, f) for f in fields])
        self.status.showMessage(f"Exportado a {path}", 6000)

    def open_controller(self):
        w = controller.open_controller()
        if w is None:
            QMessageBox.information(self, "Controlador WLAN",
                                    "Se ha abierto el simulador en tu navegador.\n\n"
                                    "Para verlo dentro de AirScope instala python-pyqt6-webengine "
                                    "(Arch) o python3-pyqt6.qtwebengine (Debian/Ubuntu).")
        else:
            self._controllers = getattr(self, "_controllers", []) + [w]

    def about(self):
        QMessageBox.about(self, f"Acerca de {APP_NAME}",
                          f"<h2>{APP_NAME} {__version__}</h2>"
                          "<p>Analizador WiFi profesional para Linux.</p>"
                          "<p>Fuentes: NetworkManager (nmcli) e iw (nl80211), sin necesidad de root.</p>"
                          "<p><b>Colores de señal</b>: verde ≥ -50 dBm (excelente), lima ≥ -60, "
                          "amarillo ≥ -67, naranja ≥ -75, rojo &lt; -75 dBm.</p>"
                          "<p><b>Distancia</b>: modelo log-distancia "
                          "d = 10^((P<sub>TX</sub> − RSSI − PL<sub>1m</sub>) / 10n).</p>"
                          "<p>Estándar marcado con * = estimado por tasa y ancho de canal "
                          "(cuando el kernel no aporta los Information Elements).</p>")

    def closeEvent(self, e):
        self.timer.stop()
        self.thread.quit()
        self.thread.wait(3000)
        super().closeEvent(e)


def main():
    if "--help" in sys.argv or "-h" in sys.argv:
        print(f"{APP_NAME} {__version__} - Analizador WiFi\n\nUso: airscope [--demo] [--controller]\n"
              "  --demo         usa datos sintéticos (sin tarjeta WiFi)\n"
              "  --controller   abre solo el simulador de controlador WLAN")
        return
    if "--version" in sys.argv:
        print(__version__)
        return
    QApplication.setApplicationName(APP_NAME)
    QApplication.setDesktopFileName("airscope")
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    app.setStyleSheet(T.STYLESHEET)
    if "--controller" in sys.argv:
        w = controller.open_controller()
        if w is None:
            return
    else:
        w = MainWindow()
        w.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
