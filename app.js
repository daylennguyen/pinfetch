const WIDGET_BASE = "https://widgets.pinterest.com/v3/pidgets/boards";
const RESOURCE_BASE = "https://www.pinterest.com/resource";

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

/** @type {DownloadAsset[] | null} */
let currentAssets = null;
/** @type {{ username: string, slug: string, label: string } | null} */
let currentTarget = null;

/**
 * @typedef {Object} DownloadAsset
 * @property {string} pinId
 * @property {string} title
 * @property {string} previewUrl
 * @property {string} downloadUrl
 * @property {number} width
 * @property {number} height
 * @property {string} fileName
 */

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
 * @param {string} input
 * @returns {{ username: string, slug: string, label: string, sourcePath: string }}
 */
function parsePinterestSource(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid Pinterest URL.");
  }

  if (!/\.pinterest\./i.test(url.hostname)) {
    throw new Error("Only Pinterest profile and board URLs are supported.");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (!segments.length) {
    throw new Error("Could not read a username from that URL.");
  }

  const username = decodeURIComponent(segments[0]);
  const reserved = new Set([
    "pin",
    "search",
    "ideas",
    "today",
    "shopping",
    "videos",
    "login",
    "business",
  ]);
  if (reserved.has(username)) {
    throw new Error("That URL points at a Pinterest feature page, not a profile or board.");
  }

  const looksLikeBoard =
    segments.length >= 2 &&
    !["_saved", "_created", "pins", "boards"].includes(segments[1].toLowerCase());

  if (looksLikeBoard) {
    const slug = decodeURIComponent(segments[1]);
    const label = slug.replace(/-/g, " ");
    return {
      username,
      slug,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      sourcePath: `/${username}/${slug}/`,
    };
  }

  return {
    username,
    slug: "_quick_saves",
    label: "Unorganized Ideas",
    sourcePath: `/${username}/_quick_saves/`,
  };
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
 * @param {unknown} value
 */
function pickBestPreviewUrl(value) {
  if (!value || typeof value !== "object") return "";
  const images = /** @type {Record<string, { url?: string, width?: number }>} */ (value);
  const preferred = ["564x", "474x", "236x", "736x", "170x"];
  for (const key of preferred) {
    if (images[key]?.url) return images[key].url;
  }
  const first = Object.values(images).find((entry) => entry?.url);
  return first?.url ?? "";
}

/**
 * @param {string} url
 */
function toOriginalUrl(url) {
  if (!url) return url;
  return url.replace(/\/(\d+x|\d+x\d+|60x60_RS|75x75_RS)\//, "/originals/");
}

/**
 * @param {string | undefined} url
 * @param {string | undefined} signature
 * @param {string[]} extraFallbacks
 */
function buildOriginalCandidates(url, signature, extraFallbacks = []) {
  /** @type {string[]} */
  const candidates = [];
  const add = (value) => {
    if (!value || candidates.includes(value)) return;
    candidates.push(value);
  };

  if (url) {
    add(url);
    add(toOriginalUrl(url));
  }

  if (signature && /^[0-9a-f]{16,}$/i.test(signature)) {
    const base = `https://i.pinimg.com/originals/${signature.slice(0, 2)}/${signature.slice(2, 4)}/${signature.slice(4, 6)}/${signature}`;
    for (const ext of ["jpg", "png", "webp"]) {
      add(`${base}.${ext}`);
    }
  }

  for (const extra of extraFallbacks) add(extra);
  return candidates;
}

/**
 * @param {any} pin
 * @returns {DownloadAsset[]}
 */
function assetsFromPin(pin) {
  /** @type {DownloadAsset[]} */
  const assets = [];
  const pinId = String(pin.id ?? pin.node_id ?? "pin");
  const title = (pin.title || pin.grid_title || pin.description || "Untitled pin")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  const pushAsset = (url, signature, suffix, width, height) => {
    const candidates = buildOriginalCandidates(url, signature);
    if (!candidates.length) return;
    const fileBase = `${pinId}${suffix}`;
    assets.push({
      pinId,
      title,
      previewUrl: candidates.find((item) => item.includes("/236x/") || item.includes("/564x/")) || candidates[0],
      downloadUrl: candidates[0],
      width: width || 0,
      height: height || 0,
      fileName: `${sanitizeFileName(fileBase)}.jpg`,
    });
  };

  if (pin.images?.orig?.url) {
    pushAsset(
      pin.images.orig.url,
      extractSignature(pin.images.orig.url),
      "",
      pin.images.orig.width,
      pin.images.orig.height,
    );
  } else {
    const fallback = pickBestPreviewUrl(pin.images);
    pushAsset(fallback, extractSignature(fallback), "", 0, 0);
  }

  const story = pin.story_pin_data;
  const pages = Array.isArray(story?.pages) ? story.pages : [];
  pages.forEach((page, pageIndex) => {
  const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    blocks.forEach((block, blockIndex) => {
      const image = block?.image;
      const originals = image?.images?.originals ?? image?.images?.orig;
      const signature = block?.image_signature || image?.image_signature;
      const fallbackUrl =
        originals?.url || pickBestPreviewUrl(image?.images) || pickBestPreviewUrl(block?.images);
      pushAsset(
        fallbackUrl,
        signature || extractSignature(fallbackUrl),
        `_story_${pageIndex + 1}_${blockIndex + 1}`,
        originals?.width,
        originals?.height,
      );
    });
  });

  const carousel = pin.carousel_data?.carousel_slots;
  if (Array.isArray(carousel)) {
    carousel.forEach((slot, index) => {
      const slotImages = slot?.images ?? {};
      const best = slotImages.orig ?? slotImages["736x"] ?? slotImages["564x"];
      pushAsset(best?.url, slot?.id, `_carousel_${index + 1}`, best?.width, best?.height);
    });
  }

  return assets.filter(
    (asset, index, list) =>
      list.findIndex((entry) => entry.downloadUrl === asset.downloadUrl) === index,
  );
}

/**
 * @param {any} pin
 */
function assetsFromWidgetPin(pin) {
  const adapted = { ...pin };
  const primary = pickBestPreviewUrl(pin.images);
  adapted.images = {
    ...(pin.images || {}),
    orig: { url: toOriginalUrl(primary), width: 0, height: 0 },
  };
  return assetsFromPin(adapted);
}

/**
 * @param {string} url
 */
function extractSignature(url) {
  const match = url?.match(/\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{16,})\./i);
  if (!match) return "";
  return match[4];
}

/**
 * @param {string} value
 */
function sanitizeFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_");
}

