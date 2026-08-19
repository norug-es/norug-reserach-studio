import assert from "node:assert/strict";
import test from "node:test";
import { subtitleFileName, toSrt, toVtt } from "../lib/subtitles.ts";

const segments = [
  { index: 0, startMs: 1_234, endMs: 65_678, text: "Primera línea" },
  { index: 1, startMs: 3_661_001, endMs: 3_662_345, text: "Segunda línea" },
];

test("genera SRT numerado con timestamps milimétricos", () => {
  const output = toSrt(segments);
  assert.match(output, /1\n00:00:01,234 --> 00:01:05,678\nPrimera línea/);
  assert.match(output, /2\n01:01:01,001 --> 01:01:02,345\nSegunda línea/);
});

test("genera WebVTT válido", () => {
  const output = toVtt(segments);
  assert.ok(output.startsWith("WEBVTT\n\n"));
  assert.match(output, /00:00:01\.234 --> 00:01:05\.678/);
});

test("normaliza el nombre descargable sin caracteres de ruta", () => {
  assert.equal(subtitleFileName("entrevista:final?.mp4", "srt"), "entrevista-final-.srt");
});
