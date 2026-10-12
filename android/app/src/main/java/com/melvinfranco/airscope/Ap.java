package com.melvinfranco.airscope;

/** Punto de acceso detectado. */
public class Ap {
    public String bssid = "", ssid = "", band = "2.4", vendor = "";
    public int freq, channel, width = 20, nss = 1, quality;
    public float center, dbm = -100;
    public String generation = "Legacy";
    public boolean genExact;
    public String security = "Abierta", auth = "", ciphers = "", pmf = "-";
    public boolean inUse, dfs, p2p, p2pGo, wps, ft, rrm, btm, stale;
    public String unii = "", country = "";
    public int stations = -1, utilization = -1;
    public Integer txPower;
    public double maxRate, distance, snr;
    public int secOffset; // 0 ninguno, 1 superior, -1 inferior
    public long seenMs;   // edad del resultado en ms
    public long updated;

    public String displaySsid() { return ssid == null || ssid.isEmpty() ? "<oculta>" : ssid; }

    public float lowFreq() { return center - width / 2f; }

    public float highFreq() { return center + width / 2f; }

    public String roaming() {
        StringBuilder sb = new StringBuilder();
        if (rrm) sb.append("k");
        if (btm) sb.append(sb.length() > 0 ? "/" : "").append("v");
        if (ft) sb.append(sb.length() > 0 ? "/" : "").append("r");
        return sb.length() == 0 ? "-" : "802.11" + sb;
    }

    public int color() {
        int h = bssid.hashCode() & 0x7fffffff;
        return Theme.AP_PALETTE[h % Theme.AP_PALETTE.length];
    }
}
