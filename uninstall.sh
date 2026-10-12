#!/usr/bin/env bash
# Desinstalador de AirScope
set -euo pipefail
if [[ "${1:-}" == "--system" ]]; then
    rm -rf /opt/airscope /usr/local/bin/airscope /usr/share/applications/airscope.desktop \
           /usr/share/icons/hicolor/scalable/apps/airscope.svg
else
    rm -rf "$HOME/.local/share/airscope" "$HOME/.local/bin/airscope" \
           "$HOME/.local/share/applications/airscope.desktop" \
           "$HOME/.local/share/icons/hicolor/scalable/apps/airscope.svg"
fi
echo "AirScope desinstalado."
