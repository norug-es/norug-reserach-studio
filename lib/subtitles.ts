export type SubtitleSegment = {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
};

function safeMilliseconds(value: number) {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

function timestamp(milliseconds: number, separator: "," | ".") {
  const total = safeMilliseconds(milliseconds);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

function cleanText(value: string) {
  return value.normalize("NFC").replace(/\r\n?/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
}

export function toSrt(segments: SubtitleSegment[]) {
  return segments.map((segment, position) => [
    String(position + 1),
    `${timestamp(segment.startMs, ",")} --> ${timestamp(segment.endMs, ",")}`,
    cleanText(segment.text),
  ].join("\n")).join("\n\n") + (segments.length ? "\n" : "");
}

export function toVtt(segments: SubtitleSegment[]) {
  const cues = segments.map((segment) => [
    `${timestamp(segment.startMs, ".")} --> ${timestamp(segment.endMs, ".")}`,
    cleanText(segment.text),
  ].join("\n")).join("\n\n");
  return `WEBVTT\n\n${cues}${cues ? "\n" : ""}`;
}

export function subtitleFileName(originalName: string, extension: "srt" | "vtt") {
  const base = originalName.replace(/\.[^.]+$/u, "").normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "-").trim() || "transcripcion";
  return `${base}.${extension}`;
}
