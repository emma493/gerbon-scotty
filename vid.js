/* js/vid.js — database-free video pool.
 * Powers the swipe feed, grids and player from a static catalog of the
 * 4 videos in /videos. No Firebase, no Firestore, no paging — the pool
 * is the 4 videos, shuffled on boot, repeated on wrap. */

// Stable per-video creator pseudonyms (no database needed).
export const USERNAMES = [
  "LilyGrace", "AvaRose", "EmmaBelle", "SophiaMae", "IsabellaJoy",
  "MiaHope", "CharlotteSky", "AmeliaDawn", "HarperLee", "EvelynRose",
  "AbigailStar", "EmilyBloom", "EllaJune", "ScarlettRay", "GraceLynn",
  "ChloeKate", "PenelopeSue", "LaylaJo", "RileyQuinn", "ZoeyAnn",
  "NoraJane", "LilyPearl",
];

export function creatorFor(id) {
  if (!id) return USERNAMES[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return USERNAMES[h % USERNAMES.length];
}

export function formatCount(n) {
  const v = typeof n === "number" ? n : 0;
  if (v >= 1000) return (v / 1000).toFixed(1) + "K";
  return String(v);
}

// --- Static catalog: exactly the 4 videos in /videos, nothing else ---
const STATIC_VIDEOS = [
  { id: "8670601-hd_1080_1920_25fps", url: "/videos/8670601-hd_1080_1920_25fps.mp4", views: 0, likes: 0 },
  { id: "7727170-hd_1080_1920_25fps", url: "/videos/7727170-hd_1080_1920_25fps.mp4", views: 0, likes: 0 },
  { id: "16453671_1080_1920_30fps", url: "/videos/16453671_1080_1920_30fps.mp4", views: 0, likes: 0 },
  { id: "13963074_2160_3840_60fps", url: "/videos/13963074_2160_3840_60fps.mp4", views: 0, likes: 0 },
];

// Pool state
let fetchedVideos = [];
let currentVideoIndex = 0;
let currentVideo = null;
let preloaderElement = null;
let allRawVideos = [];
let pageCursor = null;
let morePages = false;
let pagingInFlight = false;
let filling = false;
let loadSettled = false;
let lastLoadError = null;

export function hasMoreVideos() { return morePages; }

function orderPage(newRaw) {
  const scoped = applyPreference(newRaw);
  return shuffleArray([...scoped]);
}

export function getContentPreference() { return "girls"; }

function effectiveCategory(v) {
  const c = v.creatorCategory || v.category;
  return c === "girls" ? c : null;
}

function applyPreference(list, prefOverride) {
  const hasAnyLabeled = list.some((v) => effectiveCategory(v) !== null);
  const kept = list.filter((v) => {
    const c = effectiveCategory(v);
    if (!c) return !hasAnyLabeled;
    return c === "girls";
  });
  if (kept.length === 0 && list.length > 0) return list;
  return kept;
}

export function setContentPreference(pref) { return true; }

let creatorsById = {};
export async function loadCreators() { creatorsById = {}; return creatorsById; }

function resolveCreator(data, docId) {
  return { name: creatorFor(docId), avatarUrl: null, bio: null, followers: null, following: null, likesTotal: null, creatorCategory: null, linked: true };
}

export function getFeedMode() { return "foryou"; }
export function setFeedMode(mode) { return; }

function applyFeedOrder(list) {
  return shuffleArray([...applyPreference(list)]);
}

function reshuffleLivePool() {
  const base = allRawVideos.length ? applyPreference(allRawVideos) : fetchedVideos;
  fetchedVideos = shuffleArray([...(base.length ? base : fetchedVideos)]);
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function preloadNextVideo() {
  if (fetchedVideos.length <= 1) return;
  const nextIndex = (currentVideoIndex + 1) % fetchedVideos.length;
  const nextVideo = fetchedVideos[nextIndex];
  if (!nextVideo) return;
  if (!preloaderElement) {
    preloaderElement = document.createElement("video");
    preloaderElement.preload = "metadata";
  }
  preloaderElement.src = nextVideo.url;
  preloaderElement.load();
}

function toVideoObject(id, data) {
  if (!data || !data.direct_url) return null;
  const who = resolveCreator(data, id);
  let createdAtMillis = 0;
  const ts = data.created_at || data.createdAt;
  if (ts && typeof ts.toMillis === "function") {
    try { createdAtMillis = ts.toMillis(); } catch (e) {}
  } else if (ts && typeof ts._seconds === "number") {
    createdAtMillis = ts._seconds * 1000;
  } else if (typeof ts === "string") {
    const p = Date.parse(ts);
    if (!isNaN(p)) createdAtMillis = p;
  }
  return {
    id,
    url: data.direct_url,
    hlsUrl: null,
    posterUrl: data.poster_url || null,
    views: typeof data.views === 'number' ? data.views : 0,
    likes: typeof data.likes === 'number' ? data.likes : 0,
    creator: who.name,
    creatorLinked: who.linked,
    creatorCategory: who.creatorCategory || null,
    avatarUrl: who.avatarUrl,
    category: typeof data.category === 'string' ? data.category : null,
    caption: typeof data.caption === 'string' ? data.caption : null,
    hashtags: Array.isArray(data.hashtags) ? data.hashtags.filter((t) => typeof t === 'string' && t) : [],
    createdAtMillis,
  };
}

/** Loads the static 4-video catalog into the pool. Synchronous. */
export function loadVideosFromFirestore() {
  pageCursor = null;
  morePages = false;
  const rawVideos = STATIC_VIDEOS.map((v) =>
    toVideoObject(v.id, {
      direct_url: v.url,
      views: v.views,
      likes: v.likes,
      poster_url: null,
      hls_url: null,
      status: null,
      created_at: null,
      category: null,
      caption: null,
      hashtags: [],
      creatorId: null,
    })
  );
  allRawVideos = rawVideos;
  fetchedVideos = applyFeedOrder(rawVideos);
  currentVideoIndex = 0;
  try { localStorage.setItem("currentVideoIndex", String(currentVideoIndex)); } catch (e) {}
  preloadNextVideo();
  loadSettled = true;
  lastLoadError = null;
  return fetchedVideos;
}

export async function requestMoreVideos(count = 1) {
  return getVideoCount();
}

export async function ensurePoolSize(n) {
  return getVideoCount();
}

export function getNextVideo() {
  if (fetchedVideos.length === 0) {
    console.warn("No active videos available.");
    return null;
  }
  const videoData = fetchedVideos[currentVideoIndex];
  currentVideo = videoData;
  const wrapped = currentVideoIndex >= fetchedVideos.length - 1;
  currentVideoIndex = (currentVideoIndex + 1) % fetchedVideos.length;
  if (wrapped && fetchedVideos.length > 1) {
    try { reshuffleLivePool(); } catch (e) {}
  }
  try { localStorage.setItem("currentVideoIndex", currentVideoIndex.toString()); } catch (e) {}
  preloadNextVideo();
  if (videoData && videoData.id && typeof window.trackVideoView === "function") {
    window.trackVideoView(videoData.id);
  }
  return videoData;
}

export function getCurrentVideo() { return currentVideo; }

export function getVideoAt(i) {
  if (!fetchedVideos.length) return null;
  const idx = ((i % fetchedVideos.length) + fetchedVideos.length) % fetchedVideos.length;
  const videoData = fetchedVideos[idx];
  if (!videoData) return null;
  currentVideo = videoData;
  try { localStorage.setItem("currentVideoIndex", String(idx)); } catch (e) {}
  if (videoData && videoData.id && typeof window.trackVideoView === "function") {
    window.trackVideoView(videoData.id);
  }
  return videoData;
}

export function getVideoCount() { return fetchedVideos.length; }

export function getAllVideos() { return [...fetchedVideos]; }

export function jumpToIndex(i) {
  if (!fetchedVideos.length) return;
  currentVideoIndex = ((i % fetchedVideos.length) + fetchedVideos.length) % fetchedVideos.length;
  try { localStorage.setItem("currentVideoIndex", currentVideoIndex.toString()); } catch (e) {}
}

export async function persistLike(videoId, like) {
  // No database: likes are not persisted server-side. Stub so the like UI
  // never throws. Per-device likes live in localStorage via store.js.
  return;
}

function detectDeviceType() {
  const ua = (navigator.userAgent || "").toLowerCase();
  if (/tablet|ipad|playbook|silk/.test(ua)) return "Tablet";
  if (/mobile|iphone|ipod|android|blackberry|windows phone/.test(ua)) return "Mobile";
  return "Desktop";
}

export function detectAppType() {
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return "PWA";
  } catch (e) {}
  if (window.navigator && window.navigator.standalone === true) return "PWA";
  return "Browser";
}

export function classifyReferral() {
  try {
    const params = new URLSearchParams(location.search || "");
    const utm_source = (params.get("utm_source") || "").slice(0, 80);
    const utm_medium = (params.get("utm_medium") || "").slice(0, 80);
    const utm_campaign = (params.get("utm_campaign") || "").slice(0, 80);
    const ref = document.referrer || "";
    let host = "";
    try { host = ref ? new URL(ref).hostname.toLowerCase() : ""; } catch (e) { host = ref.toLowerCase(); }
    const raw = ref || (utm_source ? utm_source : "Direct");
    const base = { host: host.slice(0, 120), utm_source, utm_medium, utm_campaign };
    if (host && host === location.hostname) return { group: "Direct", raw: "Direct", ...base };
    if (utm.includes("google") || host.includes("google")) return { group: "Google", raw: (raw || "google").slice(0, 120), ...base };
    if (!ref && !utm_source) return { group: "Direct", raw: "Direct", ...base };
    if (/facebook|instagram|tiktok|twitter|x\.com|youtube|snap|whatsapp|telegram/.test(utm + " " + host)) {
      return { group: "Social", raw: raw.slice(0, 120) || "Social", ...base };
    }
    if (host && host !== location.hostname) return { group: "Organic", raw: host.slice(0, 120), ...base };
    if (utm_source) return { group: "Organic", raw: utm_source.slice(0, 120), ...base };
    return { group: "Direct", raw: (raw || "Direct").slice(0, 120) };
  } catch (e) {
    return { group: "Direct", raw: "Direct", host: "", utm_source: "", utm_medium: "", utm_campaign: "" };
  }
}

let _cachedCountry = null;

const TZ_COUNTRY_HINTS = [
  ["accra", "GH"], ["lagos", "NG"], ["nairobi", "KE"], ["johannesburg", "ZA"],
  ["cairo", "EG"], ["abidjan", "CI"], ["dakar", "SN"], ["casablanca", "MA"],
  ["london", "GB"], ["paris", "FR"], ["berlin", "DE"], ["amsterdam", "NL"],
  ["new_york", "US"], ["chicago", "US"], ["los_angeles", "US"], ["toronto", "CA"],
  ["dubai", "AE"], ["tokyo", "JP"], ["singapore", "SG"], ["mumbai", "IN"],
];

export async function resolveCountry() {
  if (_cachedCountry) return _cachedCountry;
  try {
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || "").toLowerCase();
    if (tz) {
      for (const [frag, code] of TZ_COUNTRY_HINTS) {
        if (tz.includes(frag)) { _cachedCountry = { code, source: "client-locale" }; return _cachedCountry; }
      }
      if (tz.startsWith("africa/")) { _cachedCountry = { code: "GH", source: "client-locale" }; return _cachedCountry; }
    }
  } catch (e) {}
  try {
    const lang = (navigator.language || "").toUpperCase();
    const m = lang.match(/-([A-Z]{2})$/);
    if (m && m[1] && m[1] !== "US" && /^[A-Z]{2}$/.test(m[1])) {
      _cachedCountry = { code: m[1], source: "client-locale" };
      return _cachedCountry;
    }
  } catch (e) {}
  _cachedCountry = { code: "GH", source: "client-locale" };
  return _cachedCountry;
}

