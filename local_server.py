from __future__ import annotations

import json
import mimetypes
import os
import re
import winreg
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
PORT = 8765
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def desktop_path() -> Path:
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
        ) as key:
            value, _value_type = winreg.QueryValueEx(key, "Desktop")
            desktop = Path(os.path.expandvars(value))
            desktop.mkdir(parents=True, exist_ok=True)
            return desktop
    except OSError:
        pass

    user_profile = Path(os.environ.get("USERPROFILE", Path.home()))
    desktop = user_profile / "Desktop"
    desktop.mkdir(parents=True, exist_ok=True)
    return desktop


def safe_filename(value: str) -> str:
    name = Path(value).name.strip()
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
    return name[:180] or "导出文件"


def unique_path(directory: Path, filename: str) -> Path:
    candidate = directory / filename
    if not candidate.exists():
        return candidate

    stem = candidate.stem
    suffix = candidate.suffix
    index = 1
    while True:
        candidate = directory / f"{stem} ({index}){suffix}"
        if not candidate.exists():
            return candidate
        index += 1


class LocalHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/save":
            self.send_error(404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0

        if content_length <= 0 or content_length > MAX_UPLOAD_BYTES:
            self.send_json(400, {"error": "导出文件大小无效"})
            return

        filename = parse_qs(parsed.query).get("filename", ["导出文件"])[0]
        destination = unique_path(desktop_path(), safe_filename(filename))

        try:
            destination.write_bytes(self.rfile.read(content_length))
            zone_stream = Path(f"{destination}:Zone.Identifier")
            if zone_stream.exists():
                zone_stream.unlink()
        except OSError as error:
            self.send_json(500, {"error": str(error)})
            return

        self.send_json(200, {
            "ok": True,
            "filename": destination.name,
            "path": str(destination),
        })

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *args) -> None:
        return


if __name__ == "__main__":
    mimetypes.add_type("text/javascript", ".js")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), LocalHandler)
    server.serve_forever()
