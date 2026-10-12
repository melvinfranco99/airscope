package com.melvinfranco.airscope;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.location.LocationManager;
import android.net.Uri;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.Html;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.Set;

public class MainActivity extends Activity {

    private static final int REQ_PERM = 7;
    private static final String[] ENV_LAB = {"Espacio abierto (n=2.0)", "Vivienda (n=2.8)", "Oficina (n=3.2)", "Edificio denso (n=3.8)"};
    private static final float[] ENV_N = {2.0f, 2.8f, 3.2f, 3.8f};
    private static final String[] TABS = {"Redes", "Espectro", "Historial", "Canales", "Radar", "Estadísticas", "Diagnóstico"};

    private float d;
    private WifiManager wifi;
    private SharedPreferences prefs;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean running = true, demo, receiverOn;
    private int scanCount;

    private List<Ap> aps = new ArrayList<>();
    private final Map<String, ArrayDeque<float[]>> history = new HashMap<>();
    private String selected = "";
    private String bandFilter = "all";
    private String specBand = "2.4";
    private int tab = 0;
    private WifiInfo info;

    // Vistas
    private TextView status, btnRun, banner;
    private LinearLayout cards, tabBar, listBox, specChips, filterChips;
    private FrameLayout content;
    private View[] pages;
    private Charts.Spectrum spectrum;
    private Charts.History historyView;
    private Charts.Congestion cong24, cong5;
    private Charts.Radar radar;
    private Charts.Donut dBand, dGen, dSec, dSig, dWidth, dVendor;
    private TextView diag;
    private TextView cTotal, cConn, cSig, cBest24, cBest5, cSec;
    private Dialog detailDialog;
    private Ap detailAp;
    private LinearLayout detailBox;
    private Charts.Gauge detailGauge;

