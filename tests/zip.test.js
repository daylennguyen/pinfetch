import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import JSZip from "jszip";

import { buildProxyUrl, fetchImageBlob, isValidImageBlob } from "../core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("zip entries contain non-zero image bytes", async () => {
  const directUrl =
    "https://i.pinimg.com/originals/b0/28/cb/b028cbe3e430a57695749c518f8a7e95.jpg";
  const fetchImpl = async (url) => {
    if (url === directUrl) {
      throw new TypeError("Failed to fetch");
    }
    return globalThis.fetch(url);
  };

  const { blob } = await fetchImageBlob(directUrl, fetchImpl);
  assert.equal(await isValidImageBlob(blob), true);

  const bytes = await blob.arrayBuffer();
  const zip = new JSZip();
  zip.file("sample.jpg", bytes);
  const archive = await zip.generateAsync({ type: "nodebuffer" });
  assert.ok(archive.length > bytes.byteLength);

  const extracted = await JSZip.loadAsync(archive);
  const entry = extracted.file("sample.jpg");
  assert.ok(entry);
  const entryBytes = await entry.async("nodebuffer");
  assert.ok(entryBytes.length > 1000);
  assert.equal(entryBytes[0], 0xff);
  assert.equal(entryBytes[1], 0xd8);
});

test("proxy URL resolves for fixture asset", () => {
  const proxied = buildProxyUrl(
    "https://i.pinimg.com/originals/b0/28/cb/b028cbe3e430a57695749c518f8a7e95.jpg",
  );
  assert.match(proxied, /images\.weserv\.nl/);
  const fixture = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "widget-pin.json"), "utf8"),
  );
  const thumb = fixture.images["564x"].url;
  assert.match(buildProxyUrl(thumb), /output=jpg/);
});