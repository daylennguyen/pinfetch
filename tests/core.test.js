import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assetsFromWidgetPin,
  buildExportBookmarklet,
  buildOriginalCandidates,
  buildProxyUrl,
  fetchImageBlob,
  guessExtension,
  isValidImageBlob,
  parsePinterestSource,
  shouldProxyFirst,
  toOriginalUrl,
} from "../core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const widgetPin = JSON.parse(readFileSync(join(__dirname, "fixtures", "widget-pin.json"), "utf8"));

test("parsePinterestSource maps profile root to Unorganized Ideas", () => {
  const target = parsePinterestSource("https://www.pinterest.com/nationalgeographic/");
  assert.equal(target.username, "nationalgeographic");
  assert.equal(target.slug, "_quick_saves");
  assert.equal(target.label, "Unorganized Ideas");
});

test("parsePinterestSource maps board subdirectory", () => {
  const target = parsePinterestSource("https://www.pinterest.com/nationalgeographic/animals/");
  assert.equal(target.slug, "animals");
  assert.equal(target.sourcePath, "/nationalgeographic/animals/");
});

test("toOriginalUrl upgrades Pinterest CDN sizes", () => {
  const input = "https://i.pinimg.com/564x/b0/28/cb/file.jpg";
  assert.equal(
    toOriginalUrl(input),
    "https://i.pinimg.com/originals/b0/28/cb/file.jpg",
  );
});

test("buildOriginalCandidates adds signature-based originals", () => {
  const candidates = buildOriginalCandidates(
    "https://i.pinimg.com/564x/b0/28/cb/b028cbe3e430a57695749c518f8a7e95.jpg",
    "b028cbe3e430a57695749c518f8a7e95",
  );
  assert.ok(candidates.some((url) => url.includes("/originals/")));
  assert.ok(candidates.some((url) => url.endsWith(".png")));
});

test("assetsFromWidgetPin builds a originals download URL", () => {
  const assets = assetsFromWidgetPin(widgetPin);
  assert.equal(assets.length, 1);
  assert.match(assets[0].downloadUrl, /\/originals\//);
  assert.equal(assets[0].pinId, "309763280603783034");
});

test("buildProxyUrl is CORS-friendly and preserves host path", () => {
  const proxied = buildProxyUrl(
    "https://i.pinimg.com/originals/b0/28/cb/b028cbe3e430a57695749c518f8a7e95.jpg",
  );
  assert.match(proxied, /^https:\/\/images\.weserv\.nl\/\?url=/);
  assert.match(proxied, /output=jpg/);
});

test("guessExtension prefers URL extension when proxied", () => {
  assert.equal(
    guessExtension("image/jpeg", "https://i.pinimg.com/originals/file.png", true),
    ".png",
  );
});

test("buildExportBookmarklet returns a javascript: URL", () => {
  const href = buildExportBookmarklet();
  assert.match(href, /^javascript:/);
  assert.ok(href.length > 200);
});

test("shouldProxyFirst is true for pinimg CDN URLs", () => {
  assert.equal(
    shouldProxyFirst("https://i.pinimg.com/originals/b0/28/cb/file.jpg"),
    true,
  );
});

test("fetchImageBlob prefers proxy for pinimg URLs", async () => {
  const directUrl =
    "https://i.pinimg.com/originals/b0/28/cb/b028cbe3e430a57695749c518f8a7e95.jpg";
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("images.weserv.nl")) {
      return globalThis.fetch(url);
    }
    throw new TypeError("Failed to fetch");
  };

  const result = await fetchImageBlob(directUrl, fetchImpl);
  assert.equal(result.proxied, true);
  assert.match(calls[0], /images\.weserv\.nl/);
});

test("fetchImageBlob falls back to proxy when direct fetch is blocked", async () => {
  const directUrl =
    "https://i.pinimg.com/originals/b0/28/cb/b028cbe3e430a57695749c518f8a7e95.jpg";
  const fetchImpl = async (url) => {
    if (url === directUrl) {
      throw new TypeError("Failed to fetch");
    }
    return globalThis.fetch(url);
  };

  const result = await fetchImageBlob(directUrl, fetchImpl);
  assert.equal(result.proxied, true);
  assert.ok(result.blob.size > 1000);
  assert.match(result.fetchedUrl, /images\.weserv\.nl/);
});