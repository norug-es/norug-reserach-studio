import { createHash } from "node:crypto";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export type ExtractedContent = {
  text: string;
  textSha256: string;
  characterCount: number;
  wordCount: number;
  pageCount: number | null;
  extractor: string;
  extractorVersion: string;
  warnings: string[];
  chunks: Array<{ index: number; content: string; sha256: string; tokenEstimate: number }>;
};

function normalizeText(value: string) {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function maxCharacters() {
  const value = Number(process.env.EXTRACTED_TEXT_MAX_CHARS ?? 10_000_000);
  return Number.isFinite(value) && value > 0 ? value : 10_000_000;
}

export function chunkExtractedText(text: string, target = 1_600, overlap = 200) {
  if (!text) return [];
  const chunks: Array<{ index: number; content: string; sha256: string; tokenEstimate: number }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + target);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(" ", end));
      if (boundary > cursor + Math.floor(target * 0.65)) end = boundary;
    }
    const content = text.slice(cursor, end).trim();
    if (content) chunks.push({
      index: chunks.length,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
      tokenEstimate: Math.max(1, Math.ceil(content.length / 4)),
    });
    if (end >= text.length) break;
    cursor = Math.max(cursor + 1, end - overlap);
  }
  return chunks;
}

export async function extractDocument(bytes: Uint8Array, fileName: string): Promise<ExtractedContent> {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  let rawText = "";
  let pageCount: number | null = null;
  let extractor = "utf8";
  let extractorVersion = "node-textdecoder-v1";
  const warnings: string[] = [];

  if (["txt", "md", "csv"].includes(extension)) {
    rawText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } else if (extension === "docx") {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    rawText = result.value;
    warnings.push(...result.messages.map((message) => `${message.type}: ${message.message}`));
    extractor = "mammoth";
    extractorVersion = "1.12.1";
  } else if (extension === "pdf") {
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      rawText = result.text;
      pageCount = result.total;
    } finally {
      await parser.destroy();
    }
    extractor = "pdf-parse";
    extractorVersion = "2.4.5";
  } else {
    throw new Error(`No existe extractor de texto para .${extension || "desconocido"}`);
  }

  const text = normalizeText(rawText);
  if (text.length > maxCharacters()) throw new Error("El texto extraído supera el límite operativo configurado");
  if (!text) warnings.push("No se detectó texto; el documento puede requerir OCR");
  const words = text ? text.split(/\s+/u).filter(Boolean).length : 0;
  return {
    text,
    textSha256: createHash("sha256").update(text).digest("hex"),
    characterCount: text.length,
    wordCount: words,
    pageCount,
    extractor,
    extractorVersion,
    warnings,
    chunks: chunkExtractedText(text),
  };
}
