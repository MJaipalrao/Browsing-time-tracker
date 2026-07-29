importScripts("shared.js");

let operationQueue = Promise.resolve();

// Tracks whether a media element (video/audio) is actively playing on the
// current tab. Updated by BTT_MEDIA_STATE messages from media_watcher.js.
// When true, idle events from chrome.idle are ignored so streaming sessions
// are tracked correctly (e.g. watching IPL on Hotstar).
let mediaPlayingTabId = null;

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  await saveState(state);
  chrome.idle.setDetectionInterval(state.settings.idleThresholdMinutes * 60);
  chrome.alarms.create("btt_tick", { periodInMinutes: 1 });
  refreshActiveTab();
});

chrome.runtime.onStartup.addListener(() => {
  // Only create the tick alarm if it doesn't already exist. Calling create()
  // on an existing alarm resets its timer, which can cause a recording gap
  // (the next tick would be delayed by up to 1 minute on every Chrome start).
  chrome.alarms.get("btt_tick", (existing) => {
    if (!existing) chrome.alarms.create("btt_tick", { periodInMinutes: 1 });
  });
  getState().then(async (state) => {
    chrome.idle.setDetectionInterval(state.settings.idleThresholdMinutes * 60);

    // Discard any active session that survived a shutdown or crash.
    // The stored `startedAt` timestamp is from before the machine was turned
    // off, so counting elapsed time from it would incorrectly attribute all
    // offline/shutdown time as browsing time (e.g. 20h on Gmail).
    if (state.active?.startedAt) {
      state.active = { ...DEFAULT_STATE.active };
      await saveState(state);
    }

    refreshActiveTab();
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "btt_tick") enqueue(() => tickAndRecord());
});

// On every 1-minute tick, check ALL Chrome windows. If none is focused and
// non-minimized, stop the active session. Using getAll() is reliable even
// when the window is minimized (currentWindow:true query returns nothing then).
async function tickAndRecord() {
  const windows = await chrome.windows.getAll();
  const hasFocusedVisibleWindow = windows.some(
    (w) => w.focused && w.state !== "minimized" && w.state !== "docked"
  );
  if (!hasFocusedVisibleWindow) {
    await recordElapsed(true);
    return;
  }
  await recordElapsed();
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  // When the user switches tabs, reset media state so a streaming tab
  // that's been backgrounded doesn't keep the idle override active.
  if (mediaPlayingTabId !== null && mediaPlayingTabId !== tabId) {
    mediaPlayingTabId = null;
  }
  enqueue(() => switchToTab(tabId));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    enqueue(() => switchToTab(tabId, tab));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    const state = await getState();
    if (state.active.tabId === tabId) await recordElapsed(true);
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Chrome lost focus entirely (minimized, switched to another app, etc.)
    enqueue(() => recordElapsed(true));
    return;
  }
  enqueue(async () => {
    const win = await chrome.windows.get(windowId).catch(() => null);
    if (!win || win.state === "minimized") {
      // A minimized window briefly reported focus — stop tracking.
      await recordElapsed(true);
      return;
    }
    // Always stop the current session before resuming. Without this, if
    // WINDOW_ID_NONE wasn't fired during minimize, the old startedAt remains
    // and all minimized time gets counted when the same tab is restored.
    await recordElapsed(true);
    await refreshActiveTab();
  });
});

// onFocusChanged with WINDOW_ID_NONE is unreliable on Windows when minimizing
// (it often doesn't fire at all, or fires late). onBoundsChanged fires
// immediately whenever the window state changes — including to "minimized".
chrome.windows.onBoundsChanged.addListener((win) => {
  if (win.state === "minimized") {
    enqueue(() => recordElapsed(true));
  }
});


