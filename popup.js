document.addEventListener("DOMContentLoaded", initPopup);

async function initPopup() {
  await sendRuntimeMessage({ type: "BTT_RECORD_NOW" });
  const state = await getState();
  const months = getAvailableMonths(state);
  const monthSelect = document.querySelector("#monthSelect");
  monthSelect.innerHTML = months.map((key) => `<option value="${key}">${getMonthLabel(key)}</option>`).join("");
  monthSelect.value = monthKey();
  renderPopup(state, monthSelect.value);

  monthSelect.addEventListener("change", async () => {
    // Re-fetch from storage so the month view is always up-to-date,
    // even if time elapsed since the popup was first opened.
    const freshState = await getState();
    renderPopup(freshState, monthSelect.value);
  });
  document.querySelector("#openDashboard").addEventListener("click", openDashboard);
  document.querySelector("#settingsBtn").addEventListener("click", openDashboard);
}

function renderPopup(state, key) {
  const summary = summarizeMonth(state, key);

  // Compute previous month for deltas
  const [y, m] = key.split("-").map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  const prev = summarizeMonth(state, prevKey);
  const prevLabel = getMonthLabel(prevKey).replace(/\s\d{4}$/, "").substring(0, 3);

  document.querySelector("#totalTime").textContent = formatDuration(summary.totalMs);
  document.querySelector("#linksVisited").textContent = summary.visits.toLocaleString();
  document.querySelector("#domainsVisited").textContent = summary.domainCount.toLocaleString();

  setDelta("#totalTimeDelta", summary.totalMs, prev.totalMs, prevLabel, true);
  setDelta("#linksDelta", summary.visits, prev.visits, prevLabel, false);
  setDelta("#domainsDelta", summary.domainCount, prev.domainCount, prevLabel, false);

  // Top 3 sites in popup
  const topDomains = sortedEntries(summary.domains).slice(0, 3);
  const container = document.querySelector("#popupTopSites");
  if (topDomains.length) {
    container.innerHTML = `<div class="popup-top-label">Top Sites</div>` +
      topDomains.map(([name, value]) => `
        <div class="popup-site-row">
          <span class="popup-site-name">${escHtml(name)}</span>
          <span class="popup-site-time">${formatDuration(value.ms)}</span>
        </div>
      `).join("");
  } else {
    container.innerHTML = "";
  }
}

function setDelta(selector, current, previous, prevLabel, isDuration) {
  const el = document.querySelector(selector);
  // Use == null (not falsy !) so that a legitimate value of 0 is still shown.
  // e.g. current=0 with previous=100 should display "▼ 100% from May".
  if (previous == null || current == null) { el.textContent = ""; return; }
  if (previous === 0) { el.textContent = ""; return; } // can't compute % from 0 base
  const pct = Math.round(((current - previous) / previous) * 100);
  const up = pct >= 0;
  const sign = up ? "▲" : "▼";
  el.className = `stat-delta ${up ? "up" : "down"}`;
  el.textContent = `${sign} ${Math.abs(pct)}% from ${prevLabel}`;
}

function getAvailableMonths(state) {
  const months = new Set([monthKey()]);
  Object.keys(state.days).forEach((key) => months.add(key.slice(0, 7)));
  return [...months].sort().reverse();
}

function openDashboard() {
  sendRuntimeMessage({ type: "BTT_OPEN_DASHBOARD" });
}

async function sendRuntimeMessage(message) {
  if (!globalThis.chrome?.runtime?.sendMessage) return;
  await chrome.runtime.sendMessage(message).catch(() => {});
}

function escHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}
