package com.melvinfranco.airscope;

import java.util.ArrayList;
import java.util.List;

/** Cálculos de radiofrecuencia (port de airscope/wifi_math.py). */
public final class WifiMath {
    private WifiMath() {}

    public static final int[] CH24 = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14};
    public static final int[] CH5 = {36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120,
            124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165, 169, 173, 177};
    public static final int[] CH6;

    static {
        CH6 = new int[59];
        for (int i = 0; i < 59; i++) CH6[i] = 1 + 4 * i;
    }

    // name, first channel, last channel, dfs
    public static final Object[][] UNII = {
            {"U-NII-1", 36, 48, false},
            {"U-NII-2A", 52, 64, true},
            {"U-NII-2C", 100, 144, true},
            {"U-NII-3", 149, 165, false},
            {"U-NII-4", 169, 177, false},
    };

    public static int freqToChannel(int f) {
        if (f == 2484) return 14;
        if (f >= 2412 && f <= 2472) return (f - 2407) / 5;
        if (f >= 5150 && f <= 5925) return (f - 5000) / 5;
        if (f >= 5955 && f <= 7115) return (f - 5950) / 5;
        return 0;
    }

    public static float channelToFreq(int ch, String band) {
        if (band.equals("2.4")) return ch == 14 ? 2484f : 2407f + 5 * ch;
        if (band.equals("5")) return 5000f + 5 * ch;
        return 5950f + 5 * ch;
    }

    public static String bandOf(int f) {
        if (f < 3000) return "2.4";
        if (f < 5940) return "5";
        return "6";
    }

    public static String bandLabel(String b) {
        return b + " GHz";
    }

    public static boolean isDfs(int ch, String band) {
        return band.equals("5") && ((ch >= 52 && ch <= 64) || (ch >= 100 && ch <= 144));
    }

    public static boolean isWeatherRadar(int ch, String band) {
        return band.equals("5") && ch >= 120 && ch <= 128;
    }

    public static String uniiOf(int ch, String band) {
        if (band.equals("6")) return "U-NII-5..8";
        if (!band.equals("5")) return "ISM";
        for (Object[] u : UNII) if (ch >= (int) u[1] && ch <= (int) u[2]) return (String) u[0];
        return "-";
    }

    /** Frecuencia central estimada cuando el sistema no la aporta. */
    public static float centerFreq(float freq, int width, int ch, String band) {
        if (width <= 20) return freq;
        if (band.equals("2.4")) return ch <= 7 ? freq + 10 : freq - 10;
        if (band.equals("5")) {
            int[] starts;
            int n;
            if (width == 40) { starts = new int[]{36, 44, 52, 60, 100, 108, 116, 124, 132, 140, 149, 157, 165, 173}; n = 8; }
            else if (width == 80) { starts = new int[]{36, 52, 100, 116, 132, 149, 165}; n = 16; }
            else { starts = new int[]{36, 100, 149}; n = 32; }
            for (int s : starts) if (s <= ch && ch < s + n) return 5000f + 5 * s + width / 2f - 10;
            return freq;
        }
        int idx = (ch - 1) / 4, per = width / 20;
        int first = (idx / per) * per;
        return 5950f + 5 * (1 + first * 4) + width / 2f - 10;
    }

    // --- Señal -----------------------------------------------------------
    public static final int GOOD = 0xFF22C55E, OK = 0xFF84CC16, FAIR = 0xFFEAB308, WEAK = 0xFFF97316, BAD = 0xFFEF4444;
    public static final int[] LEVEL_THR = {-50, -60, -67, -75, -200};
    public static final String[] LEVEL_LAB = {"Excelente", "Muy buena", "Buena", "Débil", "Muy débil"};
    public static final int[] LEVEL_COL = {GOOD, OK, FAIR, WEAK, BAD};

    public static int levelIndex(float dbm) {
        for (int i = 0; i < LEVEL_THR.length; i++) if (dbm >= LEVEL_THR[i]) return i;
        return LEVEL_THR.length - 1;
    }

    public static int signalColor(float dbm) { return LEVEL_COL[levelIndex(dbm)]; }

    public static String signalLabel(float dbm) { return LEVEL_LAB[levelIndex(dbm)]; }

    public static int quality(float dbm) { return (int) Math.max(0, Math.min(100, (dbm + 100) / 0.6f)); }

    public static float noiseFloor(String band) { return band.equals("2.4") ? -95f : -97f; }

    public static double estimateDistance(float dbm, float freq, float txDbm, float n) {
        double pl1 = 20 * Math.log10(freq) - 27.55;
        double exp = (txDbm - dbm - pl1) / (10.0 * n);
        return Math.max(0.1, Math.pow(10, exp));
    }

    public static int distanceColor(double m) {
        if (m < 5) return GOOD;
        if (m < 12) return OK;
        if (m < 25) return FAIR;
        if (m < 50) return WEAK;
        return BAD;
    }

    // --- Generación ----------------------------------------------------------
    public static final String[] GENS = {"Wi-Fi 7", "Wi-Fi 6E", "Wi-Fi 6", "Wi-Fi 5", "Wi-Fi 4", "Legacy"};
    public static final int[] GEN_COL = {0xFFE879F9, 0xFFA78BFA, 0xFF38BDF8, 0xFF34D399, 0xFFFBBF24, 0xFF94A3B8};
    public static final String[] GEN_STD = {"802.11be (EHT)", "802.11ax (HE) 6 GHz", "802.11ax (HE)",
            "802.11ac (VHT)", "802.11n (HT)", "802.11a/b/g"};

    public static int genIndex(String g) {
        for (int i = 0; i < GENS.length; i++) if (GENS[i].equals(g)) return i;
        return GENS.length - 1;
    }

    public static double theoreticalRate(String gen, int width, int nss) {
        double[] w = {20, 40, 80, 160, 320};
        double[] t;
        switch (gen) {
            case "Wi-Fi 7": t = new double[]{172.1, 344.1, 720.6, 1441.2, 2882.4}; break;
            case "Wi-Fi 6E":
            case "Wi-Fi 6": t = new double[]{143.4, 286.8, 600.5, 1201, 1201}; break;
            case "Wi-Fi 5": t = new double[]{96.3, 200, 433.3, 866.7, 866.7}; break;
            case "Wi-Fi 4": t = new double[]{72.2, 150, 150, 150, 150}; break;
            default: return 54;
        }
        int i = 0;
        for (int k = 0; k < w.length; k++) if (width >= w[k]) i = k;
        return Math.round(t[i] * Math.max(1, nss) * 10) / 10.0;
    }

    // --- Seguridad ------------------------------------------------------------
    /** Devuelve {etiqueta, color}. */
    public static Object[] securityRank(String sec) {
        String s = sec.toUpperCase();
        if (s.isEmpty() || s.equals("ABIERTA")) return new Object[]{"Abierta", BAD};
        if (s.contains("WEP")) return new Object[]{"Insegura", BAD};
        if (s.contains("WPA3") || s.contains("SAE") || s.contains("OWE")) return new Object[]{"Alta", GOOD};
        if (s.contains("WPA2") && !s.contains("WPA1") && !s.contains("TKIP")) return new Object[]{"Buena", OK};
        if (s.contains("WPA2")) return new Object[]{"Mixta", FAIR};
        return new Object[]{"Débil", WEAK};
    }

    // --- Congestión ---------------------------------------------------------
    /** Devuelve lista de {canal, nº redes, índice*100}. */
    public static List<int[]> channelScores(List<Ap> aps, String band) {
        int[] chans;
        if (band.equals("2.4")) chans = new int[]{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13};
        else if (band.equals("5")) chans = new int[]{36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120,
                124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165};
        else { chans = new int[15]; for (int i = 0; i < 15; i++) chans[i] = 1 + 16 * i; }
        List<int[]> res = new ArrayList<>();
        for (int ch : chans) {
            float f = channelToFreq(ch, band), lo = f - 10, hi = f + 10;
            int count = 0;
            double score = 0;
            for (Ap a : aps) {
                if (!a.band.equals(band)) continue;
                float ov = Math.min(hi, a.highFreq()) - Math.max(lo, a.lowFreq());
                if (ov > 0) {
                    count++;
                    score += Math.max(0, (a.dbm + 100) / 60.0) * (ov / 20.0);
                }
            }
            res.add(new int[]{ch, count, (int) Math.round(score * 100)});
        }
        return res;
    }

    /** {mejor sin DFS, mejor global} (pueden ser null). */
    public static int[][] bestChannels(List<Ap> aps, String band) {
        List<int[]> sc = channelScores(aps, band);
        int[] bestNd = null, bestAll = null;
        for (int[] s : sc) {
            boolean cand = !band.equals("2.4") || s[0] == 1 || s[0] == 6 || s[0] == 11;
            if (!cand) continue;
            if (bestAll == null || s[2] < bestAll[2]) bestAll = s;
            if (!isDfs(s[0], band) && (bestNd == null || s[2] < bestNd[2])) bestNd = s;
        }
        return new int[][]{bestNd, bestAll};
    }
}
