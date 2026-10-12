package com.melvinfranco.airscope;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Region;
import android.graphics.Shader;
import android.graphics.SweepGradient;
import android.graphics.Typeface;
import android.view.MotionEvent;
import android.view.View;

import java.util.ArrayList;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Gráficas dibujadas con Canvas (port de airscope/charts.py). */
public final class Charts {
    private Charts() {}

    public interface OnApClick { void onAp(Ap ap); }

    /** Segundos desde el arranque (precisión suficiente en float). */
    public static float nowSec() { return android.os.SystemClock.elapsedRealtime() / 1000f; }

    // ---------------------------------------------------------------------
    public abstract static class Base extends View {
        protected final float d;
        protected final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        protected final Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
        protected List<Ap> aps = new ArrayList<>();
        protected String selected = "";
        protected String title = "";
        protected OnApClick listener;
        protected float ml, mr, mt, mb;

        Base(Context c) {
            super(c);
            d = c.getResources().getDisplayMetrics().density;
            ml = dp(40); mr = dp(10); mt = dp(34); mb = dp(36);
        }

        float dp(float v) { return v * d; }

        public void setData(List<Ap> a, String sel) { aps = a; selected = sel == null ? "" : sel; invalidate(); }

        public void setOnApClick(OnApClick l) { listener = l; }

        RectF plot() { return new RectF(ml, mt, getWidth() - mr, getHeight() - mb); }

        void text(Canvas c, String s, float x, float y, float size, int color, boolean bold, Paint.Align al) {
            t.setTextSize(dp(size));
            t.setColor(color);
            t.setTypeface(bold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            t.setTextAlign(al);
            c.drawText(s, x, y, t);
        }

        void bg(Canvas c) {
            c.drawColor(Theme.PANEL);
            if (!title.isEmpty()) text(c, title, dp(12), dp(22), 14, Theme.TEXT, true, Paint.Align.LEFT);
        }

        void empty(Canvas c, String s) {
            text(c, s, getWidth() / 2f, getHeight() / 2f, 13, Theme.TEXT_DIM, false, Paint.Align.CENTER);
        }

        float yOf(float dbm, RectF r) {
            dbm = Math.max(-100, Math.min(-20, dbm));
            return r.bottom - (dbm + 100) / 80f * r.height();
        }

        void dbmAxis(Canvas c, RectF r) {
            int[][] bands = {{-20, -50, WifiMath.GOOD}, {-50, -60, WifiMath.OK}, {-60, -67, WifiMath.FAIR},
                    {-67, -75, WifiMath.WEAK}, {-75, -100, WifiMath.BAD}};
            p.setStyle(Paint.Style.FILL);
            for (int[] b : bands) {
                float y1 = yOf(b[0], r), y2 = yOf(b[1], r);
                p.setColor(b[2]);
                c.drawRect(r.left - dp(5), y1, r.left - dp(2), y2, p);
                p.setColor(Theme.alpha(b[2], 10));
                c.drawRect(r.left, y1, r.right, y2, p);
            }
            p.setStrokeWidth(1);
            for (int v = -100; v <= -20; v += 10) {
                float y = yOf(v, r);
                p.setColor(Theme.GRID);
                p.setStyle(Paint.Style.STROKE);
                c.drawLine(r.left, y, r.right, y, p);
                if (v % 20 == 0)
                    text(c, String.valueOf(v), r.left - dp(8), y + dp(4), 10, Theme.TEXT_DIM, false, Paint.Align.RIGHT);
            }
            p.setStyle(Paint.Style.FILL);
        }
    }

    // ---------------------------------------------------------------------
    public static class Spectrum extends Base {
        private String band = "2.4";
        private final List<Object[]> shapes = new ArrayList<>();

        public Spectrum(Context c) { super(c); }

        public void setBand(String b) {
            band = b;
            title = "Espectro · " + WifiMath.bandLabel(b);
            mt = dp(b.equals("5") ? 48 : 36);
            invalidate();
        }

        float[] range() {
            if (band.equals("2.4")) return new float[]{2399, 2497};
            if (band.equals("5")) return new float[]{5145, 5900};
            return new float[]{5920, 7130};
        }

