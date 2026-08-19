import asyncio
import hmac
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from faster_whisper import WhisperModel


APP_VERSION = "0.6.6"
MODEL_NAME = os.getenv("WHISPER_MODEL", "small").strip()
DEVICE = os.getenv("WHISPER_DEVICE", "cpu").strip()
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8").strip()
DOWNLOAD_ROOT = os.getenv("WHISPER_MODEL_CACHE", "/models").strip()
MAX_BYTES = int(os.getenv("TRANSCRIBER_MAX_BYTES", "52428800"))
CPU_THREADS = max(1, int(os.getenv("WHISPER_CPU_THREADS", "4")))
NUM_WORKERS = max(1, int(os.getenv("WHISPER_NUM_WORKERS", "1")))
BEAM_SIZE = max(1, int(os.getenv("WHISPER_BEAM_SIZE", "5")))
API_KEY = os.getenv("TRANSCRIBER_API_KEY", "").strip()
ALLOWED_SUFFIXES = {
    ".mp3", ".wav", ".m4a", ".opus", ".3gp", ".3gpp",
    ".mp4", ".mpeg", ".mpg", ".webm", ".mov",
}

app = FastAPI(title="NoRug Whisper Transcriber", version=APP_VERSION, docs_url=None, redoc_url=None)
model: WhisperModel | None = None
model_lock = asyncio.Lock()
inference_lock = asyncio.Lock()
logger = logging.getLogger("uvicorn.error")


def authorize(token: str | None) -> None:
    if not API_KEY or not token or not hmac.compare_digest(token, API_KEY):
        raise HTTPException(status_code=401, detail="Credencial interna inválida")


async def get_model() -> WhisperModel:
    global model
    if model is not None:
        return model
    async with model_lock:
        if model is None:
            Path(DOWNLOAD_ROOT).mkdir(parents=True, exist_ok=True)
            model = await asyncio.to_thread(
                WhisperModel,
                MODEL_NAME,
                device=DEVICE,
                compute_type=COMPUTE_TYPE,
                download_root=DOWNLOAD_ROOT,
                cpu_threads=CPU_THREADS,
                num_workers=NUM_WORKERS,
            )
    return model


def run_transcription(path: str, language: str, word_timestamps: bool) -> dict:
    whisper = model
    if whisper is None:
        raise RuntimeError("Modelo Whisper no inicializado")
    segments_iterator, info = whisper.transcribe(
        path,
        language=None if language == "auto" else language,
        beam_size=BEAM_SIZE,
        vad_filter=True,
        word_timestamps=word_timestamps,
        condition_on_previous_text=True,
    )
    segments = []
    complete_text = []
    for index, segment in enumerate(segments_iterator):
        text = segment.text.strip()
        if not text:
            continue
        complete_text.append(text)
        words = []
        for word in segment.words or []:
            words.append({
                "start": word.start,
                "end": word.end,
                "word": word.word,
                "probability": word.probability,
            })
        segments.append({
            "index": index,
            "start": segment.start,
            "end": segment.end,
            "text": text,
            "avgLogprob": segment.avg_logprob,
            "noSpeechProb": segment.no_speech_prob,
            "words": words,
        })
    return {
        "engine": "faster-whisper",
        "model": MODEL_NAME,
        "device": DEVICE,
        "computeType": COMPUTE_TYPE,
        "language": info.language,
        "languageProbability": info.language_probability,
        "duration": info.duration,
        "durationAfterVad": getattr(info, "duration_after_vad", None),
        "text": " ".join(complete_text),
        "segments": segments,
    }


def transcription_producer(
    path: str,
    language: str,
    word_timestamps: bool,
    loop: asyncio.AbstractEventLoop,
    queue: asyncio.Queue,
) -> None:
    whisper = model
    if whisper is None:
        loop.call_soon_threadsafe(queue.put_nowait, {
            "type": "error", "message": "Modelo Whisper no inicializado",
        })
        return
    started_at = time.monotonic()
    try:
        segments_iterator, info = whisper.transcribe(
            path,
            language=None if language == "auto" else language,
            beam_size=BEAM_SIZE,
            vad_filter=True,
            word_timestamps=word_timestamps,
            condition_on_previous_text=True,
        )
        duration = max(float(info.duration or 0), 0.001)
        loop.call_soon_threadsafe(queue.put_nowait, {
            "type": "metadata",
            "progress": 0,
            "durationSeconds": duration,
            "language": info.language,
            "languageProbability": info.language_probability,
        })
        segments = []
        complete_text = []
        last_log_bucket = -1
        for index, segment in enumerate(segments_iterator):
            text = segment.text.strip()
            if not text:
                continue
            complete_text.append(text)
            words = [{
                "start": word.start,
                "end": word.end,
                "word": word.word,
                "probability": word.probability,
            } for word in segment.words or []]
            normalized_segment = {
                "index": index,
                "start": segment.start,
                "end": segment.end,
                "text": text,
                "avgLogprob": segment.avg_logprob,
                "noSpeechProb": segment.no_speech_prob,
                "words": words,
            }
            segments.append(normalized_segment)
            ratio = min(1.0, max(0.0, float(segment.end) / duration))
            elapsed = time.monotonic() - started_at
            eta = (elapsed / ratio - elapsed) if ratio >= 0.02 else None
            progress = max(1, min(99, round(ratio * 100)))
            bucket = progress // 10
            if bucket > last_log_bucket:
                last_log_bucket = bucket
                logger.info(
                    "Transcripción activa: %s%% · %.1fs/%.1fs · segmento %s",
                    progress, segment.end, duration, index + 1,
                )
            loop.call_soon_threadsafe(queue.put_nowait, {
                "type": "segment",
                "progress": progress,
                "processedSeconds": segment.end,
                "durationSeconds": duration,
                "elapsedSeconds": elapsed,
                "etaSeconds": eta,
                "segment": normalized_segment,
            })
        result = {
            "engine": "faster-whisper",
            "model": MODEL_NAME,
            "device": DEVICE,
            "computeType": COMPUTE_TYPE,
            "language": info.language,
            "languageProbability": info.language_probability,
            "duration": info.duration,
            "durationAfterVad": getattr(info, "duration_after_vad", None),
            "text": " ".join(complete_text),
            "segments": segments,
        }
        loop.call_soon_threadsafe(queue.put_nowait, {
            "type": "complete", "progress": 100, "result": result,
        })
    except Exception as error:
        logger.exception("La transcripción ha fallado")
        loop.call_soon_threadsafe(queue.put_nowait, {
            "type": "error", "message": str(error),
        })
    finally:
        loop.call_soon_threadsafe(queue.put_nowait, None)


