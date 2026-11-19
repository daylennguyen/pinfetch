export const WIDGET_BASE = "https://widgets.pinterest.com/v3/pidgets/boards";
export const RESOURCE_BASE = "https://www.pinterest.com/resource";
export const IMAGE_PROXY_HOST = "images.weserv.nl";

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

/**
 * @typedef {Object} PinterestTarget
 * @property {string} username
 * @property {string} slug
 * @property {string} label
 * @property {string} sourcePath
 */

/**
 * @param {string} input
 * @returns {PinterestTarget}
 */
export function parsePinterestSource(input) {
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
 * @param {string} url
 */
export function toOriginalUrl(url) {
  if (!url) return url;
  return url.replace(/\/(\d+x|\d+x\d+|60x60_RS|75x75_RS)\//, "/originals/");
}

/**
 * @param {string} url
 */
export function extractSignature(url) {
  const match = url?.match(/\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{16,})\./i);
  if (!match) return "";
  return match[4];
}

/**
 * @param {string} value
 */
export function sanitizeFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_");
}

/**
 * @param {unknown} value
 */
export function pickBestPreviewUrl(value) {
  if (!value || typeof value !== "object") return "";
  const images = /** @type {Record<string, { url?: string }>} */ (value);
  const preferred = ["564x", "474x", "236x", "736x", "170x"];
  for (const key of preferred) {
    if (images[key]?.url) return images[key].url;
  }
  const first = Object.values(images).find((entry) => entry?.url);
  return first?.url ?? "";
}

/**
 * @param {string | undefined} url
 * @param {string | undefined} signature
 * @param {string[]} extraFallbacks
 */
