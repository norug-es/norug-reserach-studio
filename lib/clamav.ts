import { once } from "node:events";
import { createConnection, type Socket } from "node:net";

export type ClamScanResult = {
  status: "clean" | "infected";
  threatName: string | null;
  response: string;
  engineVersion: string;
};

function config() {
  return {
    host: process.env.CLAMAV_HOST?.trim() || "clamav",
    port: Number(process.env.CLAMAV_PORT ?? 3310),
    timeoutMs: Number(process.env.CLAMAV_TIMEOUT_MS ?? 120_000),
  };
}

function socketWithTimeout(): Socket {
  const settings = config();
  const socket = createConnection({ host: settings.host, port: settings.port });
  socket.setTimeout(settings.timeoutMs, () => socket.destroy(new Error("ClamAV excedió el tiempo de respuesta")));
  return socket;
}

async function command(name: "PING" | "VERSION") {
  const socket = socketWithTimeout();
  const chunks: Buffer[] = [];
  socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const finished = new Promise<string>((resolve, reject) => {
    socket.once("error", reject);
    socket.once("close", () => resolve(Buffer.concat(chunks).toString("utf8").replace(/\0+$/, "").trim()));
  });
  await once(socket, "connect");
  socket.end(`z${name}\0`);
  return finished;
}

export async function clamavHealth() {
  const reply = await command("PING");
  if (reply !== "PONG") throw new Error(`ClamAV no respondió PONG: ${reply || "sin respuesta"}`);
  return reply;
}

export function parseClamavResponse(response: string) {
  const clean = /:\s+OK$/i.test(response);
  if (clean) return { status: "clean" as const, threatName: null };
  const infected = response.match(/:\s+(.+?)\s+FOUND$/i);
  if (infected) return { status: "infected" as const, threatName: infected[1] };
  throw new Error(`Respuesta ClamAV no reconocida: ${response || "vacía"}`);
}

export async function scanWithClamav(bytes: Uint8Array): Promise<ClamScanResult> {
  const socket = socketWithTimeout();
  const responses: Buffer[] = [];
  socket.on("data", (chunk) => responses.push(Buffer.from(chunk)));
  const finished = new Promise<string>((resolve, reject) => {
    socket.once("error", reject);
    socket.once("close", () => resolve(Buffer.concat(responses).toString("utf8").replace(/\0+$/, "").trim()));
  });
  await once(socket, "connect");
  socket.write("zINSTREAM\0");
  const chunkSize = 64 * 1024;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = Buffer.from(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)));
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(chunk.byteLength);
    if (!socket.write(Buffer.concat([length, chunk]))) await once(socket, "drain");
  }
  const end = Buffer.alloc(4);
  socket.end(end);
  const response = await finished;
  const parsed = parseClamavResponse(response);
  const engineVersion = await command("VERSION");
  return { ...parsed, response, engineVersion };
}
