package com.melvinfranco.airscope;

public final class Theme {
    private Theme() {}

    public static final int BG = 0xFF0B1120;
    public static final int PANEL = 0xFF111A2E;
    public static final int PANEL2 = 0xFF16213A;
    public static final int GRID = 0xFF1F2B45;
    public static final int GRID_STRONG = 0xFF2B3A5C;
    public static final int TEXT = 0xFFE2E8F0;
    public static final int TEXT_DIM = 0xFF8A9BB8;
    public static final int ACCENT = 0xFF22D3EE;
    public static final int ACCENT2 = 0xFF6366F1;
    public static final int DFS = 0xFFF59E0B;

    public static final int[] AP_PALETTE = {
            0xFF22D3EE, 0xFFA78BFA, 0xFFF472B6, 0xFF34D399, 0xFFFBBF24, 0xFF60A5FA, 0xFFFB7185,
            0xFF4ADE80, 0xFFC084FC, 0xFFF97316, 0xFF2DD4BF, 0xFFE879F9, 0xFFFACC15, 0xFF38BDF8,
            0xFFA3E635, 0xFFF87171, 0xFF818CF8, 0xFFFDA4AF, 0xFF5EEAD4, 0xFFFCD34D,
    };

    public static int alpha(int c, int a) {
        return (c & 0x00FFFFFF) | (a << 24);
    }

    public static String hex(int c) {
        return String.format("#%06X", c & 0xFFFFFF);
    }
}
