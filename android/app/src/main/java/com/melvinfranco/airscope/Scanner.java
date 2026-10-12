package com.melvinfranco.airscope;

import android.content.Context;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.os.Build;
import android.os.SystemClock;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/** Convierte los ScanResult de Android en objetos Ap enriquecidos. */
public final class Scanner {
    private Scanner() {}

    private static Map<String, String> oui;

    public static synchronized void loadOui(Context ctx) {
        if (oui != null) return;
        oui = new HashMap<>();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(ctx.getAssets().open("oui.txt"), "UTF-8"))) {
            String line;
            while ((line = br.readLine()) != null) {
                int t = line.indexOf('\t');
                if (t > 0) oui.put(line.substring(0, t), line.substring(t + 1));
            }
        } catch (Exception ignored) {
        }
    }

    public static String vendor(String bssid) {
        String mac = bssid.toUpperCase().replace(":", "");
        if (mac.length() < 6) return "";
        try {
            if ((Integer.parseInt(mac.substring(0, 2), 16) & 0x02) != 0) return "(MAC local)";
        } catch (NumberFormatException e) {
            return "";
        }
        String v = oui == null ? null : oui.get(mac.substring(0, 6));
        return v == null ? "" : v;
    }

    public static List<Ap> convert(List<ScanResult> results, WifiInfo info, float txp, float n) {
        List<Ap> out = new ArrayList<>();
        String cur = info != null ? info.getBSSID() : null;
        long nowUs = SystemClock.elapsedRealtime() * 1000;
        for (ScanResult r : results) {
            Ap a = new Ap();
            a.bssid = r.BSSID == null ? "" : r.BSSID.toLowerCase();
            a.ssid = r.SSID == null ? "" : r.SSID;
            if (a.ssid.equals("<unknown ssid>")) a.ssid = "";
            a.freq = r.frequency;
            a.band = WifiMath.bandOf(r.frequency);
            a.channel = WifiMath.freqToChannel(r.frequency);
            a.dbm = r.level;
            a.seenMs = Math.max(0, (nowUs - r.timestamp) / 1000);
            switch (r.channelWidth) {
                case ScanResult.CHANNEL_WIDTH_40MHZ: a.width = 40; break;
                case ScanResult.CHANNEL_WIDTH_80MHZ:
                case ScanResult.CHANNEL_WIDTH_80MHZ_PLUS_MHZ: a.width = 80; break;
                case ScanResult.CHANNEL_WIDTH_160MHZ: a.width = 160; break;
                case 5: a.width = 320; break; // CHANNEL_WIDTH_320MHZ (API 33)
                default: a.width = 20;
            }
            if (a.width > 20 && r.centerFreq0 > 0) {
                a.center = r.centerFreq0;
                if (a.width == 160 && r.centerFreq1 > 0 && Math.abs(r.centerFreq1 - r.centerFreq0) == 40) a.center = r.centerFreq1;
            } else {
                a.center = 0;
            }
            parseCapabilities(a, r.capabilities == null ? "" : r.capabilities);
            boolean hasHt = false, hasVht = false, hasHe = false, hasEht = false;
            if (Build.VERSION.SDK_INT >= 30) {
                try {
                    for (ScanResult.InformationElement ie : r.getInformationElements()) {
                        int id = ie.getId(), ext = ie.getIdExt();
                        ByteBuffer bb = ie.getBytes();
                        byte[] b = new byte[bb.remaining()];
                        bb.duplicate().get(b);
                        if (id == 45) { hasHt = true; a.nss = Math.max(a.nss, htNss(b)); }
                        else if (id == 191) { hasVht = true; a.nss = Math.max(a.nss, vhtNss(b, 4)); }
                        else if (id == 255 && ext == 35) { hasHe = true; a.nss = Math.max(a.nss, vhtNss(b, 17)); }
                        else if (id == 255 && ext == 108) hasEht = true;
                        else if (id == 61 && b.length > 1) {
                            int o = b[1] & 0x03;
                            a.secOffset = o == 1 ? 1 : (o == 3 ? -1 : 0);
                        } else parseIe(a, id, b);
                    }
                } catch (Throwable ignored) {
                }
                int std = r.getWifiStandard();
                switch (std) {
                    case 8: a.generation = "Wi-Fi 7"; a.genExact = true; break;
                    case 6: a.generation = a.band.equals("6") ? "Wi-Fi 6E" : "Wi-Fi 6"; a.genExact = true; break;
                    case 5: a.generation = "Wi-Fi 5"; a.genExact = true; break;
                    case 4: a.generation = "Wi-Fi 4"; a.genExact = true; break;
                    case 1: a.generation = "Legacy"; a.genExact = true; break;
                    default: break;
                }
                if (hasEht) { a.generation = "Wi-Fi 7"; a.genExact = true; }
            }
            if (!a.genExact) {
                if (hasHe) a.generation = a.band.equals("6") ? "Wi-Fi 6E" : "Wi-Fi 6";
                else if (hasVht && a.band.equals("5")) a.generation = "Wi-Fi 5";
                else if (hasHt) a.generation = "Wi-Fi 4";
                else if (a.band.equals("6")) a.generation = "Wi-Fi 6E";
                else if (a.band.equals("5") && a.width >= 80) a.generation = "Wi-Fi 5";
                else if (a.width >= 40) a.generation = "Wi-Fi 4";
                a.genExact = hasHt || hasVht || hasHe;
            }
            a.inUse = cur != null && cur.equalsIgnoreCase(a.bssid);
            finish(a, txp, n);
            out.add(a);
        }
        Collections.sort(out, (x, y) -> Float.compare(y.dbm, x.dbm));
        return out;
    }

    static void finish(Ap a, float txp, float n) {
        if (a.center == 0) {
            if (a.width == 40 && a.secOffset != 0) a.center = a.freq + 10 * a.secOffset;
            else a.center = WifiMath.centerFreq(a.freq, a.width, a.channel, a.band);
        }
        a.dfs = WifiMath.isDfs(a.channel, a.band);
        a.unii = WifiMath.uniiOf(a.channel, a.band);
        if (a.vendor.isEmpty()) a.vendor = vendor(a.bssid);
        if (!a.p2p && a.ssid.startsWith("DIRECT-")) { a.p2p = true; a.p2pGo = true; }
        float tx = a.txPower != null ? a.txPower : txp;
        a.distance = WifiMath.estimateDistance(a.dbm, a.freq, tx, n);
        a.snr = a.dbm - WifiMath.noiseFloor(a.band);
        a.quality = WifiMath.quality(a.dbm);
        a.maxRate = WifiMath.theoreticalRate(a.generation, a.width, a.nss);
    }

    static void parseCapabilities(Ap a, String caps) {
        String c = caps.toUpperCase();
        List<String> parts = new ArrayList<>();
        if (c.contains("WEP")) parts.add("WEP");
        if (c.contains("[WPA-")) parts.add("WPA1");
        if (c.contains("RSN") || c.contains("WPA2")) parts.add("WPA2");
        if (c.contains("SAE") || c.contains("WPA3")) parts.add("WPA3");
        if (c.contains("OWE")) parts.add("OWE");
        a.security = parts.isEmpty() ? "Abierta" : String.join(" ", parts);
        List<String> au = new ArrayList<>();
        if (c.contains("EAP") || c.contains("802.1X")) au.add("802.1X");
        if (c.contains("PSK")) au.add("PSK");
        if (c.contains("SAE")) au.add("SAE");
        if (c.contains("FT/")) au.add("FT");
        a.auth = String.join(" ", au);
        List<String> ci = new ArrayList<>();
        if (c.contains("CCMP")) ci.add("CCMP");
        if (c.contains("TKIP")) ci.add("TKIP");
        if (c.contains("GCMP")) ci.add("GCMP");
        a.ciphers = String.join(" ", ci);
        a.wps = c.contains("WPS");
        a.pmf = a.security.equals("Abierta") ? "-" : "No";
    }

    static int htNss(byte[] b) {
        if (b.length < 7) return 1;
        int n = 0;
        for (int i = 3; i < 7; i++) if (b[i] != 0) n++;
        return Math.max(1, n);
    }

    static int vhtNss(byte[] b, int off) {
        if (b.length < off + 2) return 1;
        int map = (b[off] & 0xFF) | ((b[off + 1] & 0xFF) << 8);
        int n = 0;
        for (int i = 0; i < 8; i++) if (((map >> (2 * i)) & 3) != 3) n = i + 1;
        return Math.max(1, n);
    }

    static void parseIe(Ap a, int id, byte[] b) {
        switch (id) {
            case 7:
                if (b.length >= 2) a.country = new String(b, 0, 2).replaceAll("[^A-Za-z]", "");
                break;
            case 11:
                if (b.length >= 3) {
                    a.stations = (b[0] & 0xFF) | ((b[1] & 0xFF) << 8);
                    a.utilization = Math.round((b[2] & 0xFF) * 100f / 255f);
                }
                break;
            case 35:
                if (b.length >= 1) a.txPower = (int) b[0];
                break;
            case 48:
                parseRsn(a, b);
                break;
            case 54:
                a.ft = true;
                break;
            case 70:
                a.rrm = true;
                break;
            case 127:
                if (b.length >= 3 && (b[2] & 0x08) != 0) a.btm = true;
                break;
            case 221:
                if (b.length >= 4) {
                    int o1 = b[0] & 0xFF, o2 = b[1] & 0xFF, o3 = b[2] & 0xFF, t = b[3] & 0xFF;
                    if (o1 == 0x50 && o2 == 0x6F && o3 == 0x9A && t == 9) {
                        a.p2p = true;
                        int i = 4;
                        while (i + 3 <= b.length) {
                            int aid = b[i] & 0xFF, len = (b[i + 1] & 0xFF) | ((b[i + 2] & 0xFF) << 8);
                            if (aid == 2 && i + 4 < b.length && len >= 2) {
                                if ((b[i + 4] & 0x01) != 0) a.p2pGo = true;
                            }
                            i += 3 + len;
                        }
                    } else if (o1 == 0x00 && o2 == 0x50 && o3 == 0xF2 && t == 4) {
                        a.wps = true;
                    }
                }
                break;
            default:
                break;
        }
    }

    static void parseRsn(Ap a, byte[] b) {
        try {
            int i = 2 + 4; // versión + cipher de grupo
            int pc = (b[i] & 0xFF) | ((b[i + 1] & 0xFF) << 8);
            i += 2;
            List<String> ci = new ArrayList<>();
            for (int k = 0; k < pc; k++, i += 4) {
                int t = b[i + 3] & 0xFF;
                String s = t == 2 ? "TKIP" : t == 4 ? "CCMP" : (t == 8 || t == 9) ? "GCMP" : null;
                if (s != null && !ci.contains(s)) ci.add(s);
            }
            if (!ci.isEmpty()) a.ciphers = String.join(" ", ci);
            int ac = (b[i] & 0xFF) | ((b[i + 1] & 0xFF) << 8);
            i += 2;
            List<String> au = new ArrayList<>();
            for (int k = 0; k < ac; k++, i += 4) {
                int t = b[i + 3] & 0xFF;
                String s;
                switch (t) {
                    case 1: s = "802.1X"; break;
                    case 2: s = "PSK"; break;
                    case 3: s = "FT/802.1X"; break;
                    case 4: s = "FT/PSK"; break;
                    case 8: case 24: s = "SAE"; break;
                    case 9: case 25: s = "FT/SAE"; break;
                    case 18: s = "OWE"; break;
                    default: s = null;
                }
                if (s != null && !au.contains(s)) au.add(s);
            }
            if (!au.isEmpty()) a.auth = String.join(" ", au);
            if (i + 1 < b.length) {
                int caps = (b[i] & 0xFF) | ((b[i + 1] & 0xFF) << 8);
                a.pmf = (caps & 0x40) != 0 ? "Obligatorio" : (caps & 0x80) != 0 ? "Opcional" : "No";
            }
        } catch (ArrayIndexOutOfBoundsException ignored) {
        }
    }

    // ---------------------------------------------------------------------
    // Modo demostración
    // ---------------------------------------------------------------------
    private static final Object[][] DEMO = {
            // ssid, bssid, freq, width, dbm, gen, sec, nss, stations, util, p2p
            {"Casa_WiFi6", "02:11:22:33:44:01", 2437, 20, -38, "Wi-Fi 6", "WPA2 WPA3", 2, 4, 18, false},
            {"Casa_WiFi6_5G", "02:11:22:33:44:02", 5180, 80, -45, "Wi-Fi 6", "WPA2 WPA3", 2, 3, 9, false},
            {"Oficina-Pro", "02:aa:bb:cc:00:10", 5500, 80, -62, "Wi-Fi 6", "WPA3", 4, 12, 35, false},
            {"Vecino_2G", "02:aa:bb:cc:00:20", 2412, 20, -71, "Wi-Fi 4", "WPA1 WPA2", 2, -1, -1, false},
            {"Cafeteria_Free", "02:aa:bb:cc:00:30", 2462, 40, -79, "Wi-Fi 4", "Abierta", 1, 7, 61, false},
            {"DIRECT-7A-Printer", "02:aa:bb:cc:00:40", 2437, 20, -66, "Wi-Fi 4", "WPA2", 1, -1, -1, true},
            {"Fibra-5G-Plus", "02:aa:bb:cc:00:50", 5260, 160, -74, "Wi-Fi 6", "WPA2", 2, 2, 12, false},
            {"Tienda_Mesh", "02:aa:bb:cc:00:60", 5745, 80, -83, "Wi-Fi 5", "WPA2", 3, 5, 22, false},
            {"Router-6E", "02:aa:bb:cc:00:70", 6115, 160, -68, "Wi-Fi 6E", "WPA3", 2, 1, 4, false},
            {"Edificio_B", "02:aa:bb:cc:00:80", 2427, 20, -86, "Wi-Fi 4", "WPA2", 2, -1, -1, false},
            {"WiFi7-Lab", "02:aa:bb:cc:00:90", 6275, 320, -59, "Wi-Fi 7", "WPA3", 2, 2, 6, false},
            {"", "02:aa:bb:cc:00:a0", 5620, 40, -77, "Wi-Fi 5", "WPA2", 2, -1, -1, false},
    };
    private static final String[] DEMO_VENDORS = {"Asus", "TP-Link", "Ubiquiti", "Netgear", "Cisco", "HP", "ZTE"};
    private static final Random RND = new Random();

    public static List<Ap> demo(float txp, float n) {
        List<Ap> out = new ArrayList<>();
        int idx = 0;
        for (Object[] d : DEMO) {
            Ap a = new Ap();
            a.ssid = (String) d[0];
            a.bssid = (String) d[1];
            a.freq = (int) d[2];
            a.width = (int) d[3];
            a.dbm = (int) d[4] + RND.nextInt(7) - 3;
            a.band = WifiMath.bandOf(a.freq);
            a.channel = WifiMath.freqToChannel(a.freq);
            a.generation = (String) d[5];
            a.genExact = true;
            a.security = (String) d[6];
            a.auth = a.security.contains("WPA3") ? "SAE" : a.security.equals("Abierta") ? "" : "PSK";
            a.ciphers = a.security.equals("Abierta") ? "" : a.security.contains("WPA1") ? "CCMP TKIP" : "CCMP";
            a.pmf = a.security.equals("WPA3") ? "Obligatorio" : a.security.contains("WPA3") ? "Opcional" : "No";
            a.nss = (int) d[7];
            a.stations = (int) d[8];
            a.utilization = (int) d[9];
            a.p2p = a.p2pGo = (boolean) d[10];
            a.inUse = idx == 0;
            a.country = "ES";
            a.rrm = a.btm = a.generation.startsWith("Wi-Fi 6") || a.generation.equals("Wi-Fi 7");
            a.wps = a.ssid.equals("Vecino_2G");
            a.vendor = DEMO_VENDORS[idx % DEMO_VENDORS.length];
            finish(a, txp, n);
            out.add(a);
            idx++;
        }
        Collections.sort(out, (x, y) -> Float.compare(y.dbm, x.dbm));
        return out;
    }
}
