import {
  WIDGET_BASE,
  RESOURCE_BASE,
  assetsFromPin,
  assetsFromWidgetPin,
  buildExportBookmarklet,
  fetchImageBlob,
  guessExtension,
  parsePinterestSource,
  sanitizeFileName,
} from "./core.js";

const form = document.getElementById("source-form");
const sourceInput = document.getElementById("source-url");
const startBtn = document.getElementById("start-btn");
const statusCard = document.getElementById("status-card");
const targetLabel = document.getElementById("target-label");
const stagePill = document.getElementById("stage-pill");
const progressBar = document.getElementById("progress-bar");
const progressCaption = document.getElementById("progress-caption");
const statusNote = document.getElementById("status-note");
const actions = document.getElementById("actions");
const zipBtn = document.getElementById("zip-btn");
const copyBtn = document.getElementById("copy-btn");
const resetBtn = document.getElementById("reset-btn");
const results = document.getElementById("results");
const resultsSummary = document.getElementById("results-summary");
const pinGrid = document.getElementById("pin-grid");
const importJson = document.getElementById("import-json");
const bookmarkletLink = document.getElementById("bookmarklet-link");

/** @type {import("./core.js").DownloadAsset[] | null} */
let currentAssets = null;
/** @type {import("./core.js").PinterestTarget | null} */
let currentTarget = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runScan(sourceInput.value.trim());
});

zipBtn.addEventListener("click", () => downloadZip());
copyBtn.addEventListener("click", () => copyUrls());
resetBtn.addEventListener("click", () => resetUi());
importJson.addEventListener("change", (event) => importPinExport(event));
bookmarkletLink.href = buildExportBookmarklet();
bookmarkletLink.title = "Run while viewing a Pinterest board tab";

function resetUi() {
  currentAssets = null;
  currentTarget = null;
  statusCard.hidden = true;
  actions.hidden = true;
  results.hidden = true;
  pinGrid.replaceChildren();
  zipBtn.disabled = true;
  copyBtn.disabled = true;
  progressBar.value = 0;
  progressCaption.textContent = "Waiting…";
  statusNote.textContent = "";
  stagePill.textContent = "Idle";
  startBtn.disabled = false;
}

function setStage(text) {
  stagePill.textContent = text;
}

function setProgress(value, caption) {
  progressBar.value = Math.max(0, Math.min(100, value));
  progressCaption.textContent = caption;
}

/**
 * @param {string} username
 * @param {string} slug
 */
async function fetchWidgetBoard(username, slug) {
  const endpoint = `${WIDGET_BASE}/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/pins/`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Pinterest widget API returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  if (payload.status !== "success") {
    throw new Error(payload.message || "Pinterest could not return board pins.");
  }
  return payload.data;
}

/**
 * @param {string} boardId
 * @param {string} sourcePath
 * @param {string[] | null | undefined} bookmarks
 */
async function fetchBoardFeedPage(boardId, sourcePath, bookmarks) {
  const options = {
    board_id: boardId,
    board_url: sourcePath,
    field_set_key: "react_grid_pin",
    filter_section_pins: false,
    page_size: 50,
    redux_normalize_feed: true,
  };
  if (bookmarks?.length) {
    options.bookmarks = bookmarks;
  }

  const params = new URLSearchParams({
    source_url: sourcePath,
    data: JSON.stringify({ options, context: {} }),
  });
  const url = `${RESOURCE_BASE}/BoardFeedResource/get/?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "X-Pinterest-AppState": "active",
    },
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Board feed request failed (${response.status}). ${detail.slice(0, 120)}`,
    );
  }

  return response.json();
}

/**
 * @param {string} boardId
 * @param {string} sourcePath
 * @param {number | null} expectedCount
 */