        float xOf(float f, RectF r) {
            float[] rg = range();
            return r.left + (f - rg[0]) / (rg[1] - rg[0]) * r.width();
        }

        @Override
        protected void onDraw(Canvas c) {
            bg(c);
            RectF r = plot();
            if (band.equals("5")) {
                for (Object[] u : WifiMath.UNII) {
                    float x1 = xOf(WifiMath.channelToFreq((int) u[1], "5") - 10, r);
                    float x2 = xOf(WifiMath.channelToFreq((int) u[2], "5") + 10, r);
                    if ((boolean) u[3]) {
                        p.setColor(Theme.alpha(Theme.DFS, 26));
                        c.drawRect(x1, r.top, x2, r.bottom, p);
                        text(c, "DFS", (x1 + x2) / 2, r.top + dp(12), 10, Theme.DFS, true, Paint.Align.CENTER);
                    }
                    text(c, ((String) u[0]).replace("U-NII-", ""), (x1 + x2) / 2, mt - dp(4), 9, Theme.TEXT_DIM, false, Paint.Align.CENTER);
                }
            }
            dbmAxis(c, r);
            int[] chans = band.equals("2.4") ? WifiMath.CH24 : band.equals("5") ? WifiMath.CH5 : WifiMath.CH6;
            float lastX = -1e9f;
            t.setTextSize(dp(9));
            for (int ch : chans) {
                float x = xOf(WifiMath.channelToFreq(ch, band), r);
                String s = String.valueOf(ch);
                if (x - lastX > t.measureText(s) + dp(5)) {
                    int col = band.equals("2.4") && (ch == 1 || ch == 6 || ch == 11) ? Theme.ACCENT
                            : WifiMath.isDfs(ch, band) ? Theme.DFS : Theme.TEXT_DIM;
                    text(c, s, x, r.bottom + dp(14), 9, col, false, Paint.Align.CENTER);
                    lastX = x;
                }
            }
            text(c, "Canal", r.centerX(), getHeight() - dp(6), 10, Theme.TEXT_DIM, false, Paint.Align.CENTER);
            List<Ap> list = new ArrayList<>();
            for (Ap a : aps) if (a.band.equals(band)) list.add(a);
            shapes.clear();
            if (list.isEmpty()) { empty(c, "No hay redes en " + WifiMath.bandLabel(band)); return; }
            Collections.sort(list, (a, b) -> {
                boolean sa = a.bssid.equals(selected), sb = b.bssid.equals(selected);
                if (sa != sb) return sa ? 1 : -1;
                return Float.compare(a.dbm, b.dbm);
            });
            c.save();
            c.clipRect(r.left, 0, r.right, r.bottom);
            List<RectF> placed = new ArrayList<>();
            List<Object[]> labels = new ArrayList<>();
            for (Ap a : list) {
                float x1 = xOf(a.lowFreq(), r), x2 = xOf(a.highFreq(), r), yt = yOf(a.dbm, r), yb = r.bottom;
                float w = x2 - x1, k = w * 0.12f;
                Path path = new Path();
                path.moveTo(x1, yb);
                path.cubicTo(x1 + k * 0.6f, yb, x1 + k * 0.4f, yt, x1 + k * 1.4f, yt);
                path.lineTo(x2 - k * 1.4f, yt);
                path.cubicTo(x2 - k * 0.4f, yt, x2 - k * 0.6f, yb, x2, yb);
                int col = a.color();
                boolean dim = !selected.isEmpty() && !a.bssid.equals(selected);
                p.setStyle(Paint.Style.FILL);
                p.setShader(new LinearGradient(0, yt, 0, yb, Theme.alpha(col, dim ? 30 : 110), Theme.alpha(col, dim ? 5 : 25), Shader.TileMode.CLAMP));
                c.drawPath(path, p);
                p.setShader(null);
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(dp(a.bssid.equals(selected) ? 2.6f : 1.5f));
                p.setColor(Theme.alpha(col, dim ? 70 : 255));
                c.drawPath(path, p);
                p.setStyle(Paint.Style.FILL);
                shapes.add(new Object[]{path, a});
                labels.add(new Object[]{a, (x1 + x2) / 2, yt, col, dim});
            }
            t.setTextSize(dp(10));
            t.setTypeface(Typeface.DEFAULT_BOLD);
            for (int i = labels.size() - 1; i >= 0; i--) {
                Object[] l = labels.get(i);
                Ap a = (Ap) l[0];
                String s = (a.inUse ? "★ " : "") + a.displaySsid();
                if (s.length() > 18) s = s.substring(0, 17) + "…";
                float tw = t.measureText(s) + dp(6), cx = (float) l[1], yt = (float) l[2];
                RectF rect = new RectF(cx - tw / 2, yt - dp(17), cx + tw / 2, yt - dp(3));
                for (int k = 0; k < 8; k++) {
                    boolean hit = false;
                    for (RectF o : placed) if (RectF.intersects(o, rect)) { hit = true; break; }
                    if (!hit) break;
                    rect.offset(0, -dp(14));
                }
                placed.add(rect);
                p.setColor(Theme.alpha(Theme.PANEL, 180));
                c.drawRoundRect(rect, dp(3), dp(3), p);
                text(c, s, rect.centerX(), rect.bottom - dp(3.5f), 10, Theme.alpha((int) l[3], (boolean) l[4] ? 90 : 255), true, Paint.Align.CENTER);
            }
            c.restore();
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            if (e.getAction() == MotionEvent.ACTION_UP && listener != null) {
                Region clip = new Region(0, 0, getWidth(), getHeight());
                for (int i = shapes.size() - 1; i >= 0; i--) {
                    Region reg = new Region();
                    reg.setPath((Path) shapes.get(i)[0], clip);
                    if (reg.contains((int) e.getX(), (int) e.getY())) { listener.onAp((Ap) shapes.get(i)[1]); return true; }
                }
            }
            return true;
        }
    }

