from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import winreg
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("JV_EQE_PORT", "8765"))
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


def write_export(content: bytes, filename: str) -> tuple[Path, str]:
    clean_name = safe_filename(filename)
    try:
        destination = unique_path(desktop_path(), clean_name)
        destination.write_bytes(content)
        location = "desktop"
    except OSError:
        fallback_directory = ROOT / "exports"
        fallback_directory.mkdir(parents=True, exist_ok=True)
        destination = unique_path(fallback_directory, clean_name)
        destination.write_bytes(content)
        location = "project"

    zone_stream = Path(f"{destination}:Zone.Identifier")
    try:
        if zone_stream.exists():
            zone_stream.unlink()
    except OSError:
        pass
    return destination, location


def origin_skill_root() -> Path:
    configured = os.environ.get("ORIGIN_JV_EQE_SKILL")
    candidates = [
        Path(configured) if configured else None,
        Path.home() / ".agents" / "skills" / "origin-jv-eqe",
        Path.home() / ".codex" / "skills" / "origin-jv-eqe",
        ROOT / "origin-skill" / "origin-jv-eqe",
    ]
    for candidate in candidates:
        if candidate and (candidate / "scripts" / "inspect_bundle.py").is_file() and (
            candidate / "scripts" / "create_origin_project.py"
        ).is_file():
            return candidate
    raise FileNotFoundError("未找到 origin-jv-eqe Skill，请先安装或恢复项目内置 Skill")


def _is_origin_python(command: list[str]) -> bool:
    try:
        result = subprocess.run(
            command + [
                "-c",
                "import struct,sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) and struct.calcsize('P') == 8 else 1)",
            ],
            capture_output=True,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def origin_python_command() -> list[str]:
    configured = os.environ.get("ORIGIN_SKILL_PYTHON")
    codex_python = (
        Path.home()
        / ".cache"
        / "codex-runtimes"
        / "codex-primary-runtime"
        / "dependencies"
        / "python"
        / "python.exe"
    )
    launcher = shutil.which("py")
    python312 = shutil.which("python3.12")
    candidates = [
        [configured] if configured else None,
        [str(codex_python)] if codex_python.is_file() else None,
        [sys.executable],
        [launcher, "-3.12"] if launcher else None,
        [python312] if python312 else None,
    ]
    for command in candidates:
        if command and _is_origin_python(command):
            return command
    raise RuntimeError("未找到 64 位 CPython 3.12；请安装 Python 3.12 或设置 ORIGIN_SKILL_PYTHON")


def run_skill(command: list[str], timeout: int) -> subprocess.CompletedProcess:
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


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
        if parsed.path not in {"/api/save", "/api/open-origin"}:
            self.send_error(404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0

        if content_length <= 0 or content_length > MAX_UPLOAD_BYTES:
            self.send_json(400, {"error": "导出文件大小无效"})
            return

        content = self.rfile.read(content_length)
        filename = parse_qs(parsed.query).get("filename", ["导出文件"])[0]

        if parsed.path == "/api/open-origin":
            self.open_origin(content, filename)
            return

        try:
            destination, location = write_export(content, filename)
        except OSError as error:
            self.send_json(500, {"error": str(error)})
            return

        self.send_json(200, {
            "ok": True,
            "filename": destination.name,
            "path": str(destination),
            "location": location,
        })

    def open_origin(self, content: bytes, filename: str) -> None:
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if content_type != "application/zip":
            self.send_json(415, {"error": "一键打开 Origin 仅接受网站生成的 ZIP 作图包"})
            return

        bundle_name = safe_filename(filename)
        if not bundle_name.lower().endswith(".zip"):
            bundle_name = f"{bundle_name}.zip"

        try:
            bundle_path, location = write_export(content, bundle_name)
            output_path = unique_path(bundle_path.parent, f"{bundle_path.stem}.opju")
            skill_root = origin_skill_root()
            python_command = origin_python_command()
            inspect_script = skill_root / "scripts" / "inspect_bundle.py"
            create_script = skill_root / "scripts" / "create_origin_project.py"

            inspection = run_skill(
                python_command + [str(inspect_script), str(bundle_path)],
                timeout=30,
            )
            if inspection.returncode != 0:
                detail = (inspection.stderr or inspection.stdout or "Origin 作图包校验失败").strip()
                self.send_json(400, {"error": detail[-2000:]})
                return

            creation = run_skill(
                python_command + [
                    str(create_script),
                    str(bundle_path),
                    "--output",
                    str(output_path),
                    "--show",
                ],
                timeout=180,
            )
            if creation.returncode != 0 or not output_path.is_file():
                detail = (creation.stderr or creation.stdout or "Origin 工程创建失败").strip()
                self.send_json(500, {"error": detail[-2000:]})
                return

            warnings = [
                line.removeprefix("WARNING: ")
                for line in creation.stdout.splitlines()
                if line.startswith("WARNING: ")
            ]
            try:
                bundle_path.unlink()
            except OSError:
                pass
            self.send_json(200, {
                "ok": True,
                "project": str(output_path),
                "filename": output_path.name,
                "location": location,
                "opened": True,
                "warnings": warnings,
            })
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": "Origin 自动作图超时，请确认 Origin 没有弹出等待操作的窗口"})
        except (OSError, RuntimeError) as error:
            self.send_json(500, {"error": str(error)})

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
