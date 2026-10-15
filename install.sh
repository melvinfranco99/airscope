#!/usr/bin/env bash
# Instalador de AirScope - Analizador WiFi para Linux
# Uso:  ./install.sh            (instala para el usuario actual, sin root)
#       sudo ./install.sh --system   (instala para todo el sistema en /opt)
set -euo pipefail

APP=airscope
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--system" ]]; then
    PREFIX=/opt/$APP
    BIN=/usr/local/bin
    APPS=/usr/share/applications
    ICONS=/usr/share/icons/hicolor/scalable/apps
else
    PREFIX="$HOME/.local/share/$APP"
    BIN="$HOME/.local/bin"
    APPS="$HOME/.local/share/applications"
    ICONS="$HOME/.local/share/icons/hicolor/scalable/apps"
fi

c() { printf "\e[1;36m==>\e[0m %s\n" "$*"; }
w() { printf "\e[1;33m[!]\e[0m %s\n" "$*"; }

c "Comprobando dependencias…"
missing=()
command -v python3 >/dev/null || missing+=("python3")
command -v nmcli   >/dev/null || missing+=("networkmanager")
command -v iw      >/dev/null || missing+=("iw")
python3 -c "import PyQt6.QtWidgets" 2>/dev/null || missing+=("pyqt6")
python3 -c "import PyQt6.QtWebEngineWidgets" 2>/dev/null || missing+=("pyqt6-webengine")

if ((${#missing[@]})); then
    w "Faltan dependencias: ${missing[*]}"
    SUDO=""; [[ $EUID -ne 0 ]] && SUDO="sudo"
    if command -v pacman >/dev/null; then
        pkgs=(); for m in "${missing[@]}"; do case $m in
            python3) pkgs+=(python);; pyqt6) pkgs+=(python-pyqt6);; pyqt6-webengine) pkgs+=(python-pyqt6-webengine);; *) pkgs+=("$m");; esac; done
        $SUDO pacman -S --needed --noconfirm "${pkgs[@]}"
    elif command -v apt-get >/dev/null; then
        pkgs=(); for m in "${missing[@]}"; do case $m in
            networkmanager) pkgs+=(network-manager);; pyqt6) pkgs+=(python3-pyqt6);; pyqt6-webengine) pkgs+=(python3-pyqt6.qtwebengine);; *) pkgs+=("$m");; esac; done
        $SUDO apt-get update && $SUDO apt-get install -y "${pkgs[@]}"
    elif command -v dnf >/dev/null; then
        pkgs=(); for m in "${missing[@]}"; do case $m in
            networkmanager) pkgs+=(NetworkManager);; pyqt6) pkgs+=(python3-pyqt6);; pyqt6-webengine) pkgs+=(python3-pyqt6-webengine);; *) pkgs+=("$m");; esac; done
        $SUDO dnf install -y "${pkgs[@]}"
    elif command -v zypper >/dev/null; then
        pkgs=(); for m in "${missing[@]}"; do case $m in
            networkmanager) pkgs+=(NetworkManager);; pyqt6) pkgs+=(python3-PyQt6);; pyqt6-webengine) pkgs+=(python3-PyQt6-WebEngine);; *) pkgs+=("$m");; esac; done
        $SUDO zypper install -y "${pkgs[@]}"
    else
        w "Instala manualmente: ${missing[*]}  (o: pip install --user PyQt6)"; exit 1
    fi
fi

c "Instalando en $PREFIX"
rm -rf "$PREFIX"
mkdir -p "$PREFIX" "$BIN" "$APPS" "$ICONS"
cp -r "$SRC/airscope" "$PREFIX/"
cp -r "$SRC/docs/controller" "$PREFIX/airscope/controller"   # simulador de controlador WLAN
find "$PREFIX" -name '__pycache__' -prune -exec rm -rf {} +

cat > "$BIN/$APP" <<LAUNCH
#!/usr/bin/env bash
export PYTHONPATH="$PREFIX\${PYTHONPATH:+:\$PYTHONPATH}"
exec python3 -m airscope "\$@"
LAUNCH
chmod +x "$BIN/$APP"

cp "$SRC/airscope/airscope.svg" "$ICONS/$APP.svg"
cat > "$APPS/$APP.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=AirScope
GenericName=Analizador WiFi
Comment=Analizador WiFi profesional: dBm, canales, DFS, Wi-Fi 4/5/6, espectro y radar
Exec=$BIN/$APP
Icon=$APP
Terminal=false
Categories=Network;Monitor;Qt;
Keywords=wifi;wlan;inssider;analyzer;spectrum;channel;dbm;
StartupWMClass=airscope
Actions=controller;

[Desktop Action controller]
Name=Controlador WLAN (simulador)
Exec=$BIN/$APP --controller
DESK
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q "$(dirname "$(dirname "$ICONS")")" 2>/dev/null || true

c "¡AirScope instalado!"
echo "    Ejecuta:  $APP"
case ":$PATH:" in *":$BIN:"*) ;; *) w "$BIN no está en tu PATH. Añádelo o ejecuta $BIN/$APP";; esac
