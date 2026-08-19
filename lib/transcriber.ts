export type TranscriptionWord = {
  start: number;
  end: number;
  word: string;
  probability: number | null;
};

export type TranscriptionSegment = {
  index: number;
  start: number;
  end: number;
  text: string;
  avgLogprob: number | null;
  noSpeechProb: number | null;
  words: TranscriptionWord[];
};

export type TranscriptionResult = {
  engine: string;
  model: string;
  device: string;
  computeType: string;
  language: string | null;
  languageProbability: number | null;
  duration: number;
  durationAfterVad: number | null;
  text: string;
  segments: TranscriptionSegment[];
};

function config() {
  const url = process.env.TRANSCRIBER_URL?.trim();
  const token = process.env.TRANSCRIBER_API_KEY?.trim();
  if (!url) throw new Error("TRANSCRIBER_URL es obligatorio para transcribir");
  if (!token) throw new Error("TRANSCRIBER_API_KEY es obligatorio para transcribir");
  return {
    url: url.replace(/\/$/, ""),
    token,
    timeoutMs: Math.max(1_000, Number(process.env.TRANSCRIBER_TIMEOUT_MS ?? 3_600_000)),
    language: process.env.WHISPER_LANGUAGE?.trim() || "auto",
  };
}

function finite(value: unknown, fallback: number | null = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeTranscriptionResponse(payload: unknown): TranscriptionResult {
  if (!payload || typeof payload !== "object") throw new Error("El transcriptor devolvió una respuesta inválida");
  const raw = payload as Record<string, unknown>;
  const rawSegments = Array.isArray(raw.segments) ? raw.segments : [];
  const segments = rawSegments.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Segmento ${index} inválido`);
    const segment = item as Record<string, unknown>;
    const start = finite(segment.start, -1) ?? -1;
    const end = finite(segment.end, -1) ?? -1;
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    if (start < 0 || end < start || !text) throw new Error(`Segmento ${index} sin timestamps o texto válidos`);
    const words = (Array.isArray(segment.words) ? segment.words : []).map((entry) => {
      const word = entry as Record<string, unknown>;
      return {
        start: finite(word.start, start) ?? start,
        end: finite(word.end, end) ?? end,
        word: typeof word.word === "string" ? word.word : "",
        probability: finite(word.probability),
      };
    }).filter((word) => word.word);
    return {
      index,
      start,
      end,
      text,
      avgLogprob: finite(segment.avgLogprob ?? segment.avg_logprob),
      noSpeechProb: finite(segment.noSpeechProb ?? segment.no_speech_prob),
      words,
    };
  });
  const duration = finite(raw.duration, segments.at(-1)?.end ?? 0) ?? 0;
  if (duration < 0) throw new Error("Duración de transcripción inválida");
  return {
    engine: typeof raw.engine === "string" ? raw.engine : "faster-whisper",
    model: typeof raw.model === "string" ? raw.model : "unknown",
    device: typeof raw.device === "string" ? raw.device : "unknown",
    computeType: typeof raw.computeType === "string" ? raw.computeType :
      typeof raw.compute_type === "string" ? raw.compute_type : "unknown",
    language: typeof raw.language === "string" ? raw.language : null,
    languageProbability: finite(raw.languageProbability ?? raw.language_probability),
    duration,
    durationAfterVad: finite(raw.durationAfterVad ?? raw.duration_after_vad),
    text: typeof raw.text === "string" ? raw.text.trim() : segments.map((segment) => segment.text).join(" ").trim(),
    segments,
  };
}

async function checkedResponse(response: Response) {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : `HTTP ${response.status}`;
    throw new Error(`Transcriptor rechazó la solicitud: ${detail}`);
  }
  return payload;
}

export async function transcriberHealth() {
  const settings = config();
  const response = await fetch(`${settings.url}/health`, {
    headers: { "x-internal-token": settings.token },
    signal: AbortSignal.timeout(Math.min(settings.timeoutMs, 15_000)),
  });
  const payload = await checkedResponse(response);
  if (payload?.status !== "healthy") throw new Error("El servicio Whisper no está preparado");
  return payload;
}

export async function transcribeMedia(bytes: Uint8Array, fileName: string, contentType: string) {
  const settings = config();
  const form = new FormData();
  const payload = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(payload).set(bytes);
  form.set("file", new Blob([payload], { type: contentType }), fileName);
  form.set("language", settings.language);
  form.set("word_timestamps", "true");
  const response = await fetch(`${settings.url}/v1/transcriptions`, {
    method: "POST",
    headers: { "x-internal-token": settings.token },
    body: form,
    signal: AbortSignal.timeout(settings.timeoutMs),
  });
  return normalizeTranscriptionResponse(await checkedResponse(response));
}