    // ---------------------------------------------------------------------
    public static class History extends Base {
        private Map<String, ArrayDeque<float[]>> hist;
        private final float window = 300f;

        public History(Context c) { super(c); title = "Historial de señal (5 min)"; mb = dp(30); }

        public void setHistory(Map<String, ArrayDeque<float[]>> h, List<Ap> a, String sel) {
            hist = h; aps = a; selected = sel == null ? "" : sel; invalidate();
        }

        @Override
        protected void onDraw(Canvas c) {
            bg(c);
            int legendRows = Math.min(aps.size(), 12);
            mb = dp(30) + dp(18) * ((legendRows + 1) / 2);
            RectF r = plot();
            dbmAxis(c, r);
            float now = nowSec();
            for (int s = 0; s <= 300; s += 60) {
                float x = r.right - s / window * r.width();
                p.setColor(Theme.GRID);
                c.drawLine(x, r.top, x, r.bottom, p);
                text(c, s == 0 ? "ahora" : "-" + s / 60 + "m", x, r.bottom + dp(14), 9, Theme.TEXT_DIM, false,
                        s == 0 ? Paint.Align.RIGHT : s == 300 ? Paint.Align.LEFT : Paint.Align.CENTER);
            }
            if (aps.isEmpty() || hist == null) { empty(c, "Esperando datos…"); return; }
            List<Ap> vis = new ArrayList<>(aps.subList(0, legendRows));
            c.save();
            c.clipRect(r);
            for (Ap a : vis) {
                ArrayDeque<float[]> h = hist.get(a.bssid);
                if (h == null || h.isEmpty()) continue;
                boolean dim = !selected.isEmpty() && !a.bssid.equals(selected);
                Path path = new Path();
                boolean first = true;
                float lx = 0, ly = 0;
                for (float[] pt : h) {
                    if (now - pt[0] > window) continue;
                    float x = r.right - (now - pt[0]) / window * r.width(), y = yOf(pt[1], r);
                    if (first) { path.moveTo(x, y); first = false; } else path.lineTo(x, y);
                    lx = x; ly = y;
                }
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(dp(a.bssid.equals(selected) ? 2.6f : 1.5f));
                p.setColor(Theme.alpha(a.color(), dim ? 60 : 255));
                c.drawPath(path, p);
                p.setStyle(Paint.Style.FILL);
                c.drawCircle(lx, ly, dp(2.5f), p);
            }
            c.restore();
            float y0 = r.bottom + dp(30), colW = (getWidth() - dp(24)) / 2f;
            for (int i = 0; i < vis.size(); i++) {
                Ap a = vis.get(i);
                float x = dp(12) + (i % 2) * colW, y = y0 + (i / 2) * dp(18);
                p.setColor(a.color());
                c.drawRoundRect(new RectF(x, y - dp(9), x + dp(9), y), dp(2), dp(2), p);
                String s = a.displaySsid();
                if (s.length() > 16) s = s.substring(0, 15) + "…";
                text(c, s, x + dp(14), y, 10, a.bssid.equals(selected) || selected.isEmpty() ? Theme.TEXT : Theme.TEXT_DIM, false, Paint.Align.LEFT);
                text(c, String.format("%.0f", a.dbm), x + colW - dp(10), y, 10, WifiMath.signalColor(a.dbm), true, Paint.Align.RIGHT);
            }
        }
    }