chrome.idle.onStateChanged.addListener(async (idleState) => {
  if (idleState === "active") {
    enqueue(() => refreshActiveTab());
  } else {
    // If a media element is currently playing on the active tab, the user
    // is not truly idle — they're watching/listening to something. Skip
    // stopping the timer in that case.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && tab.id === mediaPlayingTabId) {
      // Media is playing — keep the clock running, just refresh the start time.
      enqueue(() => recordElapsed(false));
      return;
    }
    enqueue(() => recordElapsed(true));
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "BTT_RECORD_NOW") {
    enqueue(() => recordElapsed()).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "BTT_OPEN_DASHBOARD") {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard.html") });
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "BTT_SETTINGS_UPDATED") {
    const minutes = Math.max(1, Number(message.idleThresholdMinutes) || 2);
    chrome.idle.setDetectionInterval(minutes * 60);
    enqueue(async () => {
      if (message.trackingEnabled === false) {
        const state = await getState();
        state.active = { ...DEFAULT_STATE.active };
        await saveState(state);
      }
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  // Media playback heartbeat from media_watcher.js content script.
  // Keeps track of which tab (if any) has active media playing so that
  // idle events don't incorrectly cut short streaming sessions.
  if (message?.type === "BTT_MEDIA_STATE") {
    const senderTabId = _sender?.tab?.id ?? null;
    if (senderTabId !== null) {
      mediaPlayingTabId = message.playing ? senderTabId : null;
    }
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

function enqueue(task) {
  operationQueue = operationQueue.then(task).catch((error) => console.error("Browsing Time Tracker error", error));
  return operationQueue;
}

async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await switchToTab(tab.id, tab);
}

async function switchToTab(tabId, knownTab) {
  const tab = knownTab || await chrome.tabs.get(tabId).catch(() => null);
  if (!await isCurrentActiveTab(tab)) return;

  const state = await getState();
  if (!state.settings.trackingEnabled) return;

  if (state.active.tabId === tabId && state.active.url === tab.url) {
    state.active.title = tab.title || state.active.title || state.active.domain;
    if (isUsableImageUrl(tab.favIconUrl)) state.active.faviconUrl = tab.favIconUrl;
    await saveState(state);
    return;
  }

  await recordElapsed(true);
  const freshState = await getState();

  const domain = normalizeDomain(tab?.url || "");
  if (!domain || isIgnoredDomain(domain, freshState.settings)) {
    freshState.active = { ...DEFAULT_STATE.active };
    await saveState(freshState);
    return;
  }

  freshState.active = {
    tabId,
    url: tab.url,
    domain,
    title: tab.title || domain,
    faviconUrl: isUsableImageUrl(tab.favIconUrl) ? tab.favIconUrl : "",
    startedAt: Date.now(),
    visitRecorded: false
  };
  await saveState(freshState);
}

async function recordElapsed(clearActive = false) {
  const state = await getState();
  const active = state.active;
  if (!state.settings.trackingEnabled || !active?.domain || !active.startedAt) return;

  const now = Date.now();
  const elapsed = now - active.startedAt;
  if (elapsed < 1000) return;

  recordActiveRange(state, active, active.startedAt, now, active.visitRecorded ? 0 : 1);
  pruneOldDays(state);

  state.active = clearActive ? { ...DEFAULT_STATE.active } : { ...active, startedAt: now, visitRecorded: true };
  await saveState(state);
}

async function isCurrentActiveTab(tab) {
  if (!tab?.active || !tab.windowId) return false;
  const window = await chrome.windows.get(tab.windowId).catch(() => null);
  // Also exclude minimized windows — a minimized window may still report as
  // "focused" on some OS/Chrome combinations, so we check state explicitly.
  if (!window?.focused || window.state === "minimized") return false;
  return true;
}

function recordActiveRange(state, active, start, end, visitIncrement) {
  let cursor = start;
  let remainingVisitIncrement = visitIncrement;

  while (cursor < end) {
    const cursorDate = new Date(cursor);
    const nextDay = new Date(cursorDate);
    nextDay.setHours(24, 0, 0, 0);
    const segmentEnd = Math.min(end, nextDay.getTime());
    const segmentMs = segmentEnd - cursor;
    const category = categorizeDomain(active.domain);
    const day = ensureDay(state, todayKey(cursorDate));
    const visits = remainingVisitIncrement;

    day.totalMs += segmentMs;
    day.visits += visits;
    // BUG-02 fix: use category.color, not a hardcoded blue, so domain bars
    // match their actual category color in the dashboard.
    addBucketTime(day.domains, active.domain, segmentMs, visits, category.color, {
      pageUrl: active.url,
      faviconUrl: active.faviconUrl
    });
    addBucketTime(day.categories, category.name, segmentMs, visits, category.color);
    day.timeline.unshift({
      domain: active.domain,
      title: active.title,
      url: active.url,
      faviconUrl: active.faviconUrl,
      category: category.name,
      color: category.color,
      startedAt: cursor,
      endedAt: segmentEnd,
      ms: segmentMs,
      // BUG-08 fix: store 1 for the first segment of a visit, 0 for
      // continuation segments, so the dashboard can count real visits.
      visits
    });
    day.timeline = day.timeline.slice(0, 250);

    remainingVisitIncrement = 0;
    cursor = segmentEnd;
  }
}

function addBucketTime(bucket, key, ms, visits, color, metadata = {}) {
  if (!bucket[key]) bucket[key] = { ms: 0, visits: 0, color, pageUrl: "", faviconUrl: "" };
  bucket[key].ms += ms;
  bucket[key].visits += visits;
  bucket[key].color = color;
  if (metadata.pageUrl) bucket[key].pageUrl = metadata.pageUrl;
  if (isUsableImageUrl(metadata.faviconUrl)) bucket[key].faviconUrl = metadata.faviconUrl;
}
