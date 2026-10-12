"""Cálculos de radiofrecuencia: canales, bandas, DFS, distancia, calidad..."""

from __future__ import annotations

import math

# ---------------------------------------------------------------------------
# Canales y frecuencias
# ---------------------------------------------------------------------------

CHANNELS_24 = list(range(1, 15))
CHANNELS_5 = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120,
              124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165, 169, 173, 177]
CHANNELS_6 = list(range(1, 234, 4))

# Canales DFS (Dynamic Frequency Selection) - UNII-2A y UNII-2C
DFS_CHANNELS = set(range(52, 65, 4)) | set(range(100, 145, 4))
# Canales con espera CAC de 10 minutos (radar meteorológico, ETSI)
WEATHER_RADAR_CHANNELS = {120, 124, 128}

UNII_BANDS = [
    # (nombre, canal_ini, canal_fin, descripción)
    ("U-NII-1", 36, 48, "5150-5250 MHz · interior"),
    ("U-NII-2A", 52, 64, "5250-5350 MHz · DFS"),
    ("U-NII-2C", 100, 144, "5470-5730 MHz · DFS"),
    ("U-NII-3", 149, 165, "5735-5835 MHz"),
    ("U-NII-4", 169, 177, "5850-5895 MHz"),
]


def freq_to_channel(freq: float) -> int:
    f = int(round(freq))
    if f == 2484:
        return 14
    if 2412 <= f <= 2472:
        return (f - 2407) // 5
    if 5150 <= f <= 5925:
        return (f - 5000) // 5
    if 5955 <= f <= 7115:
        return (f - 5950) // 5
    return 0


def channel_to_freq(ch: int, band: str) -> float:
    if band == "2.4":
        return 2484.0 if ch == 14 else 2407.0 + 5 * ch
    if band == "5":
        return 5000.0 + 5 * ch
    return 5950.0 + 5 * ch


def band_of(freq: float) -> str:
    if freq < 3000:
        return "2.4"
    if freq < 5940:
        return "5"
    return "6"


def band_label(band: str) -> str:
    return {"2.4": "2.4 GHz", "5": "5 GHz", "6": "6 GHz"}.get(band, band)


def is_dfs(channel: int, band: str) -> bool:
    return band == "5" and channel in DFS_CHANNELS


def unii_of(channel: int, band: str) -> str:
    if band == "6":
        return "U-NII-5..8"
    if band != "5":
        return "ISM"
    for name, a, b, _ in UNII_BANDS:
        if a <= channel <= b:
            return name
    return "-"


