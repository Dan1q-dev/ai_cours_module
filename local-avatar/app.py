from __future__ import annotations

import os
import shlex
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

APP_TITLE = "Local Avatar Renderer"
BASE_DIR = Path(__file__).resolve().parent
RUSSIAN_LANGUAGE = "ru"
SUPPORTED_ENGINES = {"musetalk"}
SUPPORTED_SOURCE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".bmp",
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
}

SERVICE_CORS_ORIGINS = os.getenv("SERVICE_CORS_ORIGINS", "*")
SERVICE_CORS_ALLOW_CREDENTIALS = (
    os.getenv("SERVICE_CORS_ALLOW_CREDENTIALS", "false").strip().lower() == "true"
)

AVATAR_ENGINE = os.getenv("AVATAR_ENGINE", "musetalk").strip().lower() or "musetalk"
AVATAR_SOURCE_ASSET = os.getenv("AVATAR_SOURCE_ASSET", "").strip()
AVATAR_SOURCE_VIDEO = os.getenv("AVATAR_SOURCE_VIDEO", "").strip()
AVATAR_RESULTS_DIR = os.getenv("AVATAR_RESULTS_DIR", "runs").strip() or "runs"
AVATAR_TIMEOUT_SEC = int(os.getenv("AVATAR_TIMEOUT_SEC", "1200"))

MUSE_TALK_ROOT = os.getenv("MUSE_TALK_ROOT", "").strip()
MUSE_TALK_PYTHON = os.getenv("MUSE_TALK_PYTHON", "python").strip() or "python"
MUSE_TALK_VERSION = os.getenv("MUSE_TALK_VERSION", "v15").strip() or "v15"
MUSE_TALK_UNET_MODEL_PATH = os.getenv("MUSE_TALK_UNET_MODEL_PATH", "").strip()
MUSE_TALK_UNET_CONFIG_PATH = os.getenv("MUSE_TALK_UNET_CONFIG_PATH", "").strip()
MUSE_TALK_FFMPEG_PATH = os.getenv("MUSE_TALK_FFMPEG_PATH", "").strip()
MUSE_TALK_COMMAND_TEMPLATE = os.getenv("MUSE_TALK_COMMAND_TEMPLATE", "").strip()

if MUSE_TALK_FFMPEG_PATH:
    os.environ["PATH"] = f"{MUSE_TALK_FFMPEG_PATH}{os.pathsep}{os.environ.get('PATH', '')}"

app = FastAPI(title=APP_TITLE)


def _parse_cors_origins(raw_value: str) -> list[str]:
    origins = [item.strip() for item in raw_value.split(",") if item.strip()]
    return origins or ["*"]


cors_origins = _parse_cors_origins(SERVICE_CORS_ORIGINS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=SERVICE_CORS_ALLOW_CREDENTIALS and cors_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _engine_root(engine: str) -> str:
    if engine == "musetalk":
        return MUSE_TALK_ROOT
    return ""


def _engine_python(engine: str) -> str:
    if engine == "musetalk":
        return MUSE_TALK_PYTHON
    return "python"


def _engine_command_template(engine: str) -> str:
    if engine == "musetalk":
        return MUSE_TALK_COMMAND_TEMPLATE
    return ""


def _results_root() -> Path:
    results_path = Path(AVATAR_RESULTS_DIR)
    if not results_path.is_absolute():
        results_path = BASE_DIR / results_path
    results_path.mkdir(parents=True, exist_ok=True)
    return results_path


def _resolve_source_asset() -> Path | None:
    configured = AVATAR_SOURCE_ASSET or AVATAR_SOURCE_VIDEO
    if configured:
        candidate = Path(configured)
        if candidate.exists():
            return candidate

    search_roots = [Path(root) for root in (_engine_root(AVATAR_ENGINE), MUSE_TALK_ROOT) if root]
    search_roots.append(BASE_DIR.parent / "assets" / "avatar")

    for root in search_roots:
        if not root.exists():
            continue
        if root.is_file() and root.suffix.lower() in SUPPORTED_SOURCE_EXTENSIONS:
            return root
        if root.is_dir():
            for pattern in ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp", "*.mp4", "*.mov", "*.avi", "*.mkv", "*.webm"):
                matches = sorted(root.rglob(pattern))
                if matches:
                    return matches[0]

    return None


def _template_placeholders(
    *,
    engine: str,
    root: str,
    python_path: str,
    result_dir: Path,
    source_path: Path,
    audio_path: Path,
    config_path: Path,
    output_path: Path,
) -> dict[str, str]:
    return {
        "engine": engine,
        "root": root,
        "python": python_path,
        "result_dir": str(result_dir),
        "source_path": str(source_path),
        "video_path": str(source_path),
        "audio_path": str(audio_path),
        "config_path": str(config_path),
        "output_path": str(output_path),
        "version": MUSE_TALK_VERSION,
        "unet_model_path": MUSE_TALK_UNET_MODEL_PATH,
        "unet_config": MUSE_TALK_UNET_CONFIG_PATH,
        "ffmpeg_path": MUSE_TALK_FFMPEG_PATH,
    }


def _prepare_musetalk_config(config_path: Path, source_path: Path, audio_path: Path, output_name: str) -> None:
    payload: dict[str, Any] = {
        "task_0": {
            "video_path": str(source_path),
            "audio_path": str(audio_path),
            "result_name": output_name,
        }
    }
    config_path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True), encoding="utf-8")