function buildExportBookmarklet() {
  const source = String.raw`(async()=>{const match=location.pathname.match(/^\/([^/]+)\/([^/]+)\/?/);if(!match){alert("Open a Pinterest board first. For Unorganized Ideas, use /USERNAME/_quick_saves/");return;}const username=decodeURIComponent(match[1]);const slug=decodeURIComponent(match[2]);const sourcePath="/"+username+"/"+slug+"/";const boardResponse=await fetch("/resource/BoardResource/get/?source_url="+encodeURIComponent(sourcePath)+"&data="+encodeURIComponent(JSON.stringify({options:{username,slug,field_set_key:"detailed"},context:{}})),{headers:{"X-Requested-With":"XMLHttpRequest",Accept:"application/json"}});const boardPayload=await boardResponse.json();const boardId=boardPayload.resource_response?.data?.id;if(!boardId){alert("Could not resolve that board.");return;}const pins=[];const seen=new Set();let bookmarks=null;for(let page=0;page<80;page+=1){const options={board_id:boardId,board_url:sourcePath,field_set_key:"react_grid_pin",page_size:50,redux_normalize_feed:true};if(bookmarks){options.bookmarks=bookmarks;}const feedResponse=await fetch("/resource/BoardFeedResource/get/?source_url="+encodeURIComponent(sourcePath)+"&data="+encodeURIComponent(JSON.stringify({options,context:{}})),{headers:{"X-Requested-With":"XMLHttpRequest",Accept:"application/json"}});const feedPayload=await feedResponse.json();const batch=feedPayload.resource_response?.data||[];let added=0;for(const pin of batch){const pinId=String(pin.id||"");if(!pinId||seen.has(pinId)){continue;}seen.add(pinId);pins.push(pin);added+=1;}const next=feedPayload.resource?.options?.bookmarks?.[0];if(!next||next==="-end-"||next.startsWith("Y2JOb25lO")||added===0){break;}bookmarks=[next];}const exportData={username,slug,sourcePath,boardName:boardPayload.resource_response?.data?.name,pinCount:boardPayload.resource_response?.data?.pin_count,pins,exportedAt:new Date().toISOString()};const blob=new Blob([JSON.stringify(exportData)],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=username+"-"+slug+"-pinfetch.json";link.click();alert("Exported "+pins.length+" pins for Pinfetch.");})();`;
  return `javascript:${encodeURIComponent(source)}`;
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
 * @param {{ username: string, slug: string, label: string, sourcePath: string }} target
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
 * @param {DownloadAsset[]} assets
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
    image.alt = asset.title;
    image.loading = "lazy";
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

  for (const asset of currentAssets) {
    try {
      const blob = await fetchBinary(asset.downloadUrl);
      const ext = guessExtension(blob.type, asset.downloadUrl);
      const fileName = asset.fileName.replace(/\.[^.]+$/, "") + ext;
      folder.file(fileName, blob);
    } catch (error) {
      console.warn("Failed to fetch", asset.downloadUrl, error);
    }
    completed += 1;
    setProgress(
      Math.round((completed / currentAssets.length) * 100),
      `Downloaded ${completed} / ${currentAssets.length} files…`,
    );
  }

  const archive = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(archive);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${folderName}.zip`;
  link.click();
  URL.revokeObjectURL(url);

  setStage("Ready");
  zipBtn.disabled = false;
  setProgress(100, "Zip download started.");
}

/**
 * @param {string} url
 */
async function fetchBinary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.blob();
}

/**
 * @param {string} mime
 * @param {string} url
 */
function guessExtension(mime, url) {
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return match ? `.${match[1].toLowerCase()}` : ".jpg";
}

async function copyUrls() {
  if (!currentAssets?.length) return;
  const text = currentAssets.map((asset) => asset.downloadUrl).join("\n");
  await navigator.clipboard.writeText(text);
  statusNote.textContent = "Copied image URLs to the clipboard.";
}