async function paginateBoardFeed(boardId, sourcePath, expectedCount) {
  /** @type {any[]} */
  const pins = [];
  const seen = new Set();
  /** @type {string[] | null} */
  let bookmarks = null;

  for (let page = 0; page < 40; page += 1) {
    const payload = await fetchBoardFeedPage(boardId, sourcePath, bookmarks);
    const batch = payload?.resource_response?.data;
    if (!Array.isArray(batch) || !batch.length) {
      break;
    }

    let added = 0;
    for (const pin of batch) {
      const key = String(pin.id ?? pin.node_id ?? "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      pins.push(pin);
      added += 1;
    }

    const next = payload?.resource?.options?.bookmarks;
    const nextBookmark = Array.isArray(next) ? next[0] : null;
    setProgress(
      expectedCount
        ? Math.min(95, Math.round((pins.length / expectedCount) * 90))
        : Math.min(95, 20 + page * 12),
      `Loaded ${pins.length}${expectedCount ? ` / ${expectedCount}` : ""} pins…`,
    );

    if (
      !nextBookmark ||
      nextBookmark === "-end-" ||
      nextBookmark.startsWith("Y2JOb25lO") ||
      added === 0
    ) {
      break;
    }
    bookmarks = next;
  }

  return pins;
}

/**
 * @param {Event} event
 */
async function importPinExport(event) {
  const input = /** @type {HTMLInputElement} */ (event.target);
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  resetUi();
  startBtn.disabled = true;
  statusCard.hidden = false;
  actions.hidden = false;
  results.hidden = false;
  setStage("Importing");
  setProgress(10, "Reading export file…");

  try {
    const payload = JSON.parse(await file.text());
    const pins = Array.isArray(payload.pins) ? payload.pins : [];
    if (!pins.length) {
      throw new Error("That JSON does not contain a pins array.");
    }

    const username = payload.username || "unknown";
    const slug = payload.slug || "board";
    const label =
      slug === "_quick_saves"
        ? "Unorganized Ideas"
        : (payload.boardName || slug.replace(/-/g, " ")).replace(/^\w/, (c) => c.toUpperCase());

    const target = {
      username,
      slug,
      label,
      sourcePath: payload.sourcePath || `/${username}/${slug}/`,
    };
    currentTarget = target;
    targetLabel.textContent = `${target.label} · @${target.username}`;
    await finalizePins(pins, target, payload.pinCount ?? pins.length, true, true);
  } catch (error) {
    setStage("Error");
    setProgress(0, "Import failed.");
    statusNote.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    startBtn.disabled = false;
  }
}

/**
 * @param {any[]} pins
 * @param {import("./core.js").PinterestTarget} target
 * @param {number} pinCount
 * @param {boolean} usedFeed
 * @param {boolean} fromImport
 */
async function finalizePins(pins, target, pinCount, usedFeed, fromImport = false) {
  setStage("Building");
  setProgress(70, "Selecting highest-quality image URLs…");

  currentAssets = pins.flatMap((pin) =>
    usedFeed ? assetsFromPin(pin) : assetsFromWidgetPin(pin),
  );

  if (!currentAssets.length) {
    throw new Error("Pins were found, but no downloadable images could be resolved.");
  }

  renderResults(currentAssets, pinCount, pins.length, usedFeed);
  setStage("Ready");
  setProgress(100, `Prepared ${currentAssets.length} files for download.`);
  zipBtn.disabled = false;
  copyBtn.disabled = false;

  if (fromImport) {
    statusNote.textContent = `Imported ${pins.length} pins from Pinterest export.`;
    return;
  }

  if (!usedFeed && pinCount > pins.length) {
    statusNote.textContent = `Pinterest only exposed ${pins.length} of ${pinCount} pins here. Use the export bookmarklet on the board page, then import the JSON above.`;
  } else if (usedFeed && pinCount && pins.length < pinCount) {
    statusNote.textContent = `Loaded ${pins.length} of ${pinCount} public pins.`;
  }
}

/**
 * @param {string} raw
 */
async function runScan(raw) {
  resetUi();
  startBtn.disabled = true;
  statusCard.hidden = false;
  actions.hidden = false;
  results.hidden = false;

  try {
    const target = parsePinterestSource(raw);
    currentTarget = target;
    targetLabel.textContent = `${target.label} · @${target.username}`;
    setStage("Scanning");
    setProgress(6, "Resolving board…");
    statusNote.textContent = "";

    const widget = await fetchWidgetBoard(target.username, target.slug);
    const board = widget.board;
    const pinCount = board?.pin_count ?? widget.pins?.length ?? 0;

    /** @type {any[]} */
    let pins = [];
    let usedFeed = false;

    if (board?.id) {
      setProgress(12, "Trying full-resolution board feed…");
      try {
        pins = await paginateBoardFeed(board.id, target.sourcePath, pinCount);
        usedFeed = pins.length > 0;
      } catch (error) {
        console.warn("Board feed unavailable in browser context:", error);
        statusNote.textContent =
          "Pinterest blocked the full feed from this site, so the tool is using the public widget API for the first page of pins.";
      }
    }

    if (!pins.length) {
      pins = widget.pins ?? [];
    }

    if (!pins.length) {
      throw new Error("No public pins were found for that board or profile section.");
    }

    await finalizePins(pins, target, pinCount, usedFeed);
  } catch (error) {
    setStage("Error");
    setProgress(0, "Scan failed.");
    statusNote.textContent = error instanceof Error ? error.message : String(error);
    resultsSummary.textContent = "";
    pinGrid.replaceChildren();
  } finally {
    startBtn.disabled = false;
  }
}

/**
 * @param {import("./core.js").DownloadAsset[]} assets
 * @param {number} pinCount
 * @param {number} loadedPins
 * @param {boolean} usedFeed
 */
function renderResults(assets, pinCount, loadedPins, usedFeed) {
  resultsSummary.textContent = `${assets.length} image file${assets.length === 1 ? "" : "s"} from ${loadedPins} pin${loadedPins === 1 ? "" : "s"}${pinCount ? ` (${pinCount} on Pinterest)` : ""}${usedFeed ? ", using originals when available" : ", upgraded to /originals/ URLs"}.`;
  pinGrid.replaceChildren();

  for (const asset of assets) {
    const card = document.createElement("article");
    card.className = "pin-card";
    card.setAttribute("role", "listitem");

    const image = document.createElement("img");
    image.className = "pin-thumb";
    image.alt = asset.title || "Pinterest pin preview";
    image.loading = "lazy";
    image.decoding = "async";
    if (asset.width && asset.height) {
      image.width = asset.width;
      image.height = asset.height;
    }
    image.src = asset.previewUrl;

    const meta = document.createElement("div");
    meta.className = "pin-meta";

    const heading = document.createElement("p");
    heading.className = "pin-title";
    heading.textContent = asset.title || "Untitled pin";

    const details = document.createElement("p");
    details.className = "pin-details";
    details.textContent = `${asset.fileName}${asset.width ? ` · ${asset.width}×${asset.height}` : ""}`;

    meta.append(heading, details);
    card.append(image, meta);
    pinGrid.append(card);
  }
}

async function downloadZip() {
  if (!currentAssets?.length) return;
  if (!window.JSZip) {
    statusNote.textContent = "JSZip failed to load. Refresh and try again.";
    return;
  }

  const zip = new window.JSZip();
  const folderName = sanitizeFileName(
    currentTarget ? `${currentTarget.username}-${currentTarget.slug}` : "pinterest-images",
  );
  const folder = zip.folder(folderName);
  if (!folder) return;

  setStage("Zipping");
  zipBtn.disabled = true;
  let completed = 0;
  let saved = 0;
  let proxied = 0;
  let failed = 0;

  for (const asset of currentAssets) {
    try {
      const { blob, proxied: usedProxy } = await fetchImageBlob(asset.downloadUrl);
      const ext = guessExtension(blob.type, asset.downloadUrl, usedProxy);
      const fileName = asset.fileName.replace(/\.[^.]+$/, "") + ext;
      const bytes = await blob.arrayBuffer();
      folder.file(fileName, bytes);
      saved += 1;
      if (usedProxy) proxied += 1;
    } catch (error) {
      failed += 1;
      console.warn("Failed to fetch", asset.downloadUrl, error);
    }
    completed += 1;
    setProgress(
      Math.round((completed / currentAssets.length) * 100),
      `Packaging ${completed} / ${currentAssets.length} files…`,
    );
  }

  if (!saved) {
    setStage("Error");
    zipBtn.disabled = false;
    statusNote.textContent = "Could not download any images. Try again or copy URLs instead.";
    return;
  }

  const archive = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  if (!archive.size) {
    setStage("Error");
    zipBtn.disabled = false;
    statusNote.textContent = "Zip archive was empty. Try again or copy URLs instead.";
    return;
  }

  const url = URL.createObjectURL(archive);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${folderName}.zip`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);

  setStage("Ready");
  zipBtn.disabled = false;
  setProgress(100, `Zip ready — ${archive.size.toLocaleString()} bytes, ${saved} files.`);
  statusNote.textContent =
    `Downloaded ${archive.size.toLocaleString()}-byte zip with ${saved} image` +
    `${saved === 1 ? "" : "s"}` +
    (proxied ? ` (${proxied} via image proxy)` : "") +
    (failed ? `; ${failed} skipped.` : ".");
}

async function copyUrls() {
  if (!currentAssets?.length) return;
  const text = currentAssets.map((asset) => asset.downloadUrl).join("\n");
  await navigator.clipboard.writeText(text);
  statusNote.textContent = "Copied image URLs to the clipboard.";
}