    // ---------------------------------------------------------------------
    public static class Congestion extends Base {
        private String band;

        public Congestion(Context c, String band) {
            super(c);
            this.band = band;
            title = "Congestión · " + WifiMath.bandLabel(band);
            ml = dp(12);
            mt = dp(52);
        }

        @Override
        protected void onDraw(Canvas c) {
            bg(c);
            RectF r = plot();
            List<int[]> sc = WifiMath.channelScores(aps, band);
            int max = 200;
            for (int[] s : sc) max = Math.max(max, (int) (s[2] * 1.15));
            float bw = r.width() / sc.size();
            int[][] best = WifiMath.bestChannels(aps, band);
            String rec = best[0] != null ? "★ Recomendado: canal " + best[0][0] : "";
            if (band.equals("5") && best[1] != null && best[0] != null && best[1][0] != best[0][0]) rec += "  (DFS: " + best[1][0] + ")";
            text(c, rec, dp(12), dp(42), 11, Theme.ACCENT, true, Paint.Align.LEFT);
            for (int i = 0; i < sc.size(); i++) {
                int[] s = sc.get(i);
                float x = r.left + i * bw, h = s[2] / (float) max * r.height();
                float ratio = Math.min(1f, s[2] / 200f);
                int col = ratio < .25 ? WifiMath.GOOD : ratio < .45 ? WifiMath.OK : ratio < .65 ? WifiMath.FAIR : ratio < .85 ? WifiMath.WEAK : WifiMath.BAD;
                if (WifiMath.isDfs(s[0], band)) {
                    p.setColor(Theme.alpha(Theme.DFS, 16));
                    c.drawRect(x, r.top, x + bw, r.bottom, p);
                }
                p.setColor(0xFFFFFFFF);
                RectF bar = new RectF(x + bw * .15f, r.bottom - Math.max(h, dp(1.5f)), x + bw * .85f, r.bottom);
                p.setShader(new LinearGradient(0, bar.top, 0, bar.bottom, col, Theme.alpha(col, 90), Shader.TileMode.CLAMP));
                c.drawRoundRect(bar, dp(2), dp(2), p);
                p.setShader(null);
                if (s[1] > 0) text(c, String.valueOf(s[1]), x + bw / 2, bar.top - dp(3), 9, Theme.TEXT, false, Paint.Align.CENTER);
                boolean isBest = best[0] != null && s[0] == best[0][0];
                boolean isBestAll = best[1] != null && s[0] == best[1][0] && !isBest;
                if (isBest || isBestAll)
                    text(c, "★", x + bw / 2, bar.top - dp(15), 14, isBest ? Theme.ACCENT : Theme.DFS, true, Paint.Align.CENTER);
                if (bw > dp(16) || i % 2 == 0)
                    text(c, String.valueOf(s[0]), x + bw / 2, r.bottom + dp(13), 8.5f,
                            isBest ? Theme.ACCENT : WifiMath.isDfs(s[0], band) ? Theme.DFS : Theme.TEXT_DIM, isBest, Paint.Align.CENTER);
            }
            text(c, "nº = redes solapadas · altura = interferencia ponderada", r.centerX(), getHeight() - dp(6), 9, Theme.TEXT_DIM, false, Paint.Align.CENTER);
        }
    }

