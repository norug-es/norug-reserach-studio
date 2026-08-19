import { transcribeMedia, transcriberHealth } from "../lib/transcriber.ts";

function silentWav(seconds = 1, sampleRate = 16_000) {
  const samples = seconds * sampleRate;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

const health = await transcriberHealth();
const result = await transcribeMedia(silentWav(), "control-silencio.wav", "audio/wav");
if (result.duration < 0.5) throw new Error("Whisper no informó la duración del audio de control");
console.log(`Whisper operativo: ${String(health.model)} · ${String(health.device)} · ` +
  `${result.duration.toFixed(2)} s · ${result.segments.length} segmentos`);