    private final BroadcastReceiver scanReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) { readResults(); }
    };

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (running) doScan();
            handler.postDelayed(this, interval() * 1000L);
        }
    };

    // ---------------------------------------------------------------------
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        d = getResources().getDisplayMetrics().density;
        prefs = getSharedPreferences("airscope", MODE_PRIVATE);
        if (getIntent().hasExtra("demo")) prefs.edit().putBoolean("demo", getIntent().getBooleanExtra("demo", false)).apply();
        demo = prefs.getBoolean("demo", false);
        wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        Scanner.loadOui(this);
        buildUi();
        selectTab(Math.max(0, Math.min(TABS.length - 1, getIntent().getIntExtra("tab", 0))));
        requestPerms();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!receiverOn) {
            IntentFilter f = new IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(scanReceiver, f, Context.RECEIVER_EXPORTED);
            else registerReceiver(scanReceiver, f);
            receiverOn = true;
        }
        handler.removeCallbacks(tick);
        handler.post(tick);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(tick);
        if (receiverOn) { unregisterReceiver(scanReceiver); receiverOn = false; }
    }

    int interval() { return prefs.getInt("interval", 5); }

    float txPower() { return prefs.getInt("txp", 20); }

    float envN() { return ENV_N[prefs.getInt("env", 1)]; }

    int dp(float v) { return Math.round(v * d); }

    // ---------------------------------------------------------------------
    // Permisos
    // ---------------------------------------------------------------------
    boolean hasPerms() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    void requestPerms() {
        if (hasPerms()) return;
        List<String> p = new ArrayList<>();
        p.add(Manifest.permission.ACCESS_FINE_LOCATION);
        p.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        if (Build.VERSION.SDK_INT >= 33) p.add(Manifest.permission.NEARBY_WIFI_DEVICES);
        requestPermissions(p.toArray(new String[0]), REQ_PERM);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        doScan();
    }

    boolean locationOn() {
        LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (lm == null) return true;
        if (Build.VERSION.SDK_INT >= 28) return lm.isLocationEnabled();
        return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }

    // ---------------------------------------------------------------------
    // Escaneo
    // ---------------------------------------------------------------------
    @SuppressWarnings("deprecation")
    void doScan() {
        if (demo) {
            onAps(Scanner.demo(txPower(), envN()));
            return;
        }
        if (!hasPerms()) {
            showBanner("AirScope necesita el permiso de ubicación para ver las redes WiFi (requisito de Android). Toca para concederlo.",
                    v -> {
                        if (shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION) || !prefs.getBoolean("asked", false)) {
                            prefs.edit().putBoolean("asked", true).apply();
                            requestPerms();
                        } else {
                            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
                        }
                    });
            status.setText("Sin permiso");
            return;
        }
        if (!wifi.isWifiEnabled()) {
            showBanner("El WiFi está desactivado. Toca para activarlo.", v -> startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS)));
        } else if (!locationOn()) {
            showBanner("Activa la ubicación del sistema: Android la exige para escanear WiFi. Toca para abrir ajustes.",
                    v -> startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)));
        } else {
            banner.setVisibility(View.GONE);
        }
        boolean ok = false;
        try { ok = wifi.startScan(); } catch (SecurityException ignored) { }
        status.setText(ok ? "Escaneando…" : "Android limita los escaneos · usando caché");
        readResults();
    }

    @SuppressWarnings("deprecation")
    void readResults() {
        if (demo || !hasPerms()) return;
        try {
            List<ScanResult> res = wifi.getScanResults();
            info = wifi.getConnectionInfo();
            onAps(Scanner.convert(res, info, txPower(), envN()));
        } catch (SecurityException e) {
            status.setText("Permiso denegado");
        }
    }

    void onAps(List<Ap> fresh) {
        scanCount++;
        long now = System.currentTimeMillis();
        Set<String> seen = new HashSet<>();
        for (Ap a : fresh) { seen.add(a.bssid); a.updated = now; }
        for (Ap old : aps) {
            if (!seen.contains(old.bssid) && now - old.updated < 30000) { old.stale = true; fresh.add(old); }
        }
        Collections.sort(fresh, (x, y) -> Float.compare(y.dbm, x.dbm));
        if (demo && scanCount == 1) {
            Random r = new Random();
            for (Ap a : fresh) {
                float v = a.dbm;
                ArrayDeque<float[]> h = new ArrayDeque<>();
                for (int k = 100; k > 0; k--) {
                    v = Math.max(-95, Math.min(-25, v + (r.nextFloat() * 3 - 1.5f)));
                    h.add(new float[]{Charts.nowSec() - k * 3, v});
                }
                history.put(a.bssid, h);
            }
        }
        for (Ap a : fresh) {
            if (a.stale) continue;
            ArrayDeque<float[]> h = history.get(a.bssid);
            if (h == null) { h = new ArrayDeque<>(); history.put(a.bssid, h); }
            float ns = Charts.nowSec();
            float[] last = h.peekLast();
            if (last == null || ns - last[0] > 0.8f) h.add(new float[]{ns, a.dbm});
            while (h.size() > 400 || (!h.isEmpty() && ns - h.peekFirst()[0] > 900)) h.pollFirst();
        }
        aps = fresh;
        int live = 0;
        for (Ap a : aps) if (!a.stale) live++;
        status.setText(String.format(Locale.US, "%s#%d · %d redes", demo ? "DEMO · " : "", scanCount, live));
        refresh();
    }

    List<Ap> visible() {
        List<Ap> out = new ArrayList<>();
        for (Ap a : aps) if (bandFilter.equals("all") || a.band.equals(bandFilter)) out.add(a);
        return out;
    }

    // ---------------------------------------------------------------------
    // UI
    // ---------------------------------------------------------------------
    GradientDrawable round(int color, float radius, int stroke) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(radius * d);
        if (stroke != 0) g.setStroke(dp(1), stroke);
        return g;
    }

    TextView tv(String s, float size, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    TextView button(String s, View.OnClickListener l) {
        TextView b = tv(s, 13, Theme.TEXT, true);
        b.setPadding(dp(12), dp(7), dp(12), dp(7));
        b.setBackground(round(Theme.PANEL2, 8, Theme.GRID_STRONG));
        b.setOnClickListener(l);
        return b;
    }

    void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Theme.BG);
        root.setFitsSystemWindows(true);

        // Cabecera
        LinearLayout head = new LinearLayout(this);
        head.setGravity(Gravity.CENTER_VERTICAL);
        head.setBackgroundColor(Theme.PANEL);
        head.setPadding(dp(14), dp(10), dp(10), dp(10));
        TextView logo = new TextView(this);
        logo.setText(Html.fromHtml("<font color='#22D3EE'>◉ Air</font><font color='#E2E8F0'>Scope</font>", Html.FROM_HTML_MODE_COMPACT));
        logo.setTextSize(20);
        logo.setTypeface(Typeface.DEFAULT_BOLD);
        head.addView(logo);
        status = tv("", 11, Theme.TEXT_DIM, false);
        status.setPadding(dp(10), 0, dp(6), 0);
        status.setSingleLine(true);
        head.addView(status, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        btnRun = button("❙❙", v -> {
            running = !running;
            btnRun.setText(running ? "❙❙" : "▶");
            btnRun.setTextColor(running ? Theme.TEXT : WifiMath.WEAK);
        });
        head.addView(btnRun);
        TextView refreshBtn = button("⟳", v -> doScan());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = dp(6);
        head.addView(refreshBtn, lp);
        TextView menu = button("⚙", v -> showSettings());
        LinearLayout.LayoutParams lp2 = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp2.leftMargin = dp(6);
        head.addView(menu, lp2);
        root.addView(head);

        // Tarjetas
        HorizontalScrollView hs = new HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        cards = new LinearLayout(this);
        cards.setPadding(dp(8), dp(8), dp(8), dp(4));
        cTotal = card("Redes", Theme.ACCENT);
        cConn = card("Conectado a", WifiMath.GOOD);
        cSig = card("Señal enlace", WifiMath.GOOD);
        cBest24 = card("Mejor 2.4 GHz", Theme.ACCENT);
        cBest5 = card("Mejor 5 GHz", Theme.ACCENT);
        cSec = card("Inseguras", WifiMath.BAD);
        hs.addView(cards);
        root.addView(hs);

        // Pestañas
        HorizontalScrollView ts = new HorizontalScrollView(this);
        ts.setHorizontalScrollBarEnabled(false);
        tabBar = new LinearLayout(this);
        tabBar.setPadding(dp(4), 0, dp(4), 0);
        for (int i = 0; i < TABS.length; i++) {
            final int idx = i;
            TextView t = tv(TABS[i], 14, Theme.TEXT_DIM, true);
            t.setPadding(dp(14), dp(10), dp(14), dp(10));
            t.setOnClickListener(v -> selectTab(idx));
            tabBar.addView(t);
        }
        ts.addView(tabBar);
        root.addView(ts);
        View line = new View(this);
        line.setBackgroundColor(Theme.GRID);
        root.addView(line, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));

        banner = tv("", 13, 0xFF2A1004, true);
        banner.setBackgroundColor(WifiMath.FAIR);
        banner.setPadding(dp(14), dp(10), dp(14), dp(10));
        banner.setVisibility(View.GONE);
        root.addView(banner);

        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        pages = new View[TABS.length];
        // 0 Redes
        LinearLayout redes = new LinearLayout(this);
        redes.setOrientation(LinearLayout.VERTICAL);
        filterChips = chips(new String[]{"Todas", "2.4 GHz", "5 GHz", "6 GHz"}, new String[]{"all", "2.4", "5", "6"}, true);
        redes.addView(filterChips);
        ScrollView sv = new ScrollView(this);
        listBox = new LinearLayout(this);
        listBox.setOrientation(LinearLayout.VERTICAL);
        listBox.setPadding(dp(8), 0, dp(8), dp(12));
        sv.addView(listBox);
        redes.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        pages[0] = redes;
        // 1 Espectro
        LinearLayout spec = new LinearLayout(this);
        spec.setOrientation(LinearLayout.VERTICAL);
        specChips = chips(new String[]{"2.4 GHz", "5 GHz", "6 GHz"}, new String[]{"2.4", "5", "6"}, false);
        spec.addView(specChips);
        spectrum = new Charts.Spectrum(this);
        spectrum.setBand(specBand);
        spectrum.setOnApClick(this::showDetail);
        spec.addView(spectrum, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        pages[1] = spec;
        // 2 Historial
        historyView = new Charts.History(this);
        pages[2] = historyView;
        // 3 Canales
        ScrollView cs = new ScrollView(this);
        LinearLayout cl = new LinearLayout(this);
        cl.setOrientation(LinearLayout.VERTICAL);
        cong24 = new Charts.Congestion(this, "2.4");
        cong5 = new Charts.Congestion(this, "5");
        cl.addView(cong24, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(270)));
        View sep = new View(this);
        sep.setBackgroundColor(Theme.BG);
        cl.addView(sep, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(8)));
        cl.addView(cong5, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(270)));
        cs.addView(cl);
        pages[3] = cs;
        // 4 Radar
        radar = new Charts.Radar(this);
        radar.setOnApClick(this::showDetail);
        pages[4] = radar;
        // 5 Estadísticas
        ScrollView ss = new ScrollView(this);
        LinearLayout sl = new LinearLayout(this);
        sl.setOrientation(LinearLayout.VERTICAL);
        sl.setPadding(dp(8), dp(8), dp(8), dp(8));
        dBand = new Charts.Donut(this, "Redes por banda");
        dGen = new Charts.Donut(this, "Estándar Wi-Fi");
        dSec = new Charts.Donut(this, "Seguridad");
        dSig = new Charts.Donut(this, "Calidad de señal");
        dWidth = new Charts.Donut(this, "Ancho de canal");
        dVendor = new Charts.Donut(this, "Fabricantes (top 6)");
        for (View v : new View[]{dBand, dGen, dSec, dSig, dWidth, dVendor}) {
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            p.bottomMargin = dp(8);
            sl.addView(v, p);
        }
        ss.addView(sl);
        pages[5] = ss;
        // 6 Diagnóstico
        ScrollView ds = new ScrollView(this);
        diag = new TextView(this);
        diag.setTextColor(Theme.TEXT);
        diag.setTextSize(13.5f);
        diag.setLineSpacing(dp(2), 1f);
        diag.setPadding(dp(14), dp(12), dp(14), dp(20));
        ds.addView(diag);
        pages[6] = ds;

        for (View v : pages) {
            v.setVisibility(View.GONE);
            content.addView(v, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        selectTab(0);
        setContentView(root);
    }

    TextView card(String title, int color) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setBackground(round(Theme.PANEL, 10, Theme.GRID));
        c.setPadding(dp(12), dp(8), dp(12), dp(8));
        c.setMinimumWidth(dp(118));
        TextView t = tv(title.toUpperCase(Locale.ROOT), 9.5f, Theme.TEXT_DIM, false);
        t.setLetterSpacing(0.08f);
        TextView v = tv("—", 18, color, true);
        v.setSingleLine(true);
        TextView s = tv("", 10, Theme.TEXT_DIM, false);
        s.setSingleLine(true);
        v.setTag(s);
        c.addView(t);
        c.addView(v);
        c.addView(s);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.rightMargin = dp(8);
        cards.addView(c, p);
        return v;
    }

    void setCard(TextView v, String value, String sub, Integer color) {
        v.setText(value);
        ((TextView) v.getTag()).setText(sub);
        if (color != null) v.setTextColor(color);
    }

    LinearLayout chips(String[] labels, String[] values, boolean filter) {
        LinearLayout row = new LinearLayout(this);
        row.setPadding(dp(8), dp(8), dp(8), dp(6));
        for (int i = 0; i < labels.length; i++) {
            final String val = values[i];
            TextView c = tv(labels[i], 12.5f, Theme.TEXT, true);
            c.setTag(val);
            c.setPadding(dp(12), dp(6), dp(12), dp(6));
            c.setOnClickListener(v -> {
                if (filter) bandFilter = val; else { specBand = val; spectrum.setBand(val); }
                styleChips(row, val);
                refresh();
            });
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            p.rightMargin = dp(6);
            row.addView(c, p);
        }
        styleChips(row, filter ? bandFilter : specBand);
        return row;
    }

    void styleChips(LinearLayout row, String val) {
        for (int i = 0; i < row.getChildCount(); i++) {
            TextView c = (TextView) row.getChildAt(i);
            boolean on = val.equals(c.getTag());
            c.setBackground(round(on ? 0xFF0E3A4A : Theme.PANEL2, 16, on ? Theme.ACCENT : Theme.GRID_STRONG));
            c.setTextColor(on ? Theme.ACCENT : Theme.TEXT_DIM);
        }
    }

    void selectTab(int i) {
        tab = i;
        for (int k = 0; k < pages.length; k++) {
            pages[k].setVisibility(k == i ? View.VISIBLE : View.GONE);
            TextView t = (TextView) tabBar.getChildAt(k);
            t.setTextColor(k == i ? Theme.ACCENT : Theme.TEXT_DIM);
            GradientDrawable underline = new GradientDrawable();
            underline.setColor(0);
            t.setBackground(k == i ? underlineDrawable() : null);
        }
        refresh();
    }

    android.graphics.drawable.Drawable underlineDrawable() {
        GradientDrawable g = new GradientDrawable();
        g.setColor(Theme.ACCENT);
        android.graphics.drawable.LayerDrawable ld = new android.graphics.drawable.LayerDrawable(new android.graphics.drawable.Drawable[]{g});
        ld.setLayerInset(0, 0, dp(38), 0, 0);
        return ld;
    }

    void showBanner(String msg, View.OnClickListener l) {
        banner.setText(msg);
        banner.setOnClickListener(l);
        banner.setVisibility(View.VISIBLE);
    }

    // ---------------------------------------------------------------------
    // Refresco
    // ---------------------------------------------------------------------
    void refresh() {
        if (pages == null) return;
        List<Ap> vis = visible();
        updateCards();
        switch (tab) {
            case 0: buildList(vis); break;
            case 1: spectrum.setData(aps, selected); break;
            case 2: historyView.setHistory(history, liveOnly(aps), selected); break;
            case 3: cong24.setData(liveOnly(aps), selected); cong5.setData(liveOnly(aps), selected); break;
            case 4: radar.setData(liveOnly(aps), selected); break;
            case 5: updateStats(); break;
            case 6: updateDiag(); break;
            default: break;
        }
        if (detailDialog != null && detailDialog.isShowing() && detailAp != null) {
            for (Ap a : aps) if (a.bssid.equals(detailAp.bssid)) { fillDetail(a); break; }
        }
    }

    List<Ap> liveOnly(List<Ap> in) {
        List<Ap> o = new ArrayList<>();
        for (Ap a : in) if (!a.stale) o.add(a);
        return o;
    }

    void updateCards() {
        List<Ap> live = liveOnly(aps);
        int n24 = 0, n5 = 0, n6 = 0, hidden = 0, insecure = 0, legacy = 0;
        Set<String> ssids = new HashSet<>();
        Ap mine = null;
        for (Ap a : live) {
            if (a.band.equals("2.4")) n24++; else if (a.band.equals("5")) n5++; else n6++;
            if (a.ssid.isEmpty()) hidden++; else ssids.add(a.ssid);
            String r = (String) WifiMath.securityRank(a.security)[0];
            if (r.equals("Abierta") || r.equals("Insegura")) insecure++;
            if (a.security.contains("WPA1") || a.ciphers.contains("TKIP")) legacy++;
            if (a.inUse) mine = a;
        }
        setCard(cTotal, String.valueOf(live.size()), n24 + " / " + n5 + " / " + n6 + " (2.4/5/6)", null);
        if (mine != null) {
            setCard(cConn, trunc(mine.displaySsid(), 16), "Canal " + mine.channel + " · " + WifiMath.bandLabel(mine.band), WifiMath.GOOD);
            String sub = info != null ? info.getLinkSpeed() + " Mbps" : "";
            if (demo) sub = "286 Mbps";
            setCard(cSig, String.format(Locale.US, "%.0f dBm", mine.dbm), sub, WifiMath.signalColor(mine.dbm));
        } else {
            setCard(cConn, "Sin conexión", "", Theme.TEXT_DIM);
            setCard(cSig, "—", "", Theme.TEXT_DIM);
        }
        int[][] b24 = WifiMath.bestChannels(live, "2.4"), b5 = WifiMath.bestChannels(live, "5");
        setCard(cBest24, b24[0] != null ? "Canal " + b24[0][0] : "—", b24[0] != null ? b24[0][1] + " redes solapadas" : "", null);
        String s5 = b5[0] != null ? b5[0][1] + " solapadas" : "";
        if (b5[1] != null && b5[0] != null && b5[1][0] != b5[0][0]) s5 += " · DFS " + b5[1][0];
        setCard(cBest5, b5[0] != null ? "Canal " + b5[0][0] : "—", s5, null);
        setCard(cSec, String.valueOf(insecure), "abiertas/WEP · " + legacy + " WPA1/TKIP",
                insecure > 0 ? WifiMath.BAD : legacy > 0 ? WifiMath.FAIR : WifiMath.GOOD);
    }

    static String trunc(String s, int n) { return s.length() > n ? s.substring(0, n - 1) + "…" : s; }

    void buildList(List<Ap> vis) {
        listBox.removeAllViews();
        if (vis.isEmpty()) {
            TextView e = tv(demo ? "" : "Buscando redes WiFi…\n\nSi no aparece nada, comprueba que el WiFi y la ubicación están activados.",
                    13, Theme.TEXT_DIM, false);
            e.setGravity(Gravity.CENTER);
            e.setPadding(dp(20), dp(60), dp(20), dp(20));
            listBox.addView(e);
            return;
        }
        for (Ap a : vis) listBox.addView(row(a));
    }

    View row(Ap a) {
        LinearLayout r = new LinearLayout(this);
        r.setGravity(Gravity.CENTER_VERTICAL);
        boolean sel = a.bssid.equals(selected);
        r.setBackground(round(sel ? 0xFF1E3A5F : Theme.PANEL, 10, a.inUse ? Theme.ACCENT : Theme.GRID));
        r.setPadding(0, dp(10), dp(12), dp(10));
        r.setAlpha(a.stale ? 0.45f : 1f);
        View stripe = new View(this);
        stripe.setBackground(round(a.color(), 2, 0));
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(dp(4), dp(48));
        sp.leftMargin = dp(6);
        sp.rightMargin = dp(10);
        r.addView(stripe, sp);

        LinearLayout mid = new LinearLayout(this);
        mid.setOrientation(LinearLayout.VERTICAL);
        TextView name = tv((a.inUse ? "★ " : "") + a.displaySsid(), 15, a.color(), true);
        name.setSingleLine(true);
        mid.addView(name);
        TextView sub = tv(a.bssid.toUpperCase(Locale.ROOT) + (a.vendor.isEmpty() ? "" : " · " + a.vendor), 11, Theme.TEXT_DIM, false);
        sub.setSingleLine(true);
        mid.addView(sub);
        SpannableStringBuilder sb = new SpannableStringBuilder();
        chip(sb, "Ch " + a.channel, Theme.TEXT);
        chip(sb, WifiMath.bandLabel(a.band), Theme.TEXT_DIM);
        chip(sb, a.width + " MHz", Theme.TEXT_DIM);
        chip(sb, a.generation + (a.genExact ? "" : "*"), WifiMath.GEN_COL[WifiMath.genIndex(a.generation)]);
        Object[] sr = WifiMath.securityRank(a.security);
        chip(sb, a.security, (int) sr[1]);
        if (a.dfs) chip(sb, "DFS", Theme.DFS);
        if (a.p2pGo) chip(sb, "P2P GO", Theme.ACCENT2);
        TextView chips = new TextView(this);
        chips.setText(sb);
        chips.setTextSize(11.5f);
        chips.setSingleLine(true);
        mid.addView(chips);
        r.addView(mid, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        LinearLayout right = new LinearLayout(this);
        right.setOrientation(LinearLayout.VERTICAL);
        right.setGravity(Gravity.END);
        int col = WifiMath.signalColor(a.dbm);
        right.addView(tv(String.format(Locale.US, "%.0f dBm", a.dbm), 16, col, true));
        Charts.SignalBar bar = new Charts.SignalBar(this);
        bar.setDbm(a.dbm);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(dp(70), dp(6));
        bp.topMargin = dp(3);
        bp.bottomMargin = dp(4);
        right.addView(bar, bp);
        right.addView(tv(String.format(Locale.US, "≈ %s", fmtDist(a.distance)), 11.5f, WifiMath.distanceColor(a.distance), true));
        r.addView(right);

        r.setOnClickListener(v -> showDetail(a));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.bottomMargin = dp(6);
        r.setLayoutParams(p);
        return r;
    }

    static String fmtDist(double m) {
        if (m >= 1000) return ">1 km";
        return m < 10 ? String.format(Locale.US, "%.1f m", m) : String.format(Locale.US, "%.0f m", m);
    }

    void chip(SpannableStringBuilder sb, String s, int color) {
        if (sb.length() > 0) sb.append("  ");
        int st = sb.length();
        sb.append(s);
        sb.setSpan(new ForegroundColorSpan(color), st, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    // ---------------------------------------------------------------------
    // Detalle
    // ---------------------------------------------------------------------
    void showDetail(Ap a) {
        selected = a.bssid;
        detailAp = a;
        if (detailDialog == null) {
            detailDialog = new Dialog(this, android.R.style.Theme_Material_NoActionBar);
            detailDialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
            LinearLayout root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(Theme.BG);
            root.setFitsSystemWindows(true);
            LinearLayout head = new LinearLayout(this);
            head.setGravity(Gravity.CENTER_VERTICAL);
            head.setBackgroundColor(Theme.PANEL);
            head.setPadding(dp(8), dp(8), dp(8), dp(8));
            head.addView(button("←", v -> detailDialog.dismiss()));
            TextView t = tv("Detalles del punto de acceso", 16, Theme.TEXT, true);
            t.setPadding(dp(12), 0, 0, 0);
            head.addView(t);
            root.addView(head);
            ScrollView sv = new ScrollView(this);
            LinearLayout box = new LinearLayout(this);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setPadding(dp(10), dp(10), dp(10), dp(20));
            detailGauge = new Charts.Gauge(this);
            box.addView(detailGauge);
            detailBox = new LinearLayout(this);
            detailBox.setOrientation(LinearLayout.VERTICAL);
            detailBox.setBackground(round(Theme.PANEL, 10, Theme.GRID));
            detailBox.setPadding(dp(14), dp(10), dp(14), dp(10));
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            p.topMargin = dp(10);
            box.addView(detailBox, p);
            sv.addView(box);
            root.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
            detailDialog.setContentView(root);
            detailDialog.setOnDismissListener(x -> refresh());
        }
        fillDetail(a);
        detailDialog.show();
        refresh();
    }

    void field(String label, String value, Integer color) {
        LinearLayout r = new LinearLayout(this);
        r.setPadding(0, dp(5), 0, dp(5));
        TextView l = tv(label, 13, Theme.TEXT_DIM, false);
        r.addView(l, new LinearLayout.LayoutParams(dp(130), ViewGroup.LayoutParams.WRAP_CONTENT));
        TextView v = tv(value, 13, color == null ? Theme.TEXT : color, false);
        v.setTextIsSelectable(true);
        r.addView(v, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        detailBox.addView(r);
    }

    void fillDetail(Ap a) {
        detailAp = a;
        detailGauge.setValue(a.dbm, a.displaySsid() + " · calidad " + a.quality + "%");
        detailBox.removeAllViews();
        int sc = WifiMath.signalColor(a.dbm);
        field("SSID", a.displaySsid() + (a.inUse ? "  (conectado)" : ""), a.color());
        field("BSSID", a.bssid.toUpperCase(Locale.ROOT), null);
        field("Fabricante", a.vendor.isEmpty() ? "-" : a.vendor, null);
        field("Señal", String.format(Locale.US, "%.0f dBm (%s)", a.dbm, WifiMath.signalLabel(a.dbm)), sc);
        field("Calidad", a.quality + " %", sc);
        field("SNR", String.format(Locale.US, "%.0f dB", a.snr), sc);
        field("Potencia rx", String.format(Locale.US, "%.2e mW", Math.pow(10, a.dbm / 10.0)), null);
        field("Distancia", "≈ " + fmtDist(a.distance), WifiMath.distanceColor(a.distance));
        field("Banda", WifiMath.bandLabel(a.band), null);
        field("Canal primario", String.valueOf(a.channel), null);
        field("Ancho de canal", a.width + " MHz", null);
        field("Frecuencia", String.format(Locale.US, "%d MHz (centro %.0f MHz)", a.freq, a.center), null);
        field("Rango ocupado", String.format(Locale.US, "%.0f – %.0f MHz", a.lowFreq(), a.highFreq()), null);
        field("Canal secundario", a.secOffset == 1 ? "Superior (+1)" : a.secOffset == -1 ? "Inferior (−1)" : "-", null);
        field("Bloque U-NII", a.unii, null);
        field("DFS", a.dfs ? "Sí — vigila radares, puede cambiar de canal" + (WifiMath.isWeatherRadar(a.channel, a.band) ? " · radar meteorológico (CAC 10 min)" : "") : "No",
                a.dfs ? Theme.DFS : null);
        int gi = WifiMath.genIndex(a.generation);
        field("Estándar", a.generation + " · " + WifiMath.GEN_STD[gi] + (a.genExact ? "" : " (estimado)"), WifiMath.GEN_COL[gi]);
        field("Streams (NSS)", a.nss + "×" + a.nss + " MIMO", null);
        field("Tasa PHY máx.", String.format(Locale.US, "%.0f Mbps", a.maxRate), null);
        Object[] sr = WifiMath.securityRank(a.security);
        field("Seguridad", a.security + "  [" + sr[0] + "]", (int) sr[1]);
        field("Autenticación", a.auth.isEmpty() ? "-" : a.auth, null);
        field("Cifrado", a.ciphers.isEmpty() ? "-" : a.ciphers, null);
        field("PMF (802.11w)", a.pmf, null);
        field("WPS", a.wps ? "Activo" : "No", a.wps ? WifiMath.WEAK : null);
        field("Wi-Fi Direct", a.p2pGo ? "Group Owner (GO)" : a.p2p ? "Sí" : "No", null);
        field("Roaming", a.roaming(), null);
        field("Clientes", a.stations >= 0 ? String.valueOf(a.stations) : "-", null);
        field("Uso del canal", a.utilization >= 0 ? a.utilization + " %" : "-", null);
        field("Pot. TX anunciada", a.txPower != null ? a.txPower + " dBm" : "-", null);
        field("País", a.country.isEmpty() ? "-" : a.country, null);
        field("Visto hace", a.stale ? "fuera de alcance" : (a.seenMs / 1000) + " s", null);
    }

    // ---------------------------------------------------------------------
    // Estadísticas y diagnóstico
    // ---------------------------------------------------------------------
    void updateStats() {
        List<Ap> live = liveOnly(aps);
        int[] bands = new int[3];
        int[] gens = new int[WifiMath.GENS.length];
        int[] lv = new int[5];
        Map<String, int[]> sec = new LinkedHashMap<>();
        Map<Integer, Integer> widths = new LinkedHashMap<>();
        Map<String, Integer> vend = new HashMap<>();
        for (Ap a : live) {
            bands[a.band.equals("2.4") ? 0 : a.band.equals("5") ? 1 : 2]++;
            gens[WifiMath.genIndex(a.generation)]++;
            lv[WifiMath.levelIndex(a.dbm)]++;
            Object[] sr = WifiMath.securityRank(a.security);
            int[] e = sec.get((String) sr[0]);
            if (e == null) sec.put((String) sr[0], new int[]{1, (int) sr[1]}); else e[0]++;
            widths.put(a.width, widths.getOrDefault(a.width, 0) + 1);
            String v = a.vendor.isEmpty() ? "Desconocido" : a.vendor;
            vend.put(v, vend.getOrDefault(v, 0) + 1);
        }
        List<Object[]> l = new ArrayList<>();
        l.add(new Object[]{"2.4 GHz", bands[0], 0xFF38BDF8});
        l.add(new Object[]{"5 GHz", bands[1], 0xFFA78BFA});
        l.add(new Object[]{"6 GHz", bands[2], 0xFFF472B6});
        dBand.setData(l);
        l = new ArrayList<>();
        for (int i = 0; i < gens.length; i++) l.add(new Object[]{WifiMath.GENS[i], gens[i], WifiMath.GEN_COL[i]});
        dGen.setData(l);
        l = new ArrayList<>();
        for (Map.Entry<String, int[]> e : sec.entrySet()) l.add(new Object[]{e.getKey(), e.getValue()[0], e.getValue()[1]});
        dSec.setData(l);
        l = new ArrayList<>();
        for (int i = 0; i < 5; i++) l.add(new Object[]{WifiMath.LEVEL_LAB[i], lv[i], WifiMath.LEVEL_COL[i]});
        dSig.setData(l);
        l = new ArrayList<>();
        int[] wc = {0xFF94A3B8, 0xFF38BDF8, 0xFF34D399, 0xFFA78BFA, 0xFFF472B6};
        int[] ws = {20, 40, 80, 160, 320};
        for (int i = 0; i < ws.length; i++) l.add(new Object[]{ws[i] + " MHz", widths.getOrDefault(ws[i], 0), wc[i]});
        dWidth.setData(l);
        List<Map.Entry<String, Integer>> ve = new ArrayList<>(vend.entrySet());
        Collections.sort(ve, (x, y) -> y.getValue() - x.getValue());
        l = new ArrayList<>();
        for (int i = 0; i < Math.min(6, ve.size()); i++) l.add(new Object[]{ve.get(i).getKey(), ve.get(i).getValue(), Theme.AP_PALETTE[i]});
        dVendor.setData(l);
    }

    private final StringBuilder dsb = new StringBuilder();

    void add(int color, String title, String text) {
        dsb.append("<p><font color='").append(Theme.hex(color)).append("'><b>▌ ").append(Html.escapeHtml(title))
                .append("</b></font><br>").append(text).append("</p>");
    }

    static String esc(String s) { return Html.escapeHtml(s); }

    String names(List<Ap> l, int max, boolean ch) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Math.min(max, l.size()); i++) {
            if (i > 0) sb.append(", ");
            sb.append(esc(l.get(i).displaySsid()));
            if (ch) sb.append(" (c").append(l.get(i).channel).append(")");
        }
        return sb.toString();
    }

    void updateDiag() {
        List<Ap> live = liveOnly(aps);
        dsb.setLength(0);
        Ap mine = null;
        for (Ap a : live) if (a.inUse) mine = a;
        if (mine != null) {
            add(WifiMath.signalColor(mine.dbm), "Tu red: " + mine.displaySsid() + String.format(Locale.US, " (%.0f dBm · %s)", mine.dbm, WifiMath.signalLabel(mine.dbm)),
                    String.format(Locale.US, "Canal %d (%s, %d MHz) · %s · distancia ≈ %s · SNR %.0f dB.",
                            mine.channel, WifiMath.bandLabel(mine.band), mine.width, mine.generation, fmtDist(mine.distance), mine.snr));
            List<Ap> same = new ArrayList<>();
            int strong = 0;
            for (Ap a : live) {
                if (a == mine || !a.band.equals(mine.band) || a.ssid.equals(mine.ssid)) continue;
                if (Math.min(a.highFreq(), mine.highFreq()) - Math.max(a.lowFreq(), mine.lowFreq()) > 0) {
                    same.add(a);
                    if (a.dbm > -75) strong++;
                }
            }
            if (!same.isEmpty())
                add(strong >= 3 ? WifiMath.BAD : WifiMath.FAIR, same.size() + " redes ajenas solapan tu canal",
                        strong + " con señal relevante (&gt; -75 dBm): " + names(same, 6, false));
            else add(WifiMath.GOOD, "Canal limpio", "Ninguna red ajena solapa el canal de tu red.");
            int[][] best = WifiMath.bestChannels(live, mine.band);
            if (best[0] != null && best[0][0] != mine.channel && !mine.band.equals("6"))
                add(Theme.ACCENT, "Recomendación de canal", "Considera cambiar tu router al canal <b>" + best[0][0] + "</b> en " + WifiMath.bandLabel(mine.band) + ".");
            if (mine.band.equals("2.4")) {
                for (Ap a : live) {
                    if (a.band.equals("5") && (a.ssid.equals(mine.ssid) || a.bssid.regionMatches(0, mine.bssid, 0, 14))) {
                        add(Theme.ACCENT, "Banda de 5 GHz disponible", "Tu router emite también en 5 GHz (<b>" + esc(a.displaySsid())
                                + "</b>, " + Math.round(a.dbm) + " dBm): más velocidad y menos interferencias a corta distancia.");
                        break;
                    }
                }
            }
        } else {
            add(WifiMath.FAIR, "No conectado", "No hay una red WiFi asociada.");
        }
        List<Ap> bad24 = new ArrayList<>(), wide24 = new ArrayList<>(), open = new ArrayList<>(), tkip = new ArrayList<>(),
                wps = new ArrayList<>(), dfs = new ArrayList<>(), p2p = new ArrayList<>(), busy = new ArrayList<>();
        for (Ap a : live) {
            if (a.band.equals("2.4") && a.channel != 1 && a.channel != 6 && a.channel != 11 && a.channel != 13) bad24.add(a);
            if (a.band.equals("2.4") && a.width >= 40) wide24.add(a);
            String r = (String) WifiMath.securityRank(a.security)[0];
            if (r.equals("Abierta") || r.equals("Insegura")) open.add(a);
            if (a.security.contains("WPA1") || a.ciphers.contains("TKIP")) tkip.add(a);
            if (a.wps) wps.add(a);
            if (a.dfs) dfs.add(a);
            if (a.p2p) p2p.add(a);
            if (a.utilization >= 50) busy.add(a);
        }
        if (!bad24.isEmpty()) add(WifiMath.FAIR, bad24.size() + " redes de 2.4 GHz en canales solapados",
                "Los canales distintos de 1/6/11 interfieren con dos grupos a la vez: " + names(bad24, 8, true));
        if (!wide24.isEmpty()) add(WifiMath.FAIR, wide24.size() + " redes usan 40 MHz en 2.4 GHz", "Ocupan ~2/3 de la banda: " + names(wide24, 8, false));
        if (!open.isEmpty()) add(WifiMath.BAD, open.size() + " redes abiertas o con WEP", names(open, 10, false) + " — el tráfico puede ser interceptado.");
        if (!tkip.isEmpty()) add(WifiMath.FAIR, tkip.size() + " redes admiten WPA1/TKIP (obsoleto)", names(tkip, 10, false));
        if (!wps.isEmpty()) add(WifiMath.FAIR, wps.size() + " redes con WPS activo", "WPS por PIN es vulnerable a fuerza bruta: " + names(wps, 10, false));
        if (!dfs.isEmpty()) add(Theme.DFS, dfs.size() + " redes en canales DFS",
                "Comparten espectro con radares: si detectan uno deben abandonar el canal. " + names(dfs, 8, true));
        if (!p2p.isEmpty()) add(Theme.ACCENT2, p2p.size() + " dispositivos Wi-Fi Direct (P2P GO)", names(p2p, 8, false) + " — impresoras, TVs o móviles.");
        if (!busy.isEmpty()) add(WifiMath.FAIR, "Canales muy ocupados (BSS Load)", names(busy, 8, true));
        StringBuilder g = new StringBuilder();
        for (String gen : WifiMath.GENS) {
            int n = 0;
            for (Ap a : live) if (a.generation.equals(gen)) n++;
            if (n > 0) g.append(g.length() > 0 ? " · " : "").append(gen).append(": ").append(n);
        }
        add(Theme.ACCENT, "Resumen de estándares", g.length() > 0 ? g.toString() : "—");
        diag.setText(Html.fromHtml(dsb.toString(), Html.FROM_HTML_MODE_COMPACT));
    }

    // ---------------------------------------------------------------------
    // Ajustes
    // ---------------------------------------------------------------------
    void showSettings() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(12), dp(20), dp(4));

        TextView txl = tv("Potencia TX supuesta del AP: " + prefs.getInt("txp", 20) + " dBm", 14, Theme.TEXT, false);
        box.addView(txl);
        SeekBar sb = new SeekBar(this);
        sb.setMax(30);
        sb.setProgress(prefs.getInt("txp", 20));
        sb.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int v, boolean u) { txl.setText("Potencia TX supuesta del AP: " + v + " dBm"); }
            public void onStartTrackingTouch(SeekBar s) { }
            public void onStopTrackingTouch(SeekBar s) { }
        });
        box.addView(sb);

        box.addView(tv("\nEntorno (modelo de distancia)", 14, Theme.TEXT, false));
        RadioGroup env = new RadioGroup(this);
        for (int i = 0; i < ENV_LAB.length; i++) {
            RadioButton rb = new RadioButton(this);
            rb.setText(ENV_LAB[i]);
            rb.setTextColor(Theme.TEXT);
            rb.setId(100 + i);
            env.addView(rb);
        }
        env.check(100 + prefs.getInt("env", 1));
        box.addView(env);

        box.addView(tv("\nIntervalo de escaneo", 14, Theme.TEXT, false));
        RadioGroup iv = new RadioGroup(this);
        iv.setOrientation(RadioGroup.HORIZONTAL);
        int[] ivs = {3, 5, 10, 30};
        for (int v : ivs) {
            RadioButton rb = new RadioButton(this);
            rb.setText(v + " s");
            rb.setTextColor(Theme.TEXT);
            rb.setId(200 + v);
            iv.addView(rb);
        }
        iv.check(200 + interval());
        box.addView(iv);
        TextView note = tv("Android limita los escaneos a 4 cada 2 minutos. Para escanear más rápido desactiva "
                + "«Limitación de búsqueda de Wi-Fi» en Opciones de desarrollador.", 11.5f, Theme.TEXT_DIM, false);
        box.addView(note);

        Switch sw = new Switch(this);
        sw.setText("Modo demostración (datos simulados)");
        sw.setTextColor(Theme.TEXT);
        sw.setChecked(demo);
        sw.setPadding(0, dp(16), 0, dp(8));
        box.addView(sw);

        box.addView(tv("\nAirScope 1.0.0 · github.com/melvinfranco99/airscope", 11.5f, Theme.TEXT_DIM, false));

        ScrollView sv = new ScrollView(this);
        sv.addView(box);
        new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("Ajustes")
                .setView(sv)
                .setPositiveButton("Guardar", (dlg, w) -> {
                    boolean newDemo = sw.isChecked();
                    prefs.edit().putInt("txp", sb.getProgress())
                            .putInt("env", env.getCheckedRadioButtonId() - 100)
                            .putInt("interval", iv.getCheckedRadioButtonId() - 200)
                            .putBoolean("demo", newDemo).apply();
                    if (newDemo != demo) {
                        demo = newDemo;
                        aps = new ArrayList<>();
                        history.clear();
                        scanCount = 0;
                        selected = "";
                        banner.setVisibility(View.GONE);
                    }
                    doScan();
                })
                .setNegativeButton("Cancelar", null)
                .show();
    }
}
