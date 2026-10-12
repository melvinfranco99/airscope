"""Paleta y hoja de estilos (tema oscuro profesional)."""

import hashlib

from PyQt6.QtGui import QColor

BG = "#0b1120"
PANEL = "#111a2e"
PANEL_2 = "#16213a"
GRID = "#1f2b45"
GRID_STRONG = "#2b3a5c"
TEXT = "#e2e8f0"
TEXT_DIM = "#8a9bb8"
ACCENT = "#22d3ee"
ACCENT_2 = "#6366f1"
DFS_FILL = "#f59e0b"

GOOD = "#22c55e"
OK = "#84cc16"
FAIR = "#eab308"
WEAK = "#f97316"
BAD = "#ef4444"

AP_PALETTE = [
    "#22d3ee", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#60a5fa", "#fb7185",
    "#4ade80", "#c084fc", "#f97316", "#2dd4bf", "#e879f9", "#facc15", "#38bdf8",
    "#a3e635", "#f87171", "#818cf8", "#fda4af", "#5eead4", "#fcd34d",
]


def ap_color(bssid: str) -> QColor:
    h = int(hashlib.md5(bssid.encode()).hexdigest()[:8], 16)
    return QColor(AP_PALETTE[h % len(AP_PALETTE)])


STYLESHEET = f"""
QWidget {{
    background: {BG};
    color: {TEXT};
    font-family: "Inter", "Noto Sans", "DejaVu Sans", sans-serif;
    font-size: 10pt;
}}
QMainWindow::separator {{ background: {GRID}; width: 2px; height: 2px; }}
QToolBar {{
    background: {PANEL};
    border: none;
    border-bottom: 1px solid {GRID};
    padding: 6px;
    spacing: 8px;
}}
QToolBar QLabel {{ background: transparent; color: {TEXT_DIM}; }}
QFrame#card {{
    background: {PANEL};
    border: 1px solid {GRID};
    border-radius: 10px;
}}
QLabel#cardTitle {{ color: {TEXT_DIM}; font-size: 8.5pt; background: transparent; letter-spacing: 1px; }}
QLabel#cardValue {{ font-size: 17pt; font-weight: 600; background: transparent; }}
QLabel#cardSub {{ color: {TEXT_DIM}; font-size: 8.5pt; background: transparent; }}
QLabel#sectionTitle {{ font-size: 11pt; font-weight: 600; color: {TEXT}; background: transparent; }}
QPushButton, QToolButton {{
    background: {PANEL_2};
    border: 1px solid {GRID_STRONG};
    border-radius: 6px;
    padding: 5px 12px;
    color: {TEXT};
}}
QPushButton:hover, QToolButton:hover {{ border-color: {ACCENT}; }}
QPushButton:checked, QToolButton:checked {{ background: #0e3a4a; border-color: {ACCENT}; color: {ACCENT}; }}
QPushButton#primary {{ background: {ACCENT}; color: #04202a; font-weight: 600; border: none; }}
QPushButton#primary:checked {{ background: {WEAK}; color: #2a1004; }}
QComboBox, QSpinBox, QDoubleSpinBox, QLineEdit {{
    background: {PANEL_2};
    border: 1px solid {GRID_STRONG};
    border-radius: 6px;
    padding: 4px 8px;
    min-height: 20px;
    selection-background-color: {ACCENT_2};
}}
QComboBox:focus, QLineEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus {{ border-color: {ACCENT}; }}
QComboBox QAbstractItemView {{ background: {PANEL_2}; border: 1px solid {GRID_STRONG}; }}
QTableView {{
    background: {PANEL};
    alternate-background-color: #0f1729;
    gridline-color: {GRID};
    border: 1px solid {GRID};
    border-radius: 8px;
    selection-background-color: #1e3a5f;
    selection-color: {TEXT};
}}
QHeaderView::section {{
    background: {PANEL_2};
    color: {TEXT_DIM};
    border: none;
    border-right: 1px solid {GRID};
    border-bottom: 1px solid {GRID_STRONG};
    padding: 6px 4px;
    font-weight: 600;
    font-size: 8.5pt;
}}
QTabWidget::pane {{ border: 1px solid {GRID}; border-radius: 8px; background: {PANEL}; top: -1px; }}
QTabBar::tab {{
    background: transparent;
    color: {TEXT_DIM};
    padding: 8px 14px;
    border-bottom: 2px solid transparent;
}}
QTabBar::tab:selected {{ color: {ACCENT}; border-bottom: 2px solid {ACCENT}; }}
QTabBar::tab:hover {{ color: {TEXT}; }}
QScrollBar:vertical {{ background: {PANEL}; width: 10px; margin: 0; }}
QScrollBar::handle:vertical {{ background: {GRID_STRONG}; border-radius: 5px; min-height: 30px; }}
QScrollBar:horizontal {{ background: {PANEL}; height: 10px; margin: 0; }}
QScrollBar::handle:horizontal {{ background: {GRID_STRONG}; border-radius: 5px; min-width: 30px; }}
QScrollBar::add-line, QScrollBar::sub-line {{ width: 0; height: 0; }}
QSplitter::handle {{ background: {BG}; }}
QStatusBar {{ background: {PANEL}; color: {TEXT_DIM}; border-top: 1px solid {GRID}; }}
QToolTip {{ background: {PANEL_2}; color: {TEXT}; border: 1px solid {ACCENT}; padding: 6px; }}
QCheckBox {{ background: transparent; }}
QGroupBox {{ border: 1px solid {GRID}; border-radius: 8px; margin-top: 14px; padding-top: 8px; }}
QGroupBox::title {{ subcontrol-origin: margin; left: 10px; color: {TEXT_DIM}; }}
"""
