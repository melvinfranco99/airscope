"""Ventana del simulador de controlador WLAN (la web de docs/controller embebida)."""

from __future__ import annotations

import os

from PyQt6.QtCore import QStandardPaths, QUrl
from PyQt6.QtGui import QDesktopServices, QIcon
from PyQt6.QtWidgets import QFileDialog, QMainWindow, QWidget

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_URL = "https://melvinfranco99.github.io/airscope/controller/"

try:
    from PyQt6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineSettings
    from PyQt6.QtWebEngineWidgets import QWebEngineView
    HAVE_WEBENGINE = True
except ImportError:                       # python-pyqt6-webengine no instalado
    HAVE_WEBENGINE = False


def controller_dir() -> str | None:
    """Carpeta con index.html del simulador: instalada junto al paquete o en el repo."""
    for d in (os.path.join(HERE, "controller"), os.path.join(HERE, os.pardir, "docs", "controller")):
        if os.path.isfile(os.path.join(d, "index.html")):
            return os.path.abspath(d)
    return None


def controller_url() -> QUrl:
    d = controller_dir()
    return QUrl.fromLocalFile(os.path.join(d, "index.html")) if d else QUrl(WEB_URL)


if HAVE_WEBENGINE:
    class ControllerWindow(QMainWindow):
        def __init__(self, parent: QWidget | None = None):
            super().__init__(parent)
            self.setWindowTitle("AirScope Controller — Simulador WLAN")
            icon = os.path.join(HERE, "airscope.svg")
            if os.path.exists(icon):
                self.setWindowIcon(QIcon(icon))
            self.resize(1500, 950)

            # Perfil persistente: el proyecto (localStorage) sobrevive entre sesiones.
            self.profile = QWebEngineProfile("airscope-controller", self)
            data = os.path.join(QStandardPaths.writableLocation(
                QStandardPaths.StandardLocation.AppDataLocation), "controller")
            self.profile.setPersistentStoragePath(data)
            self.profile.downloadRequested.connect(self._download)

            page = QWebEnginePage(self.profile, self)
            s = page.settings()
            s.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
            s.setAttribute(QWebEngineSettings.WebAttribute.LocalStorageEnabled, True)
            self.view = QWebEngineView(self)
            self.view.setPage(page)
            self.setCentralWidget(self.view)
            url = controller_url()
            url.setFragment("map")
            self.view.load(url)

        def _download(self, item):
            # exportar proyecto (.json) o mapa de calor (.png)
            start = os.path.join(QStandardPaths.writableLocation(
                QStandardPaths.StandardLocation.DownloadLocation), item.downloadFileName())
            path, _ = QFileDialog.getSaveFileName(self, "Guardar archivo", start)
            if not path:
                item.cancel()
                return
            item.setDownloadDirectory(os.path.dirname(path))
            item.setDownloadFileName(os.path.basename(path))
            item.accept()


def open_controller(parent: QWidget | None = None):
    """Abre el simulador embebido o, si no hay QtWebEngine, en el navegador."""
    if HAVE_WEBENGINE:
        w = ControllerWindow(parent)
        w.show()
        return w
    url = controller_url()
    QDesktopServices.openUrl(url)
    return None
