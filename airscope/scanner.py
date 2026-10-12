"""Escaneo de redes WiFi.

Fuentes (no requieren root):
  * ``nmcli device wifi rescan``  -> fuerza un escaneo activo vía NetworkManager
  * ``iw dev <if> scan dump``     -> caché del kernel con TODOS los Information
                                     Elements (HT/VHT/HE/EHT, RSN, BSS Load, P2P...)
  * ``nmcli device wifi list``    -> complemento / respaldo
  * ``iw dev <if> link``          -> estado del enlace actual
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field

from . import wifi_math as wm

ENV = dict(os.environ, LC_ALL="C", LANG="C")


def _run(cmd: list[str], timeout: float = 12.0) -> str:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                             env=ENV, errors="replace")
        return out.stdout
    except (OSError, subprocess.SubprocessError):
        return ""


# ---------------------------------------------------------------------------
# Fabricantes (OUI)
# ---------------------------------------------------------------------------

class OuiDB:
    PATHS = ["/usr/share/hwdata/oui.txt", "/usr/share/misc/oui.txt",
             "/usr/share/ieee-data/oui.txt", "/var/lib/ieee-data/oui.txt"]

    def __init__(self):
        self._db: dict[str, str] | None = None

    def _load(self):
        self._db = {}
        for p in self.PATHS:
            if os.path.exists(p):
                try:
                    with open(p, encoding="utf-8", errors="replace") as fh:
                        for line in fh:
                            if "(base 16)" in line:
                                pre, _, name = line.partition("(base 16)")
                                self._db[pre.strip().upper()] = name.strip()
                except OSError:
                    pass
                break

    def lookup(self, bssid: str) -> str:
        if self._db is None:
            self._load()
        mac = bssid.upper().replace(":", "")
        if len(mac) < 6:
            return ""
        first = int(mac[:2], 16)
        if first & 0x02:
            return "(MAC local/aleatoria)"
        name = self._db.get(mac[:6], "")
        # Acortar nombres largos
        if name.islower() or name.isupper():
            name = name.title()
        name = re.sub(r",?\s*(Inc\.?|Ltd\.?|Co\.,?|Corporation|Corp\.?|LLC|GmbH|S\.A\.|Limited|Technologies|Technology)\b.*$",
                      "", name).strip(" ,.")
        return name


OUI = OuiDB()


# ---------------------------------------------------------------------------
# Modelo de datos
# ---------------------------------------------------------------------------

@dataclass
class AccessPoint:
    bssid: str
    ssid: str = ""
    freq: float = 0.0
    channel: int = 0
    band: str = "2.4"
    width: int = 20
    center: float = 0.0
    dbm: float = -100.0
    dbm_exact: bool = False
    rate: float = 0.0
    max_rate: float = 0.0
    nss: int = 1
    security: str = ""
    auth: str = ""
    ciphers: str = ""
    pmf: str = "No"
    in_use: bool = False
    vendor: str = ""
    generation: str = "Legacy"
    gen_exact: bool = False
    has_ht: bool | None = None
    has_vht: bool | None = None
    has_he: bool | None = None
    has_eht: bool | None = None
    dfs: bool = False
    unii: str = ""
    p2p: bool = False
    p2p_go: bool = False
    wps: bool = False
    wps_info: str = ""
    country: str = ""
    beacon_int: int = 0
    stations: int | None = None
    utilization: float | None = None
    tx_power: float | None = None
    roaming: str = ""
    sec_offset: str = ""
    last_seen_ms: int = 0
    # Calculados
    distance: float = 0.0
    snr: float = 0.0
    quality: int = 0
    first_seen: float = field(default_factory=time.time)
    updated: float = field(default_factory=time.time)
    stale: bool = False
    dbm_min: float = 0.0
    dbm_max: float = -200.0

    @property
    def display_ssid(self) -> str:
        return self.ssid if self.ssid else "<oculta>"

    @property
    def hidden(self) -> bool:
        return not self.ssid

    @property
    def low_freq(self) -> float:
        return self.center - self.width / 2

    @property
    def high_freq(self) -> float:
        return self.center + self.width / 2


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

def _split_nmcli(line: str) -> list[str]:
    parts, cur, esc = [], [], False
    for ch in line:
        if esc:
            cur.append(ch)
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == ":":
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return parts


NM_FIELDS = "IN-USE,BSSID,SSID,CHAN,FREQ,RATE,BANDWIDTH,SIGNAL,SECURITY,WPA-FLAGS,RSN-FLAGS,DEVICE"


def parse_nmcli(text: str) -> dict[str, AccessPoint]:
    aps: dict[str, AccessPoint] = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        p = _split_nmcli(line)
        if len(p) < 12:
            continue
        in_use, bssid, ssid, chan, freq, rate, bw, sig, sec, wpa, rsn, _dev = p[:12]
        bssid = bssid.lower()
        try:
            f = float(freq.split()[0])
        except (ValueError, IndexError):
            continue
        ap = AccessPoint(bssid=bssid, ssid=ssid, freq=f)
        ap.channel = int(chan) if chan.isdigit() else wm.freq_to_channel(f)
        ap.band = wm.band_of(f)
        try:
            ap.rate = float(rate.split()[0])
        except (ValueError, IndexError):
            pass
        try:
            ap.width = int(bw.split()[0])
        except (ValueError, IndexError):
            ap.width = 20
        try:
            ap.quality = int(sig)
        except ValueError:
            ap.quality = 0
        ap.dbm = wm.percent_to_dbm(ap.quality)
        ap.security = sec if sec and sec != "--" else "Abierta"
        flags = f"{wpa} {rsn}".lower()
        auths = []
        for k, lab in (("sae", "SAE"), ("psk", "PSK"), ("802.1x", "802.1X"), ("owe", "OWE")):
            if k in flags:
                auths.append(lab)
        ap.auth = " ".join(auths)
        ciph = []
        for k, lab in (("ccmp", "CCMP"), ("tkip", "TKIP"), ("gcmp", "GCMP")):
            if k in flags:
                ciph.append(lab)
        ap.ciphers = " ".join(ciph)
        ap.in_use = in_use.strip() == "*"
        aps[bssid] = ap
    return aps


_BSS_RE = re.compile(r"^BSS ([0-9a-f:]{17})", re.I)


def parse_iw_dump(text: str) -> dict[str, dict]:
    """Parsea la salida de ``iw dev X scan dump`` -> {bssid: dict de campos}."""
    result: dict[str, dict] = {}
    cur: dict | None = None
    section = ""
    for raw in text.splitlines():
        m = _BSS_RE.match(raw)
        if m:
            cur = {"bssid": m.group(1).lower(), "associated": "associated" in raw,
                   "has_ht": False, "has_vht": False, "has_he": False, "has_eht": False,
                   "max_nss": 1, "streams": {}}
            result[cur["bssid"]] = cur
            section = ""
            continue
        if cur is None:
            continue
        line = raw.strip()
        indent = len(raw) - len(raw.lstrip("\t"))
        if indent == 1:
            section = line.split(":")[0]

        if line.startswith("freq:"):
            try:
                cur["freq"] = float(line.split()[1])
            except (ValueError, IndexError):
                pass
        elif line.startswith("signal:"):
            try:
                cur["dbm"] = float(line.split()[1])
            except (ValueError, IndexError):
                pass
        elif line.startswith("last seen:") and "ms ago" in line:
            try:
                cur["last_seen_ms"] = int(line.split()[2])
            except (ValueError, IndexError):
                pass
        elif line.startswith("beacon interval:"):
            try:
                cur["beacon_int"] = int(line.split()[2])
            except (ValueError, IndexError):
                pass
        elif indent == 1 and line.startswith("SSID:"):
            ssid = line[5:].strip()
            if ssid and not re.fullmatch(r"(\\x00)+", ssid):
                cur["ssid"] = _unescape_iw(ssid)
            else:
                cur["ssid"] = ""
        elif line.startswith("DS Parameter set: channel"):
            cur["ds_channel"] = int(line.split()[-1])
        elif line.startswith("Supported rates:") or line.startswith("Extended supported rates:"):
            rates = [float(x.rstrip("*")) for x in line.split(":", 1)[1].split()
                     if re.match(r"^[\d.]+\*?$", x)]
            if rates:
                cur["legacy_max"] = max(cur.get("legacy_max", 0), max(rates))
        elif indent == 1 and line.startswith("Country:"):
            cur["country"] = line.split()[1]
        elif line.startswith("TPC report: TX power:"):
            try:
                cur["tx_power"] = float(line.split()[3])
            except (ValueError, IndexError):
                pass
        elif indent == 1 and line.startswith("HT capabilities"):
            cur["has_ht"] = True
        elif indent == 1 and line.startswith("VHT capabilities"):
            cur["has_vht"] = True
        elif indent == 1 and line.startswith("HE capabilities"):
            cur["has_he"] = True
        elif indent == 1 and line.startswith("EHT capabilities"):
            cur["has_eht"] = True
        elif indent == 1 and line.startswith("RSN:"):
            cur["rsn"] = True
        elif indent == 1 and line.startswith("WPA:"):
            cur["wpa"] = True
        elif indent == 1 and line.startswith("WPS:"):
            cur["wps"] = True
        elif indent == 1 and line.startswith("P2P:"):
            cur["p2p"] = True
            m2 = re.search(r"Group capa:\s*0x([0-9a-f]+)", line, re.I)
            if m2 and int(m2.group(1), 16) & 0x01:
                cur["p2p_go"] = True
        elif indent == 1 and line.startswith("Mobility Domain"):
            cur["ft"] = True
        elif indent == 1 and line.startswith("RM enabled capabilities"):
            cur["rrm"] = True
        elif section in ("RSN", "WPA"):
            if "Authentication suites:" in line:
                cur.setdefault("auth", set()).update(line.split(":", 1)[1].split())
            elif "Pairwise ciphers:" in line:
                cur.setdefault("ciphers", set()).update(line.split(":", 1)[1].split())
            elif "Capabilities:" in line:
                if "MFP-required" in line:
                    cur["pmf"] = "Obligatorio"
                elif "MFP-capable" in line:
                    cur["pmf"] = "Opcional"
        elif section == "WPS":
            for key in ("Manufacturer", "Model", "Device name"):
                if line.startswith(f"* {key}:"):
                    cur.setdefault("wps_info", {})[key] = line.split(":", 1)[1].strip()
        elif section == "BSS Load":
            if "station count:" in line:
                cur["stations"] = int(line.split(":")[1])
            elif "channel utilisation:" in line:
                a, b = line.split(":")[1].strip().split("/")
                cur["utilization"] = round(100.0 * int(a) / int(b), 1)
        elif section == "HT operation":
            if "primary channel:" in line:
                cur["primary"] = int(line.split(":")[1])
            elif "secondary channel offset:" in line:
                cur["sec_offset"] = line.split(":")[1].strip()
            elif "STA channel width:" in line:
                cur["ht_any"] = "any" in line
        elif section == "VHT operation":
            if "channel width:" in line:
                cur["vht_width"] = int(line.split(":")[1].split()[0])
            elif "center freq segment 1:" in line:
                cur["vht_seg1"] = int(line.split(":")[1])
            elif "center freq segment 2:" in line:
                cur["vht_seg2"] = int(line.split(":")[1])
        elif section == "HE Operation" or section == "HE operation":
            if "channel width:" in line.lower():
                m3 = re.search(r"(\d+)\s*MHz", line)
                if m3:
                    cur["he_width"] = int(m3.group(1))
            elif "center freq segment 0" in line.lower() or "center frequency segment 0" in line.lower():
                cur["he_seg0"] = int(re.findall(r"\d+", line.split(":")[1])[0])
            elif "center freq segment 1" in line.lower() or "center frequency segment 1" in line.lower():
                cur["he_seg1"] = int(re.findall(r"\d+", line.split(":")[1])[0])
        elif section == "Extended capabilities":
            if "BSS Transition" in line:
                cur["btm"] = True
        if re.match(r"^\d streams: MCS 0-\d+", line):
            n = int(line[0])
            cur["max_nss"] = max(cur["max_nss"], n)
        m4 = re.search(r"MCS rate indexes supported: 0-(\d+)", line)
        if m4:
            cur["max_nss"] = max(cur["max_nss"], int(m4.group(1)) // 8 + 1)
    return result


def _unescape_iw(s: str) -> str:
    try:
        return bytes(s, "utf-8").decode("unicode_escape").encode("latin-1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        return s


# Tasas PHY máximas por stream (Mbit/s, GI corto, MCS máximo)
_PER_SS = {
    "Wi-Fi 7": {20: 172.1, 40: 344.1, 80: 720.6, 160: 1441.2, 320: 2882.4},
    "Wi-Fi 6E": {20: 143.4, 40: 286.8, 80: 600.5, 160: 1201.0},
    "Wi-Fi 6": {20: 143.4, 40: 286.8, 80: 600.5, 160: 1201.0},
    "Wi-Fi 5": {20: 96.3, 40: 200.0, 80: 433.3, 160: 866.7},
    "Wi-Fi 4": {20: 72.2, 40: 150.0},
}


def theoretical_rate(gen: str, width: int, nss: int, legacy_max: float = 54.0) -> float:
    table = _PER_SS.get(gen)
    if not table:
        return legacy_max or 54.0
    w = width if width in table else max(k for k in table if k <= max(20, width))
    return round(table[w] * max(1, nss), 1)


def apply_iw(ap: AccessPoint, d: dict) -> None:
    """Enriquece un AccessPoint con la información detallada de iw."""
    if "freq" in d:
        ap.freq = d["freq"]
        ap.band = wm.band_of(ap.freq)
        ap.channel = wm.freq_to_channel(ap.freq)
    if "ssid" in d and (d["ssid"] or not ap.ssid):
        ap.ssid = d["ssid"]
    if "dbm" in d:
        ap.dbm = d["dbm"]
        ap.dbm_exact = True
        ap.quality = wm.dbm_to_percent(ap.dbm)
    ap.has_ht, ap.has_vht, ap.has_he, ap.has_eht = d["has_ht"], d["has_vht"], d["has_he"], d["has_eht"]
    ap.nss = d.get("max_nss", 1)
    ap.country = d.get("country", "")
    ap.beacon_int = d.get("beacon_int", 0)
    ap.stations = d.get("stations")
    ap.utilization = d.get("utilization")
    ap.tx_power = d.get("tx_power")
    ap.p2p = d.get("p2p", False)
    ap.p2p_go = d.get("p2p_go", False)
    ap.wps = d.get("wps", False)
    ap.last_seen_ms = d.get("last_seen_ms", 0)
    if d.get("associated"):
        ap.in_use = True
    if "wps_info" in d:
        ap.wps_info = " · ".join(v for v in d["wps_info"].values() if v)
    ap.pmf = d.get("pmf", "No" if d.get("rsn") else "-")
    if d.get("auth"):
        ap.auth = " ".join(sorted(d["auth"]))
    if d.get("ciphers"):
        ap.ciphers = " ".join(sorted(d["ciphers"]))
    if not ap.security or ap.security == "Abierta":
        if d.get("rsn") or d.get("wpa"):
            parts = []
            if d.get("wpa"):
                parts.append("WPA1")
            if d.get("rsn"):
                parts.append("WPA2")
            if "SAE" in ap.auth:
                parts.append("WPA3")
            ap.security = " ".join(parts)
    roam = []
    if d.get("rrm"):
        roam.append("k")
    if d.get("btm"):
        roam.append("v")
    if d.get("ft"):
        roam.append("r")
    ap.roaming = ("802.11" + "/".join(roam)) if roam else "-"
    ap.sec_offset = d.get("sec_offset", "")

    # Ancho de canal y frecuencia central a partir de los IEs
    width = 20
    center = ap.freq
    if d.get("has_ht") and d.get("sec_offset") in ("above", "below") and d.get("ht_any", True):
        width = 40
        center = ap.freq + (10 if d["sec_offset"] == "above" else -10)
    vw = d.get("vht_width", 0)
    if vw >= 1 and ap.band == "5":
        seg1, seg2 = d.get("vht_seg1", 0), d.get("vht_seg2", 0)
        if vw == 2:
            width = 160
            center = wm.channel_to_freq(seg1, "5")
        elif seg2 and abs(seg2 - seg1) == 8:
            width = 160
            center = wm.channel_to_freq(seg2, "5")
        else:
            width = 80
            center = wm.channel_to_freq(seg1, "5") if seg1 else center
    if d.get("he_width"):
        width = d["he_width"]
        seg = d.get("he_seg1") or d.get("he_seg0")
        if seg:
            center = wm.channel_to_freq(seg, ap.band)
    if width >= ap.width or not ap.width:
        ap.width = width
        ap.center = center
    else:
        ap.center = 0.0
    gen, exact = wm.infer_generation(ap.band, ap.rate, ap.width,
                                     ap.has_ht, ap.has_vht, ap.has_he, ap.has_eht)
    ap.generation, ap.gen_exact = gen, exact
    ap.max_rate = theoretical_rate(gen, ap.width, ap.nss, d.get("legacy_max", 54.0))


def finalize(ap: AccessPoint, tx_power: float, path_exp: float) -> None:
    if not ap.center:
        ap.center = wm.center_freq(ap.freq, ap.width, ap.channel, ap.band)
    if ap.has_ht is None:
        ap.generation, ap.gen_exact = wm.infer_generation(ap.band, ap.rate, ap.width)
        ap.max_rate = theoretical_rate(ap.generation, ap.width, 2 if ap.rate > 100 else 1)
    ap.dfs = wm.is_dfs(ap.channel, ap.band)
    ap.unii = wm.unii_of(ap.channel, ap.band)
    ap.vendor = OUI.lookup(ap.bssid)
    if not ap.p2p and ap.ssid.startswith("DIRECT-"):
        ap.p2p = True
        ap.p2p_go = True
    txp = ap.tx_power if ap.tx_power else tx_power
    ap.distance = wm.estimate_distance(ap.dbm, ap.freq, txp, path_exp)
    ap.snr = wm.snr(ap.dbm, ap.band)
    ap.quality = wm.dbm_to_percent(ap.dbm)


# ---------------------------------------------------------------------------
# Escáner
# ---------------------------------------------------------------------------

@dataclass
class LinkInfo:
    connected: bool = False
    ssid: str = ""
    bssid: str = ""
    freq: float = 0.0
    dbm: float = 0.0
    rx_rate: str = ""
    tx_rate: str = ""
    rx_bytes: int = 0
    tx_bytes: int = 0
    txpower: str = ""


def wifi_interfaces() -> list[str]:
    out = _run(["iw", "dev"]) if shutil.which("iw") else ""
    ifs = re.findall(r"Interface\s+(\S+)", out)
    if not ifs:
        out = _run(["nmcli", "-t", "-f", "DEVICE,TYPE", "device"])
        ifs = [l.split(":")[0] for l in out.splitlines() if l.endswith(":wifi")]
    return ifs


def link_info(iface: str) -> LinkInfo:
    li = LinkInfo()
    out = _run(["iw", "dev", iface, "link"])
    m = re.search(r"Connected to ([0-9a-f:]{17})", out)
    if not m:
        return li
    li.connected = True
    li.bssid = m.group(1)
    for key, attr in (("SSID:", "ssid"), ("rx bitrate:", "rx_rate"), ("tx bitrate:", "tx_rate")):
        m2 = re.search(re.escape(key) + r"\s*(.+)", out)
        if m2:
            setattr(li, attr, m2.group(1).strip())
    m2 = re.search(r"freq:\s*([\d.]+)", out)
    if m2:
        li.freq = float(m2.group(1))
    m2 = re.search(r"signal:\s*(-?\d+)", out)
    if m2:
        li.dbm = float(m2.group(1))
    m2 = re.search(r"RX:\s*(\d+)", out)
    if m2:
        li.rx_bytes = int(m2.group(1))
    m2 = re.search(r"TX:\s*(\d+)", out)
    if m2:
        li.tx_bytes = int(m2.group(1))
    info = _run(["iw", "dev", iface, "info"])
    m2 = re.search(r"txpower\s+([\d.]+\s*dBm)", info)
    if m2:
        li.txpower = m2.group(1)
    return li


_IE_CACHE: dict[str, tuple[float, dict]] = {}


def scan(iface: str | None, active: bool = True, tx_power: float = 20.0,
         path_exp: float = 3.0) -> tuple[list[AccessPoint], LinkInfo]:
    if active and shutil.which("nmcli"):
        args = ["nmcli", "device", "wifi", "rescan"]
        if iface:
            args += ["ifname", iface]
        _run(args, timeout=15)
        time.sleep(1.5)
    nm_args = ["nmcli", "-t", "-f", NM_FIELDS, "device", "wifi", "list", "--rescan", "no"]
    if iface:
        nm_args += ["ifname", iface]
    aps = parse_nmcli(_run(nm_args)) if shutil.which("nmcli") else {}
    if iface and shutil.which("iw"):
        now = time.time()
        details = parse_iw_dump(_run(["iw", "dev", iface, "scan", "dump"]))
        for bssid, d in details.items():
            if d.get("last_seen_ms", 0) <= 60000:
                _IE_CACHE[bssid] = (now, d)
        # Reutilizar IEs recientes de APs que nmcli ve pero el kernel ya purgó
        for bssid in aps:
            if bssid not in details and bssid in _IE_CACHE and now - _IE_CACHE[bssid][0] < 300:
                cached = dict(_IE_CACHE[bssid][1])
                cached.pop("dbm", None)  # la potencia antigua no es válida
                details[bssid] = cached
        for bssid, d in details.items():
            # descartar entradas caducadas (> 60 s) que nmcli no ve
            if bssid not in aps and d.get("last_seen_ms", 0) > 60000:
                continue
            ap = aps.get(bssid)
            if ap is None:
                ap = AccessPoint(bssid=bssid)
                aps[bssid] = ap
            apply_iw(ap, d)
    for ap in aps.values():
        finalize(ap, tx_power, path_exp)
    li = link_info(iface) if iface else LinkInfo()
    if li.connected:
        for ap in aps.values():
            ap.in_use = ap.bssid == li.bssid.lower()
    return sorted(aps.values(), key=lambda a: a.dbm, reverse=True), li


# ---------------------------------------------------------------------------
# Modo demostración (datos sintéticos, útil sin tarjeta WiFi o para capturas)
# ---------------------------------------------------------------------------

_DEMO = [
    # ssid, bssid, freq, width, dbm, ht, vht, he, eht, sec, nss, stations, util, p2p
    ("Casa_WiFi6", "02:11:22:33:44:01", 2437, 20, -38, 1, 0, 1, 0, "WPA2 WPA3", 2, 4, 18, 0),
    ("Casa_WiFi6_5G", "02:11:22:33:44:02", 5180, 80, -45, 1, 1, 1, 0, "WPA2 WPA3", 2, 3, 9, 0),
    ("Oficina-Pro", "02:aa:bb:cc:00:10", 5500, 80, -62, 1, 1, 1, 0, "WPA3", 4, 12, 35, 0),
    ("Vecino_2G", "02:aa:bb:cc:00:20", 2412, 20, -71, 1, 0, 0, 0, "WPA1 WPA2", 2, None, None, 0),
    ("Cafeteria_Free", "02:aa:bb:cc:00:30", 2462, 40, -79, 1, 0, 0, 0, "", 1, 7, 61, 0),
    ("DIRECT-7A-Printer", "02:aa:bb:cc:00:40", 2437, 20, -66, 1, 0, 0, 0, "WPA2", 1, None, None, 1),
    ("Fibra-5G-Plus", "02:aa:bb:cc:00:50", 5260, 160, -74, 1, 1, 1, 0, "WPA2", 2, 2, 12, 0),
    ("Tienda_Mesh", "02:aa:bb:cc:00:60", 5745, 80, -83, 1, 1, 0, 0, "WPA2", 3, 5, 22, 0),
    ("Router-6E", "02:aa:bb:cc:00:70", 6115, 160, -68, 1, 0, 1, 0, "WPA3", 2, 1, 4, 0),
    ("Edificio_B", "02:aa:bb:cc:00:80", 2427, 20, -86, 1, 0, 0, 0, "WPA2", 2, None, None, 0),
    ("WiFi7-Lab", "02:aa:bb:cc:00:90", 6275, 320, -59, 1, 0, 1, 1, "WPA3", 2, 2, 6, 0),
    ("", "02:aa:bb:cc:00:a0", 5620, 40, -77, 1, 1, 0, 0, "WPA2", 2, None, None, 0),
]


def demo_scan(tx_power=20.0, path_exp=3.0):
    import random
    aps = []
    for (ssid, bssid, f, w, dbm, ht, vht, he, eht, sec, nss, st, ut, p2p) in _DEMO:
        ap = AccessPoint(bssid=bssid, ssid=ssid, freq=float(f))
        ap.band = wm.band_of(f)
        ap.channel = wm.freq_to_channel(f)
        ap.width = w
        ap.dbm = round(dbm + random.uniform(-3, 3))
        ap.dbm_exact = True
        ap.has_ht, ap.has_vht, ap.has_he, ap.has_eht = bool(ht), bool(vht), bool(he), bool(eht)
        ap.generation, ap.gen_exact = wm.infer_generation(ap.band, 0, w, ap.has_ht, ap.has_vht,
                                                          ap.has_he, ap.has_eht)
        ap.nss = nss
        ap.max_rate = theoretical_rate(ap.generation, w, nss)
        ap.security = sec or "Abierta"
        ap.auth = "SAE" if "WPA3" in sec else ("PSK" if sec else "")
        ap.ciphers = "CCMP" + (" TKIP" if "WPA1" in sec else "") if sec else ""
        ap.pmf = "Obligatorio" if sec == "WPA3" else ("Opcional" if "WPA3" in sec else "No")
        ap.stations, ap.utilization = st, ut
        ap.p2p = ap.p2p_go = bool(p2p)
        ap.in_use = ssid == "Casa_WiFi6"
        ap.country = "ES"
        ap.beacon_int = 100
        ap.roaming = "802.11k/v" if he else "-"
        ap.wps = ssid in ("Vecino_2G", "Casa_WiFi6")
        finalize(ap, tx_power, path_exp)
        ap.vendor = ["Asus", "TP-Link", "Ubiquiti", "Netgear", "Cisco", "HP", "ZTE"][hash(bssid) % 7]
        aps.append(ap)
    li = LinkInfo(connected=True, ssid="Casa_WiFi6", bssid="02:11:22:33:44:01", freq=2437,
                  dbm=aps[0].dbm, rx_rate="286.8 MBit/s", tx_rate="286.8 MBit/s")
    return sorted(aps, key=lambda a: a.dbm, reverse=True), li
