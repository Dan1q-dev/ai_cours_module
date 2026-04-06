from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

APP_TITLE = "Local STT (faster-whisper)"
MODEL_SIZE = os.getenv("STT_MODEL_SIZE", "small")
REQUESTED_DEVICE = os.getenv("STT_DEVICE", "cpu").strip().lower()
REQUESTED_COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "int8").strip()
STT_CUDA_DLL_DIR = os.getenv("STT_CUDA_DLL_DIR", "").strip()
STT_BEAM_SIZE = int(os.getenv("STT_BEAM_SIZE", "5"))
STT_BEST_OF = int(os.getenv("STT_BEST_OF", "5"))
STT_TEMPERATURE = float(os.getenv("STT_TEMPERATURE", "0.0"))
STT_VAD_FILTER = os.getenv("STT_VAD_FILTER", "true").strip().lower() == "true"
STT_CONDITION_ON_PREVIOUS_TEXT = (
    os.getenv("STT_CONDITION_ON_PREVIOUS_TEXT", "false").strip().lower() == "true"
)
MAX_UPLOAD_BYTES = int(os.getenv("STT_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
ALLOWED_LANGUAGES = ("ru", "kk", "en")
TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁәіңғүұқөһӘІҢҒҮҰҚӨҺ0-9]+", re.UNICODE)
KAZAKH_SPECIFIC_RE = re.compile(r"[әіңғүұқөһӘІҢҒҮҰҚӨҺ]")
CYRILLIC_RE = re.compile(r"[а-яА-ЯёЁ]")
LATIN_RE = re.compile(r"[a-zA-Z]")
SERVICE_CORS_ORIGINS = os.getenv("SERVICE_CORS_ORIGINS", "*")
SERVICE_CORS_ALLOW_CREDENTIALS = (
    os.getenv("SERVICE_CORS_ALLOW_CREDENTIALS", "false").strip().lower() == "true"
)

# Ensure CUDA runtime DLLs are resolvable for Windows GPU builds.
if STT_CUDA_DLL_DIR and Path(STT_CUDA_DLL_DIR).exists():
    os.environ["PATH"] = f"{STT_CUDA_DLL_DIR}{os.pathsep}{os.environ.get('PATH', '')}"
    if hasattr(os, "add_dll_directory"):
        try:
            os.add_dll_directory(STT_CUDA_DLL_DIR)
        except OSError:
            # Non-fatal: PATH update above may still be enough.
            pass

from faster_whisper import WhisperModel

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

ACTIVE_DEVICE = REQUESTED_DEVICE
ACTIVE_COMPUTE_TYPE = REQUESTED_COMPUTE_TYPE
MODEL_FALLBACK_REASON = ""


def _init_model(device: str, compute_type: str) -> WhisperModel:
    return WhisperModel(
        MODEL_SIZE,
        device=device,
        compute_type=compute_type,
    )


def _load_model_with_fallback() -> WhisperModel:
    global ACTIVE_DEVICE, ACTIVE_COMPUTE_TYPE, MODEL_FALLBACK_REASON
    attempts: list[str] = []
    requested_compute_lower = REQUESTED_COMPUTE_TYPE.lower()
    tried: set[tuple[str, str]] = set()

    def try_init(device: str, compute_type: str, reason: str) -> WhisperModel | None:
        global ACTIVE_DEVICE, ACTIVE_COMPUTE_TYPE, MODEL_FALLBACK_REASON
        key = (device, compute_type)
        if key in tried:
            return None
        tried.add(key)
        try:
            model_instance = _init_model(device, compute_type)
            ACTIVE_DEVICE = device
            ACTIVE_COMPUTE_TYPE = compute_type
            MODEL_FALLBACK_REASON = reason
            return model_instance
        except Exception as exc:  # noqa: BLE001
            attempts.append(f"{device}/{compute_type}: {exc}")
            return None

    model_instance = try_init(REQUESTED_DEVICE, REQUESTED_COMPUTE_TYPE, "")
    if model_instance is not None:
        return model_instance

    # If float16 is not supported by current backend/device, try safer compute types.
    if requested_compute_lower == "float16":
        model_instance = try_init(
            REQUESTED_DEVICE,
            "int8_float16",
            f"Requested {REQUESTED_DEVICE}/{REQUESTED_COMPUTE_TYPE} is not supported. "
            f"Switched to {REQUESTED_DEVICE}/int8_float16.",
        )
        if model_instance is not None:
            return model_instance

        model_instance = try_init(
            REQUESTED_DEVICE,
            "int8",
            f"Requested {REQUESTED_DEVICE}/{REQUESTED_COMPUTE_TYPE} is not supported. "
            f"Switched to {REQUESTED_DEVICE}/int8.",
        )
        if model_instance is not None:
            return model_instance

    # Fallback to CPU if device-specific init keeps failing.
    model_instance = try_init(
        "cpu",
        "int8",
        f"Requested {REQUESTED_DEVICE}/{REQUESTED_COMPUTE_TYPE} failed. Switched to cpu/int8.",
    )
    if model_instance is not None:
        return model_instance

    model_instance = try_init(
        "cpu",
        "float32",
        f"Requested {REQUESTED_DEVICE}/{REQUESTED_COMPUTE_TYPE} failed. Switched to cpu/float32.",
    )
    if model_instance is not None:
        return model_instance

    attempts_summary = " | ".join(attempts) if attempts else "no attempts recorded"
    raise RuntimeError(
        "Unable to initialize faster-whisper model with requested settings. "
        f"Attempts: {attempts_summary}"
    )


model = _load_model_with_fallback()


def _save_upload_to_temp(upload: UploadFile) -> Path:
    suffix = Path(upload.filename or "audio.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        while True:
            chunk = upload.file.read(1024 * 1024)
            if not chunk:
                break
            tmp.write(chunk)
        return Path(tmp.name)


def _tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_RE.findall(text)]


def _max_consecutive_run(tokens: list[str]) -> int:
    if not tokens:
        return 0
    max_run = 1
    current_run = 1
    for index in range(1, len(tokens)):
        if tokens[index] == tokens[index - 1]:
            current_run += 1
            if current_run > max_run:
                max_run = current_run
        else:
            current_run = 1
    return max_run


def _candidate_score(text: str, avg_logprob: float, language: str) -> float:
    if not text:
        return float("-inf")

    tokens = _tokenize(text)
    token_count = len(tokens)
    if token_count == 0:
        return avg_logprob - 2.5

    unique_ratio = len(set(tokens)) / token_count
    dominant_ratio = max(tokens.count(token) for token in set(tokens)) / token_count
    max_run = _max_consecutive_run(tokens)

    score = avg_logprob
    score += min(token_count, 30) * 0.018
    score += unique_ratio * 0.65

    if token_count >= 8 and unique_ratio < 0.38:
        score -= 1.5
    if dominant_ratio > 0.55:
        score -= (dominant_ratio - 0.55) * 4.0
    if max_run >= 4:
        score -= (max_run - 3) * 0.8

    has_kazakh_specific = bool(KAZAKH_SPECIFIC_RE.search(text))
    has_cyrillic = bool(CYRILLIC_RE.search(text))
    has_latin = bool(LATIN_RE.search(text))

    if language == "kk":
        score += 0.18 if has_kazakh_specific else -0.18
    elif language == "ru":
        score += 0.1 if has_cyrillic and not has_kazakh_specific else -0.05
    elif language == "en":
        if has_latin and not has_cyrillic and not has_kazakh_specific:
            score += 0.22
        elif has_cyrillic or has_kazakh_specific:
            score -= 0.2

    return score


def _looks_degenerate(text: str) -> bool:
    tokens = _tokenize(text)
    token_count = len(tokens)
    if token_count < 8:
        return False

    unique_ratio = len(set(tokens)) / token_count
    dominant_ratio = max(tokens.count(token) for token in set(tokens)) / token_count
    max_run = _max_consecutive_run(tokens)

    if max_run >= 5:
        return True
    if unique_ratio < 0.25:
        return True
    if dominant_ratio > 0.7:
        return True
    return False


def _transcribe_with_language(audio_path: Path, language: str) -> tuple[str, float]:
    global model, ACTIVE_DEVICE, ACTIVE_COMPUTE_TYPE, MODEL_FALLBACK_REASON

    try:
        segments, _ = model.transcribe(
            str(audio_path),
            language=language,
            vad_filter=STT_VAD_FILTER,
            beam_size=max(1, STT_BEAM_SIZE),
            best_of=max(1, STT_BEST_OF),
            temperature=STT_TEMPERATURE,
            condition_on_previous_text=STT_CONDITION_ON_PREVIOUS_TEXT,
        )
    except Exception as exc:
        error_message = str(exc).lower()
        can_fallback = (
            ACTIVE_DEVICE == "cuda"
            and ("cublas" in error_message or "cudnn" in error_message or "cuda" in error_message)
        )
        if not can_fallback:
            raise

        fallback_compute_type = "int8"
        model = _init_model("cpu", fallback_compute_type)
        ACTIVE_DEVICE = "cpu"
        ACTIVE_COMPUTE_TYPE = fallback_compute_type
        MODEL_FALLBACK_REASON = f"Switched to CPU after CUDA runtime error: {exc}"
        segments, _ = model.transcribe(
            str(audio_path),
            language=language,
            vad_filter=STT_VAD_FILTER,
            beam_size=max(1, STT_BEAM_SIZE),
            best_of=max(1, STT_BEST_OF),
            temperature=STT_TEMPERATURE,
            condition_on_previous_text=STT_CONDITION_ON_PREVIOUS_TEXT,
        )

    parts: list[str] = []
    weighted_score_sum = 0.0
    weighted_score_weight = 0

    for segment in segments:
        text = (segment.text or "").strip()
        if not text:
            continue
        parts.append(text)
        avg_logprob = float(getattr(segment, "avg_logprob", -5.0))
        weight = max(len(text), 1)
        weighted_score_sum += avg_logprob * weight
        weighted_score_weight += weight

    final_text = " ".join(parts).strip()
    if weighted_score_weight == 0:
        return final_text, -10.0

    return final_text, weighted_score_sum / weighted_score_weight


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "model": MODEL_SIZE,
        "device": ACTIVE_DEVICE,
        "compute_type": ACTIVE_COMPUTE_TYPE,
        "requested_device": REQUESTED_DEVICE,
        "requested_compute_type": REQUESTED_COMPUTE_TYPE,
        "stt_cuda_dll_dir": STT_CUDA_DLL_DIR,
        "stt_cuda_dll_dir_exists": str(bool(STT_CUDA_DLL_DIR and Path(STT_CUDA_DLL_DIR).exists())).lower(),
        "beam_size": str(STT_BEAM_SIZE),
        "best_of": str(STT_BEST_OF),
        "temperature": str(STT_TEMPERATURE),
        "condition_on_previous_text": str(STT_CONDITION_ON_PREVIOUS_TEXT).lower(),
        "fallback_reason": MODEL_FALLBACK_REASON,
    }


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(default="auto"),
    preferred_language: Optional[str] = Form(default=""),
) -> dict[str, str]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Empty filename")

    content_type = (file.content_type or "").lower()
    allowed_prefixes = ("audio/", "video/")
    if content_type and not content_type.startswith(allowed_prefixes):
        raise HTTPException(status_code=400, detail=f"Unsupported content type: {content_type}")

    # Basic size guard without loading full file into memory.
    size = 0
    for chunk in file.file:
        size += len(chunk)
        if size > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="Audio file is too large")
    file.file.seek(0)

    tmp_path = _save_upload_to_temp(file)
    try:
        requested_language = (language or "auto").strip().lower()
        if requested_language != "auto" and requested_language not in ALLOWED_LANGUAGES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported language: {requested_language}. Allowed: {', '.join(ALLOWED_LANGUAGES)} or auto",
            )
        preferred = (preferred_language or "").strip().lower()
        if preferred and preferred not in ALLOWED_LANGUAGES:
            preferred = ""

        if requested_language == "auto":
            candidates: list[tuple[str, str, float]] = []
            for candidate_language in ALLOWED_LANGUAGES:
                candidate_text, candidate_score = _transcribe_with_language(tmp_path, candidate_language)
                total_score = _candidate_score(
                    text=candidate_text,
                    avg_logprob=candidate_score,
                    language=candidate_language,
                )
                if preferred and candidate_language == preferred:
                    total_score += 0.2
                candidates.append((candidate_language, candidate_text, total_score))

            candidates.sort(key=lambda item: item[2], reverse=True)

            for candidate_language, candidate_text, _ in candidates:
                if candidate_text and not _looks_degenerate(candidate_text):
                    return {"text": candidate_text, "language": candidate_language}

            for candidate_language, candidate_text, _ in candidates:
                if candidate_text:
                    return {"text": candidate_text, "language": candidate_language}

            fallback_language = preferred or "ru"
            return {"text": "", "language": fallback_language}

        text, _score = _transcribe_with_language(tmp_path, requested_language)
        return {"text": text, "language": requested_language}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