def center_freq(freq: float, width: int, primary_ch: int, band: str,
                center1: float | None = None) -> float:
    """Frecuencia central del canal completo (bonding 40/80/160 MHz)."""
    if center1:
        return center1
    if width <= 20:
        return freq
    if band == "2.4":
        # sin información del offset secundario asumimos "por encima" salvo canales altos
        return freq + 10 if primary_ch <= 7 else freq - 10
    # 5/6 GHz: bloques fijos
    base = 5000.0 if band == "5" else 5950.0
    blocks = {40: 8, 80: 16, 160: 32}
    n = blocks.get(width)
    if not n:
        return freq
    if band == "5":
        starts_40 = [36, 44, 52, 60, 100, 108, 116, 124, 132, 140, 149, 157, 165, 173]
        starts_80 = [36, 52, 100, 116, 132, 149, 165]
        starts_160 = [36, 100, 149]
        starts = {40: starts_40, 80: starts_80, 160: starts_160}[width]
        for s in starts:
            if s <= primary_ch < s + n:
                first = base + 5 * s
                return first + (width / 2) - 10
        return freq
    # 6 GHz: canales 1,5,9... bloques alineados
    idx = (primary_ch - 1) // 4
    per = width // 20
    first_idx = (idx // per) * per
    first = base + 5 * (1 + first_idx * 4)
    return first + (width / 2) - 10


# ---------------------------------------------------------------------------
# Potencia y calidad
# ---------------------------------------------------------------------------

def percent_to_dbm(pct: int) -> float:
    """Inversa de la conversión de NetworkManager (-100..-40 dBm -> 0..100 %)."""
    pct = max(0, min(100, pct))
    return round(-100 + pct * 0.6, 1)


def dbm_to_percent(dbm: float) -> int:
    return int(max(0, min(100, (dbm + 100) / 0.6)))


def dbm_to_mw(dbm: float) -> float:
    return 10 ** (dbm / 10.0)


# Umbrales (dBm) -> (etiqueta, color)
SIGNAL_LEVELS = [
    (-50, "Excelente", "#22c55e"),
    (-60, "Muy buena", "#84cc16"),
    (-67, "Buena", "#eab308"),
    (-75, "Débil", "#f97316"),
    (-200, "Muy débil", "#ef4444"),
]


def signal_level(dbm: float) -> tuple[str, str]:
    for thr, label, color in SIGNAL_LEVELS:
        if dbm >= thr:
            return label, color
    return SIGNAL_LEVELS[-1][1], SIGNAL_LEVELS[-1][2]


def signal_color(dbm: float) -> str:
    return signal_level(dbm)[1]


def noise_floor(band: str) -> float:
    return {"2.4": -95.0, "5": -97.0, "6": -97.0}.get(band, -95.0)


def snr(dbm: float, band: str) -> float:
    return round(dbm - noise_floor(band), 1)


def estimate_distance(dbm: float, freq_mhz: float, tx_dbm: float = 20.0,
                      path_exp: float = 3.0) -> float:
    """Distancia estimada (m) con el modelo log-distancia.

    PL(d) = PL(1 m) + 10·n·log10(d)       con PL(1 m) = 20·log10(f_MHz) - 27.55 (FSPL)
    n = exponente de pérdidas: 2.0 espacio libre, 2.7-3.0 vivienda, 3.5+ oficina densa.
    """
    if freq_mhz <= 0:
        return float("nan")
    pl1 = 20 * math.log10(freq_mhz) - 27.55
    exp = (tx_dbm - dbm - pl1) / (10.0 * path_exp)
    return max(0.1, 10 ** exp)


def distance_color(m: float) -> str:
    if m < 5:
        return "#22c55e"
    if m < 12:
        return "#84cc16"
    if m < 25:
        return "#eab308"
    if m < 50:
        return "#f97316"
    return "#ef4444"


# ---------------------------------------------------------------------------
# Generación WiFi (estándar 802.11)
# ---------------------------------------------------------------------------

GEN_COLORS = {
    "Wi-Fi 7": "#e879f9",
    "Wi-Fi 6E": "#a78bfa",
    "Wi-Fi 6": "#38bdf8",
    "Wi-Fi 5": "#34d399",
    "Wi-Fi 4": "#fbbf24",
    "Legacy": "#94a3b8",
}

GEN_STANDARD = {
    "Wi-Fi 7": "802.11be (EHT)",
    "Wi-Fi 6E": "802.11ax (HE) 6 GHz",
    "Wi-Fi 6": "802.11ax (HE)",
    "Wi-Fi 5": "802.11ac (VHT)",
    "Wi-Fi 4": "802.11n (HT)",
    "Legacy": "802.11a/b/g",
}

# Tasas típicas sólo-VHT (Mbit/s) que no existen en HT
_VHT_RATES = {86, 87, 96, 173, 200, 293, 390, 400, 433, 520, 585, 600, 650,
              780, 866, 867, 1040, 1300, 1560, 1733, 2340, 3466}


def infer_generation(band: str, rate_mbps: float, width: int,
                     has_ht=None, has_vht=None, has_he=None, has_eht=None) -> tuple[str, bool]:
    """Devuelve (generación, es_exacta). Si se tienen los IEs (escaneo profundo)
    la detección es exacta; si no, se estima por tasa máxima y ancho de canal."""
    if has_ht is not None:
        if has_eht:
            return "Wi-Fi 7", True
        if has_he:
            return ("Wi-Fi 6E" if band == "6" else "Wi-Fi 6"), True
        if has_vht and band == "5":
            return "Wi-Fi 5", True
        if has_ht:
            return "Wi-Fi 4", True
        return "Legacy", True
    if band == "6":
        return "Wi-Fi 6E", True
    r = int(round(rate_mbps))
    if r >= 2400 and width >= 160:
        return "Wi-Fi 7", False
    if r >= 1000 and (band == "2.4" or width <= 40 or r in (1134, 1170, 1201, 1147)):
        return "Wi-Fi 6", False
    if band == "5" and (width >= 80 or r in _VHT_RATES):
        return "Wi-Fi 5", False
    if r > 54:
        return "Wi-Fi 4", False
    return "Legacy", False


# ---------------------------------------------------------------------------
# Seguridad
# ---------------------------------------------------------------------------

def security_rank(sec: str) -> tuple[str, str]:
    s = sec.upper()
    if not s or s in ("--", "NONE", "OPEN"):
        return "Abierta", "#ef4444"
    if "WEP" in s:
        return "Insegura", "#ef4444"
    if "WPA3" in s or "SAE" in s or "OWE" in s:
        return "Alta", "#22c55e"
    if "WPA2" in s and "WPA1" not in s and "TKIP" not in s:
        return "Buena", "#84cc16"
    if "WPA2" in s:
        return "Mixta", "#eab308"
    return "Débil", "#f97316"