def _bool_flag(flag_name: str, enabled: bool) -> list[str]:
    return [f"--{flag_name}"] if enabled else [f"--no_{flag_name}"]


def _build_musetalk_default_command(
    *,
    root: str,
    python_path: str,
    config_path: Path,
    result_dir: Path,
) -> list[str]:
    if not root:
        raise HTTPException(status_code=500, detail="MUSE_TALK_ROOT is not configured")
    if not Path(root).exists():
        raise HTTPException(status_code=500, detail=f"MUSE_TALK_ROOT does not exist: {root}")

    command = [
        python_path,
        "-m",
        "scripts.inference",
        "--inference_config",
        str(config_path),
        "--result_dir",
        str(result_dir),
        "--version",
        MUSE_TALK_VERSION,
    ]
    if MUSE_TALK_UNET_MODEL_PATH:
        command.extend(["--unet_model_path", MUSE_TALK_UNET_MODEL_PATH])
    if MUSE_TALK_UNET_CONFIG_PATH:
        command.extend(["--unet_config", MUSE_TALK_UNET_CONFIG_PATH])
    if MUSE_TALK_FFMPEG_PATH:
        command.extend(["--ffmpeg_path", MUSE_TALK_FFMPEG_PATH])
    return command


def _build_command(
    *,
    engine: str,
    root: str,
    python_path: str,
    result_dir: Path,
    source_path: Path,
    audio_path: Path,
    config_path: Path,
    output_path: Path,
) -> list[str]:
    template = _engine_command_template(engine)
    placeholders = _template_placeholders(
        engine=engine,
        root=root,
        python_path=python_path,
        result_dir=result_dir,
        source_path=source_path,
        audio_path=audio_path,
        config_path=config_path,
        output_path=output_path,
    )

    if template:
        formatted = template.format(**placeholders)
        return shlex.split(formatted, posix=os.name != "nt")

    if engine == "musetalk":
        return _build_musetalk_default_command(
            root=root,
            python_path=python_path,
            config_path=config_path,
            result_dir=result_dir,
        )

    raise HTTPException(status_code=500, detail=f"Unsupported avatar engine: {engine}")


def _find_latest_output(result_dir: Path, started_at: float, preferred_output: Path) -> Path:
    if preferred_output.exists():
        return preferred_output

    candidates: list[Path] = []
    for candidate in result_dir.rglob("*.mp4"):
        try:
            if candidate.stat().st_mtime >= started_at - 1:
                candidates.append(candidate)
        except OSError:
            continue

    if not candidates:
        raise HTTPException(
            status_code=500,
            detail="Avatar renderer completed, but no MP4 output was found in the results directory.",
        )

    candidates.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    return candidates[0]


def _ffmpeg_binary() -> str:
    return "ffmpeg.exe" if os.name == "nt" else "ffmpeg"


def _is_ready() -> tuple[bool, str]:
    if AVATAR_ENGINE not in SUPPORTED_ENGINES:
        return False, f"Unsupported avatar engine: {AVATAR_ENGINE}"

    source_asset = _resolve_source_asset()
    if source_asset is None:
        return False, "Avatar source asset is not configured or does not exist"

    if AVATAR_ENGINE == "musetalk":
        if MUSE_TALK_COMMAND_TEMPLATE:
            return True, ""
        if not MUSE_TALK_ROOT:
            return False, "MUSE_TALK_ROOT is not configured"
        if not Path(MUSE_TALK_ROOT).exists():
            return False, f"MUSE_TALK_ROOT does not exist: {MUSE_TALK_ROOT}"
        return True, ""

    return False, f"Unsupported avatar engine: {AVATAR_ENGINE}"