async def stream_transcription(path: str, language: str, word_timestamps: bool):
    started_at = time.monotonic()
    yield json.dumps({
        "type": "status", "stage": "loading_model", "progress": 0,
        "elapsedSeconds": 0,
    }) + "\n"
    model_task = asyncio.create_task(get_model())
    while not model_task.done():
        done, _ = await asyncio.wait({model_task}, timeout=5)
        if not done:
            yield json.dumps({
                "type": "status", "stage": "loading_model", "progress": 0,
                "elapsedSeconds": time.monotonic() - started_at,
            }) + "\n"
    await model_task
    yield json.dumps({
        "type": "status", "stage": "waiting_inference", "progress": 0,
        "elapsedSeconds": time.monotonic() - started_at,
    }) + "\n"
    acquire_task = asyncio.create_task(inference_lock.acquire())
    while not acquire_task.done():
        done, _ = await asyncio.wait({acquire_task}, timeout=5)
        if not done:
            yield json.dumps({
                "type": "heartbeat", "stage": "waiting_inference", "progress": 0,
                "elapsedSeconds": time.monotonic() - started_at,
            }) + "\n"
    await acquire_task
    try:
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()
        producer = asyncio.create_task(asyncio.to_thread(
            transcription_producer, path, language, word_timestamps, loop, queue,
        ))
        last_event = {
            "type": "status", "stage": "transcribing", "progress": 0,
            "elapsedSeconds": time.monotonic() - started_at,
        }
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=5)
            except asyncio.TimeoutError:
                heartbeat = dict(last_event)
                heartbeat["type"] = "heartbeat"
                heartbeat["elapsedSeconds"] = time.monotonic() - started_at
                yield json.dumps(heartbeat, ensure_ascii=False) + "\n"
                continue
            if event is None:
                break
            last_event = event
            yield json.dumps(event, ensure_ascii=False) + "\n"
        await producer
    finally:
        inference_lock.release()


@app.get("/health")
async def health(x_internal_token: Annotated[str | None, Header()] = None) -> dict:
    authorize(x_internal_token)
    return {
        "status": "healthy",
        "service": "norug-whisper-transcriber",
        "version": APP_VERSION,
        "model": MODEL_NAME,
        "device": DEVICE,
        "computeType": COMPUTE_TYPE,
        "modelLoaded": model is not None,
    }


@app.post("/v1/transcriptions")
async def transcribe(
    file: Annotated[UploadFile, File()],
    language: Annotated[str, Form()] = "auto",
    word_timestamps: Annotated[bool, Form()] = True,
    x_internal_token: Annotated[str | None, Header()] = None,
) -> dict:
    authorize(x_internal_token)
    suffix = Path(file.filename or "media.bin").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail=f"Formato audiovisual no permitido: {suffix or 'sin extensión'}")
    total = 0
    temporary_path = ""
    try:
        with tempfile.NamedTemporaryFile(prefix="norug-whisper-", suffix=suffix, delete=False) as temporary:
            temporary_path = temporary.name
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(status_code=413, detail="El archivo supera el límite del transcriptor")
                temporary.write(chunk)
        await get_model()
        async with inference_lock:
            return await asyncio.to_thread(run_transcription, temporary_path, language.strip() or "auto", word_timestamps)
    finally:
        await file.close()
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)


@app.post("/v1/transcriptions/stream")
async def transcribe_stream(
    file: Annotated[UploadFile, File()],
    language: Annotated[str, Form()] = "auto",
    word_timestamps: Annotated[bool, Form()] = True,
    x_internal_token: Annotated[str | None, Header()] = None,
):
    authorize(x_internal_token)
    suffix = Path(file.filename or "media.bin").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail=f"Formato audiovisual no permitido: {suffix or 'sin extensión'}")
    total = 0
    temporary_path = ""
    try:
        with tempfile.NamedTemporaryFile(prefix="norug-whisper-", suffix=suffix, delete=False) as temporary:
            temporary_path = temporary.name
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(status_code=413, detail="El archivo supera el límite del transcriptor")
                temporary.write(chunk)
    except Exception:
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    async def response_events():
        try:
            async for event in stream_transcription(
                temporary_path, language.strip() or "auto", word_timestamps,
            ):
                yield event
        finally:
            Path(temporary_path).unlink(missing_ok=True)

    return StreamingResponse(
        response_events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


if os.getenv("WHISPER_PRELOAD", "false").lower() == "true":
    @app.on_event("startup")
    async def preload_model() -> None:
        await get_model()