    // ---------------------------------------------------------------------
    public static class Radar extends Base {
        private static final int[] RINGS = {2, 5, 10, 25, 50, 100};
        private static final float MAXD = 150f;
        private float angle;
        private final List<float[]> pts = new ArrayList<>();
        private final List<Ap> ptAps = new ArrayList<>();

        public Radar(Context c) { super(c); title = "Radar de proximidad"; }

        float rad(double dist, float R) {
            return (float) (R * Math.log10(1 + Math.min(dist, MAXD)) / Math.log10(1 + MAXD));
        }

        @Override
        protected void onDraw(Canvas c) {
            bg(c);
            float legendH = dp(48);
            float cx = getWidth() / 2f, R = Math.min(getWidth() - dp(24), getHeight() - dp(48) - legendH) / 2f;
            float cy = dp(36) + R;
            if (R < dp(40)) return;
            p.setShader(new RadialGradient(cx, cy, R, 0xFF0F2A33, 0xFF0B1626, Shader.TileMode.CLAMP));
            c.drawCircle(cx, cy, R, p);
            p.setShader(null);
            int[] cols = {WifiMath.GOOD, WifiMath.OK, WifiMath.FAIR, WifiMath.FAIR, WifiMath.WEAK, WifiMath.BAD};
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(1);
            for (int i = 0; i < RINGS.length; i++) {
                float rr = rad(RINGS[i], R);
                p.setColor(Theme.alpha(cols[i], 90));
                c.drawCircle(cx, cy, rr, p);
                text(c, RINGS[i] + " m", cx + dp(3), cy - rr - dp(2), 8.5f, Theme.alpha(cols[i], 210), false, Paint.Align.LEFT);
            }
            p.setColor(Theme.GRID);
            for (int a = 0; a < 360; a += 30) {
                double ra = Math.toRadians(a);
                c.drawLine(cx, cy, cx + R * (float) Math.cos(ra), cy + R * (float) Math.sin(ra), p);
            }
            p.setStyle(Paint.Style.FILL);
            SweepGradient sg = new SweepGradient(cx, cy, new int[]{Theme.alpha(Theme.ACCENT, 0), Theme.alpha(Theme.ACCENT, 0), Theme.alpha(Theme.ACCENT, 120)},
                    new float[]{0f, 0.85f, 1f});
            android.graphics.Matrix m = new android.graphics.Matrix();
            m.setRotate(angle, cx, cy);
            sg.setLocalMatrix(m);
            p.setShader(sg);
            c.drawCircle(cx, cy, R, p);
            p.setShader(null);
            p.setColor(Theme.ACCENT);
            c.drawCircle(cx, cy, dp(4), p);
            text(c, "TÚ", cx, cy + dp(15), 9, Theme.ACCENT, true, Paint.Align.CENTER);
            pts.clear();
            ptAps.clear();
            for (Ap a : aps) {
                int h = (int) (((a.bssid.hashCode() * 2654435761L) % 360 + 360) % 360);
                double ang = Math.toRadians(h);
                float rr = rad(a.distance, R);
                float x = cx + rr * (float) Math.cos(ang), y = cy + rr * (float) Math.sin(ang);
                int col = WifiMath.signalColor(a.dbm);
                float diff = ((angle - h) % 360 + 360) % 360;
                float glow = Math.max(0, 1 - diff / 90f);
                float size = dp(4 + 2 * glow + (a.bssid.equals(selected) ? 2 : 0));
                p.setColor(Theme.alpha(col, (int) (60 + 120 * glow)));
                c.drawCircle(x, y, size + dp(4), p);
                p.setColor(col);
                c.drawCircle(x, y, size, p);
                if (a.bssid.equals(selected) || a.inUse) {
                    p.setStyle(Paint.Style.STROKE);
                    p.setStrokeWidth(dp(1.3f));
                    p.setColor(Theme.TEXT);
                    c.drawCircle(x, y, size + dp(6), p);
                    p.setStyle(Paint.Style.FILL);
                }
                String s = a.displaySsid();
                if (s.length() > 14) s = s.substring(0, 13) + "…";
                text(c, s, x + size + dp(3), y + dp(3.5f), 9, Theme.alpha(Theme.TEXT, selected.isEmpty() || a.bssid.equals(selected) ? 230 : 110), true, Paint.Align.LEFT);
                pts.add(new float[]{x, y});
                ptAps.add(a);
            }
            float ly = cy + R + dp(22), lw = getWidth() / 5f;
            for (int i = 0; i < 5; i++) {
                float lx = i * lw + dp(10);
                p.setColor(WifiMath.LEVEL_COL[i]);
                c.drawCircle(lx, ly - dp(3.5f), dp(4), p);
                text(c, WifiMath.LEVEL_LAB[i], lx + dp(7), ly, 8.5f, Theme.TEXT_DIM, false, Paint.Align.LEFT);
            }
            text(c, "Escala logarítmica · distancia estimada", cx, ly + dp(18), 8.5f, Theme.TEXT_DIM, false, Paint.Align.CENTER);
            angle = (angle + 3f) % 360;
            postInvalidateOnAnimation();
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            if (e.getAction() == MotionEvent.ACTION_UP && listener != null) {
                for (int i = 0; i < pts.size(); i++) {
                    if (Math.hypot(e.getX() - pts.get(i)[0], e.getY() - pts.get(i)[1]) < dp(18)) {
                        listener.onAp(ptAps.get(i));
                        return true;
                    }
                }
            }
            return true;
        }
    }

