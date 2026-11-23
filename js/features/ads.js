/* js/features/ads.js — Social bar and Popunder persistent load.
 *
 * Never removes existing ad scripts. Only injects new ones so that
 * at least one social bar and one popunder are always present on the page.
 * Old bars/popunders are left in place (may overlap) — never forcibly removed.
 */

const SOCIAL_BAR_SRC = "https://bauval.org/14/b498715c0c3416891bb43e2d19a02a75";
const POPUNDER_SRC = "https://abscloud.org/1/84c5ff988764c502b5639cf08f24aa0b";

function injectSocialBar() {
  // Inject a new social bar script. Never removes existing ones.
  const s = document.createElement("script");
  s.src = SOCIAL_BAR_SRC + "?t=" + Date.now();
  s.setAttribute("data-cfasync", "false");
  s.async = true;
  document.head.appendChild(s);
}

function injectPopunder() {
  // Inject a new popunder script. Never removes existing ones.
  const s = document.createElement("script");
  s.src = POPUNDER_SRC + "?t=" + Date.now();
  s.setAttribute("data-cfasync", "false");
  s.async = true;
  document.head.appendChild(s);
}

/* =====================================================================
   ACTIVE: Always keep social bar + popunder present
   ===================================================================== */
export async function init(ctx) {
  // Initial load: ensure at least one of each exists immediately.
  injectSocialBar();
  injectPopunder();

  // On every video change (swipe/scroll): fetch and display a new social bar
  // and a new popunder. Old ones are never removed — they may overlap.
  window.addEventListener("sx:video-changed", () => {
    try { injectSocialBar(); } catch (e) {}
    try { injectPopunder(); } catch (e) {}
  });

  // On any click: fetch and display a new popunder (in case a click
  // dismissed the previous one). Old popunders are never removed.
  window.addEventListener("click", () => {
    try { injectPopunder(); } catch (e) {}
  }, { passive: true });
}

// Global stubs (prevents console errors if called from console)
window.sxAdsReloadSocialBar = () => { injectSocialBar(); };
window.sxAdsReloadPopunder = () => { injectPopunder(); };
window.sxAdsRefresh = () => 0;
window.sxAdsStats = () => ({ count: 0, slots: 0 });
