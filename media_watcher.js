/**
 * media_watcher.js — Content script injected into streaming/media sites.
 *
 * Detects whether any <video> or <audio> element is actively playing and
 * sends a BTT_MEDIA_PLAYING heartbeat to the background service worker.
 * This prevents the idle-detection logic from incorrectly stopping the timer
 * while the user is passively consuming media (e.g. watching IPL on Hotstar).
 */

const HEARTBEAT_INTERVAL_MS = 20_000; // every 20 seconds

function isMediaPlaying() {
  const elements = document.querySelectorAll("video, audio");
  for (const el of elements) {
    if (!el.paused && !el.ended && el.readyState >= 2 && el.currentTime > 0) {
      return true;
    }
  }
  return false;
}

function sendHeartbeat(playing) {
  chrome.runtime.sendMessage({ type: "BTT_MEDIA_STATE", playing }).catch(() => {
    // Extension context may be invalidated on navigation — ignore.
  });
}

// Send an initial state immediately so background knows from the start.
sendHeartbeat(isMediaPlaying());

// Poll periodically and send state whenever it changes or as a keep-alive.
let lastPlaying = isMediaPlaying();
setInterval(() => {
  const playing = isMediaPlaying();
  // Always send heartbeat so background can detect stale state if tab closes.
  sendHeartbeat(playing);
  lastPlaying = playing;
}, HEARTBEAT_INTERVAL_MS);

// Also fire immediately on play/pause events for responsiveness.
document.addEventListener(
  "play",
  (e) => {
    if (e.target instanceof HTMLMediaElement) sendHeartbeat(true);
  },
  { capture: true }
);

document.addEventListener(
  "pause",
  (e) => {
    if (e.target instanceof HTMLMediaElement) sendHeartbeat(isMediaPlaying());
  },
  { capture: true }
);

document.addEventListener(
  "ended",
  (e) => {
    if (e.target instanceof HTMLMediaElement) sendHeartbeat(isMediaPlaying());
  },
  { capture: true }
);