    // ---------------------------------------------------------------------
    public static class Donut extends View {
        private final float d;
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final String title;
        private List<Object[]> data = new ArrayList<>();

        public Donut(Context c, String title) {
            super(c);
            this.title = title;
            d = c.getResources().getDisplayMetrics().density;
        }

        /** items: {label, value(Integer), color(Integer)} */
        public void setData(List<Object[]> items) {
            data = new ArrayList<>();
            for (Object[] o : items) if ((int) o[1] > 0) data.add(o);
            invalidate();
        }

        @Override
        protected void onMeasure(int w, int h) {
            int width = MeasureSpec.getSize(w);
            setMeasuredDimension(width, (int) (Math.max(140 * d, Math.min(width * 0.42f, 190 * d))));
        }

        @Override
        protected void onDraw(Canvas c) {
            c.drawColor(Theme.PANEL);
            p.setTextAlign(Paint.Align.LEFT);
            p.setColor(Theme.TEXT);
            p.setTextSize(13 * d);
            p.setTypeface(Typeface.DEFAULT_BOLD);
            c.drawText(title, 12 * d, 22 * d, p);
            int total = 0;
            for (Object[] o : data) total += (int) o[1];
            float size = Math.min(getWidth() * 0.38f, getHeight() - 44 * d);
            float thick = size * 0.17f;
            RectF rect = new RectF(14 * d + thick / 2, 34 * d + thick / 2, 14 * d + size - thick / 2, 34 * d + size - thick / 2);
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(thick);
            if (total == 0) {
                p.setColor(Theme.GRID);
                c.drawOval(rect, p);
                p.setStyle(Paint.Style.FILL);
                return;
            }
            float start = -90;
            for (Object[] o : data) {
                float sweep = (int) o[1] * 360f / total;
                p.setColor((int) o[2]);
                c.drawArc(rect, start, sweep, false, p);
                start += sweep;
            }
            p.setStyle(Paint.Style.FILL);
            p.setColor(Theme.TEXT);
            p.setTextAlign(Paint.Align.CENTER);
            p.setTextSize(20 * d);
            c.drawText(String.valueOf(total), rect.centerX(), rect.centerY() + 7 * d, p);
            float x = 14 * d + size + 16 * d, y = 46 * d;
            p.setTextSize(11.5f * d);
            p.setTypeface(Typeface.DEFAULT);
            for (Object[] o : data) {
                p.setColor((int) o[2]);
                c.drawRoundRect(new RectF(x, y - 10 * d, x + 10 * d, y), 2 * d, 2 * d, p);
                p.setColor(Theme.TEXT);
                p.setTextAlign(Paint.Align.LEFT);
                String lab = (String) o[0];
                if (lab.length() > 16) lab = lab.substring(0, 15) + "…";
                c.drawText(lab, x + 16 * d, y, p);
                p.setColor(Theme.TEXT_DIM);
                p.setTextAlign(Paint.Align.RIGHT);
                c.drawText((int) o[1] + " (" + Math.round((int) o[1] * 100f / total) + "%)", getWidth() - 12 * d, y, p);
                y += 19 * d;
                if (y > getHeight()) break;
            }
        }
    }