export function authProviderLabel(user) { return "guest"; }

export async function upsertUserTelemetry(uid, extra) { return; }
export async function incrementUserCounters(uid, counters) { return; }
export async function markUserOffline(uid) { return; }

export async function getComments(videoId) { return []; }
export async function postComment(videoId, name, text) { return null; }

export function getFirebaseApp() { return null; }
export async function loadUserProfile(uid) { return null; }
export async function saveUserProfile(uid, data) { return; }

export function initializePlayerRecovery(videoElementId = "main-video") {
  const video = document.getElementById(videoElementId);
  if (!video) return;
  video.addEventListener("error", () => {
    console.warn("Video playback encountered a network/stream error. Recovering...");
    const fallback = getNextVideo();
    if (fallback && fallback.url) {
      video.src = fallback.url;
      video.load();
      video.play().catch((e) => console.warn("Auto-recovery play error:", e));
    }
  });
  video.addEventListener("stalled", () => {
    console.warn("Stream stalled. Attempting playback resume...");
    video.load();
    video.play().catch(() => {});
  });
}

export function didVideosLoad() { return loadSettled; }
export function getLastLoadError() { return lastLoadError; }

window.getNextVideo = getNextVideo;
window.loadVideosFromFirestore = loadVideosFromFirestore;
window.initializePlayerRecovery = initializePlayerRecovery;