def _cleanup_paths(paths: list[Path]) -> None:
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


@app.get("/health")
def health() -> dict[str, Any]:
    ready, reason = _is_ready()
    source_asset = _resolve_source_asset()
    root = _engine_root(AVATAR_ENGINE)
    return {
        "status": "ok" if ready else "degraded",
        "engine": AVATAR_ENGINE,
        "ready": ready,
        "ready_reason": reason,
        "source_asset_config": AVATAR_SOURCE_ASSET or AVATAR_SOURCE_VIDEO,
        "source_asset_resolved": str(source_asset) if source_asset else "",
        "source_video_resolved": str(source_asset) if source_asset else "",
        "engine_root": root,
        "engine_root_exists": bool(root and Path(root).exists()),
        "command_template": bool(_engine_command_template(AVATAR_ENGINE)),
        "results_dir": str(_results_root()),
        "timeout_sec": AVATAR_TIMEOUT_SEC,
    }


@app.post("/render")
async def render(
    file: UploadFile = File(...),
    language: str = Form(default=RUSSIAN_LANGUAGE),
):
    if (language or RUSSIAN_LANGUAGE).strip().lower() != RUSSIAN_LANGUAGE:
        raise HTTPException(status_code=400, detail="Avatar renderer supports only Russian language (`ru`).")

    if not file.filename:
        raise HTTPException(status_code=400, detail="Empty audio filename")

    ready, reason = _is_ready()
    if not ready:
        raise HTTPException(status_code=500, detail=reason)

    source_asset = _resolve_source_asset()
    if source_asset is None:
        raise HTTPException(status_code=500, detail="AVATAR_SOURCE_ASSET is not configured or file does not exist")

    render_id = uuid.uuid4().hex
    result_dir = _results_root() / render_id
    result_dir.mkdir(parents=True, exist_ok=True)

    audio_suffix = Path(file.filename).suffix or ".wav"
    audio_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=audio_suffix)
    config_path = result_dir / "inference.yaml"
    output_name = f"render_{render_id}.mp4"
    output_path = result_dir / output_name
    audio_path = Path(audio_tmp.name)
    audio_tmp.close()

    try:
        content = await file.read()
        audio_path.write_bytes(content)

        _prepare_musetalk_config(
            config_path=config_path,
            source_path=source_asset,
            audio_path=audio_path,
            output_name=output_name,
        )

        root = _engine_root(AVATAR_ENGINE)
        python_path = _engine_python(AVATAR_ENGINE)
        command = _build_command(
            engine=AVATAR_ENGINE,
            root=root,
            python_path=python_path,
            result_dir=result_dir,
            source_path=source_asset,
            audio_path=audio_path,
            config_path=config_path,
            output_path=output_path,
        )

        started_at = time.time()
        env = os.environ.copy()
        cwd = Path(root) if root else BASE_DIR
        completed = subprocess.run(
            command,
            cwd=str(cwd),
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=AVATAR_TIMEOUT_SEC,
            check=False,
        )

        if completed.returncode != 0:
            details = (completed.stderr or completed.stdout or "").strip()
            raise HTTPException(
                status_code=500,
                detail=f"{AVATAR_ENGINE} render failed: {details or f'exit={completed.returncode}'}",
            )

        resolved_output = _find_latest_output(
            result_dir=result_dir,
            started_at=started_at,
            preferred_output=output_path,
        )

        return FileResponse(
            path=str(resolved_output),
            media_type="video/mp4",
            filename=resolved_output.name,
            background=BackgroundTask(lambda: _cleanup_paths([audio_path, config_path])),
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            status_code=504,
            detail=f"{AVATAR_ENGINE} render timed out after {AVATAR_TIMEOUT_SEC} seconds",
        ) from exc
    except HTTPException:
        _cleanup_paths([audio_path, config_path])
        raise
    except Exception as exc:  # noqa: BLE001
        _cleanup_paths([audio_path, config_path])
        raise HTTPException(status_code=500, detail=f"Avatar render failed: {exc}") from exc