    // ---------------------------------------------------------------------
    public static class Gauge extends View {
        private final float d;
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private Float dbm;
        private String caption = "";

        public Gauge(Context c) {
            super(c);
            d = c.getResources().getDisplayMetrics().density;
        }

        public void setValue(Float v, String cap) { dbm = v; caption = cap; invalidate(); }

        @Override
        protected void onMeasure(int w, int h) {
            setMeasuredDimension(MeasureSpec.getSize(w), (int) (228 * d));
        }

        float ang(float v) { return 180 + (Math.max(-100, Math.min(-20, v)) + 100) / 80f * 180; }

        @Override
        protected void onDraw(Canvas c) {
            c.drawColor(Theme.PANEL);
            float w = getWidth();
            float R = Math.min(w / 2 - 30 * d, 120 * d), cx = w / 2, cy = 16 * d + R;
            float thick = R * 0.16f;
            RectF arc = new RectF(cx - R + thick / 2, cy - R + thick / 2, cx + R - thick / 2, cy + R - thick / 2);
            int[][] segs = {{-100, -75, WifiMath.BAD}, {-75, -67, WifiMath.WEAK}, {-67, -60, WifiMath.FAIR}, {-60, -50, WifiMath.OK}, {-50, -20, WifiMath.GOOD}};
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(thick);
            for (int[] s : segs) {
                p.setColor(Theme.alpha(s[2], 70));
                c.drawArc(arc, ang(s[0]), ang(s[1]) - ang(s[0]), false, p);
            }
            p.setTextAlign(Paint.Align.CENTER);
            if (dbm != null) {
                for (int[] s : segs) {
                    if (dbm > s[0]) {
                        p.setColor(s[2]);
                        c.drawArc(arc, ang(s[0]), ang(Math.min(s[1], dbm)) - ang(s[0]), false, p);
                    }
                }
                double ra = Math.toRadians(ang(dbm));
                float L = R - thick * 1.7f;
                p.setStrokeWidth(2.5f * d);
                p.setStrokeCap(Paint.Cap.ROUND);
                p.setColor(Theme.TEXT);
                c.drawLine(cx, cy, cx + L * (float) Math.cos(ra), cy + L * (float) Math.sin(ra), p);
                p.setStyle(Paint.Style.FILL);
                c.drawCircle(cx, cy, 5 * d, p);
                int col = WifiMath.signalColor(dbm);
                p.setColor(col);
                p.setTypeface(Typeface.DEFAULT_BOLD);
                p.setTextSize(26 * d);
                c.drawText(String.format("%.0f dBm", dbm), cx, cy + 36 * d, p);
                p.setTextSize(13 * d);
                c.drawText(WifiMath.signalLabel(dbm), cx, cy + 56 * d, p);
            }
            p.setStyle(Paint.Style.FILL);
            p.setTypeface(Typeface.DEFAULT);
            p.setColor(Theme.TEXT_DIM);
            p.setTextSize(10 * d);
            c.drawText("-100", cx - R + 12 * d, cy + 14 * d, p);
            c.drawText("-20", cx + R - 12 * d, cy + 14 * d, p);
            if (!caption.isEmpty()) c.drawText(caption, cx, cy + 74 * d, p);
        }
    }

    // ---------------------------------------------------------------------
    /** Barra de señal compacta para la lista. */
    public static class SignalBar extends View {
        private final float d;
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private float dbm = -100;

        public SignalBar(Context c) {
            super(c);
            d = c.getResources().getDisplayMetrics().density;
        }

        public void setDbm(float v) { dbm = v; invalidate(); }

        @Override
        protected void onDraw(Canvas c) {
            float h = getHeight(), w = getWidth();
            float frac = Math.max(0.04f, Math.min(1f, (dbm + 100) / 70f));
            p.setColor(Theme.GRID);
            c.drawRoundRect(new RectF(0, 0, w, h), h / 2, h / 2, p);
            p.setColor(WifiMath.signalColor(dbm));
            c.drawRoundRect(new RectF(0, 0, w * frac, h), h / 2, h / 2, p);
        }
    }
}
