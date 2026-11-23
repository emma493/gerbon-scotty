/**
 * tracking.js - Gerbon Movies video view tracking (database-free).
 * Views are counted per-device in localStorage only. No Firebase, no
 * Firestore, no network calls.
 */

const VIEW_KEY = "shortxx_views";

function readViews() {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}"); } catch (e) { return {}; }
}
function writeViews(views) {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(views)); } catch (e) {}
}

window.trackVideoView = function (videoId) {
  if (!videoId) return;
  try {
    const views = readViews();
    views[videoId] = (views[videoId] || 0) + 1;
    writeViews(views);
  } catch (e) {}
};

window.trackPromoEvent = function () {};