export function buildOriginalCandidates(url, signature, extraFallbacks = []) {
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
 * @param {string} url
 */
export function buildProxyUrl(url) {
  const path = url.replace(/^https?:\/\//i, "");
  const ext = url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1]?.toLowerCase() ?? "jpg";
  const output = ["png", "webp", "gif", "jpg", "jpeg"].includes(ext) ? ext : "jpg";
  return `https://${IMAGE_PROXY_HOST}/?url=${encodeURIComponent(path)}&output=${output}&n=-1`;
}

/**
 * @param {string} url
 */
export function shouldProxyFirst(url) {
  try {
    return /\.pinimg\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * @param {Blob} blob
 */
export async function isValidImageBlob(blob) {
  if (!blob?.size || blob.size < 128) {
    return false;
  }
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (header[0] === 0xff && header[1] === 0xd8) return true;
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
    return true;
  }
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) {
    return true;
  }
  if (
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return true;
  }
  return false;
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 */
async function tryFetchBlob(fetchImpl, url) {
  const response = await fetchImpl(url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    mode: "cors",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  if (!(await isValidImageBlob(blob))) {
    throw new Error("response is not a valid image");
  }
  return blob;
}

/**
 * Fetch a Pinterest CDN image in browser contexts (GitHub Pages) where direct
 * `i.pinimg.com` requests are blocked by CORS.
 *
 * @param {string} downloadUrl
 * @param {typeof fetch} [fetchImpl]
 */
export async function fetchImageBlob(downloadUrl, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }

  const proxyUrl = buildProxyUrl(downloadUrl);
  const attempts =
    shouldProxyFirst(downloadUrl) && proxyUrl !== downloadUrl
      ? [proxyUrl, downloadUrl]
      : [downloadUrl, proxyUrl].filter((value, index, list) => value && list.indexOf(value) === index);

  let lastError;
  for (const url of attempts) {
    try {
      const blob = await tryFetchBlob(fetchImpl, url);
      return {
        blob,
        proxied: url !== downloadUrl,
        fetchedUrl: url,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * @param {string} mime
 * @param {string} url
 * @param {boolean} proxied
 */
export function guessExtension(mime, url, proxied = false) {
  const fromUrl = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  if (proxied && fromUrl) {
    return `.${fromUrl[1].toLowerCase()}`;
  }
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  return fromUrl ? `.${fromUrl[1].toLowerCase()}` : ".jpg";
}

/**
 * @param {any} pin
 * @returns {DownloadAsset[]}
 */
export function assetsFromPin(pin) {
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
    const downloadUrl = candidates[0];
    const fileExt = downloadUrl.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? "jpg";
    const fileBase = `${pinId}${suffix}`;
    assets.push({
      pinId,
      title,
      previewUrl:
        candidates.find((item) => item.includes("/236x/") || item.includes("/564x/")) ||
        downloadUrl,
      downloadUrl,
      width: width || 0,
      height: height || 0,
      fileName: `${sanitizeFileName(fileBase)}.${fileExt}`,
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
export function assetsFromWidgetPin(pin) {
  const adapted = { ...pin };
  const primary = pickBestPreviewUrl(pin.images);
  adapted.images = {
    ...(pin.images || {}),
    orig: { url: toOriginalUrl(primary), width: 0, height: 0 },
  };
  return assetsFromPin(adapted);
}

export function buildExportBookmarklet() {
  const source = String.raw`(async()=>{const match=location.pathname.match(/^\/([^/]+)\/([^/]+)\/?/);if(!match){alert("Open a Pinterest board first. Example: /itmedaylen/arcane/ or /USERNAME/_quick_saves/");return;}if(!location.hostname.includes("pinterest")){alert("Run this bookmarklet on a pinterest.com board tab.");return;}const username=decodeURIComponent(match[1]);const slug=decodeURIComponent(match[2]);const sourcePath="/"+username+"/"+slug+"/";const headers={"X-Requested-With":"XMLHttpRequest",Accept:"application/json, text/javascript, */*; q=0.01","X-Pinterest-AppState":"active","X-Pinterest-PWS-Handler":"www/[username]/[slug].js"};const boardResponse=await fetch("/resource/BoardResource/get/?source_url="+encodeURIComponent(sourcePath)+"&data="+encodeURIComponent(JSON.stringify({options:{username,slug,field_set_key:"detailed"},context:{}})),{headers,credentials:"same-origin"});const boardText=await boardResponse.text();let boardPayload;try{boardPayload=JSON.parse(boardText);}catch(error){alert(boardResponse.ok?"Could not read board JSON.":"Pinterest blocked the board request ("+boardResponse.status+"). Refresh this board page while logged in, then try again.");return;}const boardId=boardPayload.resource_response?.data?.id;if(!boardId){alert(boardPayload.resource_response?.message||"Could not resolve that board.");return;}const pins=[];const seen=new Set();let bookmarks=null;for(let page=0;page<80;page+=1){const options={board_id:boardId,board_url:sourcePath,field_set_key:"react_grid_pin",page_size:50,redux_normalize_feed:true,filter_section_pins:false};if(bookmarks){options.bookmarks=bookmarks;}const feedResponse=await fetch("/resource/BoardFeedResource/get/?source_url="+encodeURIComponent(sourcePath)+"&data="+encodeURIComponent(JSON.stringify({options,context:{}})),{headers,credentials:"same-origin"});let feedPayload;try{feedPayload=await feedResponse.json();}catch(error){alert("Pinterest blocked the pin feed ("+feedResponse.status+").");return;}const batch=feedPayload.resource_response?.data||[];let added=0;for(const pin of batch){const pinId=String(pin.id||"");if(!pinId||seen.has(pinId)){continue;}seen.add(pinId);pins.push(pin);added+=1;}const next=feedPayload.resource?.options?.bookmarks?.[0];if(!next||next==="-end-"||next.startsWith("Y2JOb25lO")||added===0){break;}bookmarks=[next];}if(!pins.length){alert("No pins were exported from this board.");return;}const exportData={username,slug,sourcePath,boardName:boardPayload.resource_response?.data?.name,pinCount:boardPayload.resource_response?.data?.pin_count,pins,exportedAt:new Date().toISOString()};const blob=new Blob([JSON.stringify(exportData)],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=username+"-"+slug+"-pinfetch.json";document.body.appendChild(link);link.click();link.remove();alert("Exported "+pins.length+" pins for Pinfetch.");})();`;
  return `javascript:${encodeURIComponent(source)}`;
}