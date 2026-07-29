let appState;
let selectedMonth;
let selectedWeek;
let activePeriod = "month"; // "month" | "week"
let dailyChartInstance = null;
let weeklyChartInstance = null;
const faviconCache = new Map(); // domain -> resolved favicon URL

document.addEventListener("DOMContentLoaded", initDashboard);

async function initDashboard() {
  setupThemeToggle();          // run before first paint to avoid flash
  await sendRuntimeMessage({ type: "BTT_RECORD_NOW" });
  appState = await getState();
  selectedMonth = monthKey();
  selectedWeek  = getWeekStart();
  setupMonthSelect();
  setupHeaderWeekSelect();
  setupPeriodToggle();
  setupNavigation();
  setupSettings();
  setupMoreMenu();
  renderDashboard();

  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden) {
      await sendRuntimeMessage({ type: "BTT_RECORD_NOW" });
      appState = await getState();
      renderDashboard();
    }
  });
}

/* ── Theme Toggle ────────────────────────────────────────────────── */
function setupThemeToggle() {
  const btn     = document.querySelector("#themeToggle");
  const moon    = document.querySelector("#iconMoon");
  const sun     = document.querySelector("#iconSun");
  const root    = document.documentElement;
  const STORAGE = "btt_theme";

  // Determine initial theme: saved pref → OS pref → light
  const saved = localStorage.getItem(STORAGE);
  const osDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = saved ? saved === "dark" : osDark;

  function applyTheme(dark) {
    root.classList.toggle("dark",  dark);
    root.classList.toggle("light", !dark);
    moon.style.display = dark ? "none" : "";
    sun.style.display  = dark ? ""     : "none";
  }

  applyTheme(isDark);

  if (!btn) return;
  btn.addEventListener("click", () => {
    const nowDark = root.classList.contains("dark");
    applyTheme(!nowDark);
    localStorage.setItem(STORAGE, !nowDark ? "dark" : "light");
  });
}

/* ── Period Toggle (Month / Week) ───────────────────────────────── */
function setupPeriodToggle() {
  const monthBtn     = document.querySelector("#periodMonth");
  const weekBtn      = document.querySelector("#periodWeek");
  const monthSelect  = document.querySelector("#dashboardMonth");
  const weekSelect   = document.querySelector("#headerWeekSelect");

  function applyPeriod(period) {
    activePeriod = period;
    monthBtn.classList.toggle("active", period === "month");
    weekBtn.classList.toggle("active",  period === "week");
    monthSelect.style.display = period === "month" ? "" : "none";
    weekSelect.style.display  = period === "week"  ? "" : "none";
    updatePeriodLabels();
    renderDashboard();
  }

  if (monthBtn) monthBtn.addEventListener("click", () => applyPeriod("month"));
  if (weekBtn)  weekBtn.addEventListener("click",  () => applyPeriod("week"));
}

function getPeriodLabel() {
  if (activePeriod === "week") return getWeekLabel(selectedWeek);
  return getMonthLabel(selectedMonth);
}

function updatePeriodLabels() {
  const label = activePeriod === "week" ? "This Week" : "This Month";
  const full  = getPeriodLabel();
  const ids   = ["linksperiodLabel", "categoriesperiodLabel", "domainsperiodLabel"];
  ids.forEach((id) => {
    const el = document.querySelector(`#${id}`);
    if (el) el.textContent = full;
  });
  const reportHeading = document.querySelector("#reportPeriodHeading");
  if (reportHeading) reportHeading.textContent = activePeriod === "week" ? "Weekly Summary" : "Monthly Summary";
}

/* ── Header week selector (mirrors #weekSelect for the period toggle) */
function setupHeaderWeekSelect() {
  const select = document.querySelector("#headerWeekSelect");
  if (!select) return;
  const weeks = getAllWeekStarts(appState);
  select.innerHTML = weeks.map((wk) =>
    `<option value="${wk}">${getWeekLabel(wk)}</option>`
  ).join("");
  select.value = selectedWeek;
  select.addEventListener("change", () => {
    selectedWeek = select.value;
    // Keep the weekly section's own selector in sync
    const weekSel = document.querySelector("#weekSelect");
    if (weekSel) weekSel.value = selectedWeek;
    renderDashboard();
  });
}

/* ── Period-aware summary helpers ───────────────────────────────── */
function getSummary() {
  return activePeriod === "week"
    ? summarizeWeek(appState, selectedWeek)
    : summarizeMonth(appState, selectedMonth);
}

function getPrevSummary() {
  if (activePeriod === "week") {
    const allWeeks = getAllWeekStarts(appState);
    const idx = allWeeks.indexOf(selectedWeek);
    const prevWeek = allWeeks[idx + 1];
    return prevWeek
      ? summarizeWeek(appState, prevWeek)
      : { totalMs: 0, visits: 0, domainCount: 0, dailyAverageMs: 0, daily: [], domains: {}, categories: {} };
  }
  return getPrevMonthSummary();
}

/* ── Month selector ──────────────────────────────────────────────── */
function setupMonthSelect() {
  const select = document.querySelector("#dashboardMonth");
  const months = new Set([monthKey()]);
  Object.keys(appState.days).forEach((key) => months.add(key.slice(0, 7)));
  select.innerHTML = [...months].sort().reverse()
    .map((key) => `<option value="${key}">${getMonthLabel(key)}</option>`).join("");
  select.value = selectedMonth;
  select.addEventListener("change", () => {
    selectedMonth = select.value;
    updateExportLabel();
    renderDashboard();
  });
  updateExportLabel();
}

function updateExportLabel() {
  const el = document.querySelector("#exportMonthLabel");
  if (el) el.textContent = getMonthLabel(selectedMonth);
}

/* ── Navigation ──────────────────────────────────────────────────── */
function setupNavigation() {
  document.querySelector("#nav").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    document.querySelectorAll(".nav button").forEach((item) => {
      const isActive = item === button;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-current", isActive ? "page" : "false");
    });
    document.querySelectorAll(".view").forEach((view) =>
      view.classList.toggle("active", view.id === button.dataset.view));
    document.querySelector("#viewTitle").textContent = button.dataset.label;
  });

  document.querySelector("#exportBtn").addEventListener("click", exportReport);
  document.querySelector("#settingsExportJson").addEventListener("click", exportReport);
  document.querySelector("#settingsExportCsv").addEventListener("click", exportCsv);
}

/* ── More Menu (⋮ button) ────────────────────────────────────────── */
function setupMoreMenu() {
  const moreBtn = document.querySelector("#moreBtn");
  const menu = document.querySelector("#moreMenu");
  if (!moreBtn || !menu) return;

  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle("open");
    moreBtn.setAttribute("aria-expanded", open);
  });

  // Close when clicking outside
  document.addEventListener("click", () => {
    menu.classList.remove("open");
    moreBtn.setAttribute("aria-expanded", "false");
  });

  menu.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    menu.classList.remove("open");
    moreBtn.setAttribute("aria-expanded", "false");
    if (action === "export-json") exportReport();
    if (action === "export-csv") exportCsv();
    if (action === "settings") navigateTo("settings");
    if (action === "about") navigateTo("about");
  });
}

function navigateTo(viewId) {
  const btn = document.querySelector(`#nav button[data-view="${viewId}"]`);
  if (btn) btn.click();
}

/* ── Settings ────────────────────────────────────────────────────── */
function setupSettings() {
  const toggle = document.querySelector("#trackingToggle");
  const idle = document.querySelector("#idleInput");
  const retention = document.querySelector("#retentionInput");
  const ignored = document.querySelector("#ignoredDomains");

  toggle.checked = appState.settings.trackingEnabled;
  idle.value = appState.settings.idleThresholdMinutes;
  retention.value = appState.settings.retentionDays;
  ignored.value = (appState.settings.ignoredDomains || []).join("\n");

  toggle.addEventListener("change", async () => {
    appState.settings.trackingEnabled = toggle.checked;
    await persistSettings();
  });
  idle.addEventListener("change", async () => {
    appState.settings.idleThresholdMinutes = clampNumber(idle.value, 1, 30, 2);
    idle.value = appState.settings.idleThresholdMinutes;
    await persistSettings();
  });
  retention.addEventListener("change", async () => {
    appState.settings.retentionDays = clampNumber(retention.value, 7, 3650, 180);
    retention.value = appState.settings.retentionDays;
    pruneOldDays(appState);
    await persistSettings();
    setupMonthSelect();
    renderDashboard();
  });
  ignored.addEventListener("change", async () => {
    appState.settings.ignoredDomains = ignored.value
      .split(/\r?\n/)
      .map((item) => item.trim().toLowerCase().replace(/^www\./, ""))
      .filter(Boolean);
    ignored.value = appState.settings.ignoredDomains.join("\n");
    await persistSettings();
  });
  document.querySelector("#clearData").addEventListener("click", async () => {
    if (!confirm("Clear all browsing tracker data? This cannot be undone.")) return;
    appState.days = {};
    appState.active = { ...DEFAULT_STATE.active };
    await saveState(appState);
    renderDashboard();
  });
}

async function persistSettings() {
  await saveState(appState);
  await chrome.runtime.sendMessage({
    type: "BTT_SETTINGS_UPDATED",
    idleThresholdMinutes: appState.settings.idleThresholdMinutes,
    trackingEnabled: appState.settings.trackingEnabled
  }).catch(() => {});
}

async function sendRuntimeMessage(message) {
  if (!globalThis.chrome?.runtime?.sendMessage) return;
  await chrome.runtime.sendMessage(message).catch(() => {});
}

/* ── Master render ───────────────────────────────────────────────── */
function renderDashboard() {
  const summary     = getSummary();
  const prevSummary = getPrevSummary();

  updatePeriodLabels();
  renderStats(summary, prevSummary);
  renderStreak();

  // In Week mode: swap line chart → bar chart, show insight chips
  const isWeek = activePeriod === "week";
  const lineCanvas   = document.querySelector("#dailyChart");
  const barCanvas    = document.querySelector("#weeklyDayChart");
  const insightsEl   = document.querySelector("#weekInsights");
  const chartTitle   = document.querySelector("#overviewChartTitle");

  if (lineCanvas)  lineCanvas.style.display  = isWeek ? "none" : "";
  if (barCanvas)   barCanvas.style.display   = isWeek ? "" : "none";
  if (insightsEl)  insightsEl.style.display  = isWeek ? "" : "none";
  if (chartTitle)  chartTitle.textContent    = isWeek ? "Hours per Day" : "Time Spent Over Time";

  if (isWeek) {
    renderWeeklyDayChart(summary);   // bar chart in Overview
    renderWeeklyInsights(summary);   // insight chips in Overview
  } else {
    renderDailyChart(summary);       // line chart in Overview
  }

  renderDonut(summary);
  renderBuckets("#topCategories", summary.categories, 4, false, "category");
  renderBuckets("#topDomains", summary.domains, 5, false, "domain");
  renderTimeline(summary);
  renderBuckets("#linksList", summary.domains, 50, true, "domain");
  renderCategoriesView(summary);
  renderBuckets("#domainsList", summary.domains, 50, true, "domain");
  renderReports(summary, prevSummary);
}

function getPrevMonthSummary() {
  const [y, m] = selectedMonth.split("-").map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  return summarizeMonth(appState, prevKey);
}

/* ── Streak ──────────────────────────────────────────────────────── */
function computeStreak(state) {
  const today = todayKey();
  let streak = 0;
  let d = new Date();
  // Walk backwards from today; a day counts if it has any activity
  while (true) {
    const key = todayKey(d);
    if (key > today) { d.setDate(d.getDate() - 1); continue; }
    if (state.days[key] && (state.days[key].totalMs || 0) > 0) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function renderStreak() {
  const streak = computeStreak(appState);
  const el = document.querySelector("#dashStreak");
  const noteEl = document.querySelector("#dashStreakNote");
  if (!el) return;
  el.innerHTML = `${streak} <small>day${streak !== 1 ? "s" : ""}</small>`;
  if (streak >= 7) {
    noteEl.className = "stat-delta up";
    noteEl.textContent = "🔥 On a roll!";
  } else if (streak >= 3) {
    noteEl.className = "stat-delta up";
    noteEl.textContent = `Keep it going!`;
  } else if (streak === 0) {
    noteEl.className = "stat-delta";
    noteEl.textContent = "Start tracking today";
  } else {
    noteEl.className = "stat-delta";
    noteEl.textContent = "";
  }
}

/* ── Stats ───────────────────────────────────────────────────────── */
function renderStats(summary, prev) {
  document.querySelector("#dashTotal").textContent = formatDuration(summary.totalMs);
  document.querySelector("#dashLinks").textContent = summary.visits.toLocaleString();
  document.querySelector("#dashDomains").textContent = summary.domainCount.toLocaleString();
  document.querySelector("#dashAverage").textContent = formatDuration(summary.dailyAverageMs);

  const prevLabel = getPrevMonthShortLabel();
  setDelta("#dashTotalDelta", summary.totalMs, prev.totalMs, prevLabel);
  setDelta("#dashLinksDelta", summary.visits, prev.visits, prevLabel);
  setDelta("#dashDomainsDelta", summary.domainCount, prev.domainCount, prevLabel);
  setDelta("#dashAverageDelta", summary.dailyAverageMs, prev.dailyAverageMs, prevLabel);
}

function getPrevMonthShortLabel() {
  const [y, m] = selectedMonth.split("-").map(Number);
  const prevDate = new Date(y, m - 2, 1);
  return prevDate.toLocaleDateString(undefined, { month: "short" });
}

function setDelta(selector, current, previous, prevLabel) {
  const el = document.querySelector(selector);
  if (!el) return;
  // BUG-07 fix: use == null instead of falsy ! so current=0 still shows
  // e.g. "▼ 100% from May" when the user had zero browsing this month.
  if (previous == null || current == null) { el.textContent = ""; return; }
  if (previous === 0) { el.textContent = ""; return; } // can't divide by 0
  const pct = Math.round(((current - previous) / previous) * 100);
  const up = pct >= 0;
  el.className = `stat-delta ${up ? "up" : "down"}`;
  el.textContent = `${up ? "▲" : "▼"} ${Math.abs(pct)}% from ${prevLabel}`;
}

/* ── Daily Line Chart (Chart.js) ─────────────────────────────────── */
function renderDailyChart(summary) {
  const canvas = document.querySelector("#dailyChart");
  if (!canvas) return;

  if (dailyChartInstance) {
    dailyChartInstance.destroy();
    dailyChartInstance = null;
  }

  if (typeof Chart === "undefined") {
    canvas.parentElement.innerHTML = `<p class="muted" style="padding:60px 0;text-align:center">Chart unavailable</p>`;
    return;
  }

  const points = summary.daily.length
    ? summary.daily
    : [{ dayKey: selectedMonth + "-01", totalMs: 0 }];

  const labels = points.map((p) => {
    const d = new Date(p.dayKey + "T00:00:00");
    return `${d.toLocaleDateString(undefined, { month: "short" })} ${d.getDate()}`;
  });
  const data = points.map((p) => Math.round(p.totalMs / 3600000 * 100) / 100);

  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, "rgba(37, 99, 235, 0.18)");
  gradient.addColorStop(1, "rgba(37, 99, 235, 0)");

  dailyChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data,
        borderColor: "#2563eb",
        borderWidth: 2.5,
        pointBackgroundColor: "#2563eb",
        pointRadius: data.length === 1 ? 5 : 3,
        pointHoverRadius: 6,
        fill: true,
        backgroundColor: gradient,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${formatHoursDecimal(ctx.raw)}h`
          },
          backgroundColor: "#1e293b",
          titleColor: "#94a3b8",
          bodyColor: "#f1f5f9",
          padding: 10,
          cornerRadius: 8
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: "#94a3b8",
            font: { size: 11 },
            maxTicksLimit: 6,
            maxRotation: 0
          },
          border: { display: false }
        },
        y: {
          grid: { color: "#f1f5f9", lineWidth: 1 },
          ticks: {
            color: "#94a3b8",
            font: { size: 11 },
            maxTicksLimit: 4,
            callback: (v) => v === 0 ? "0" : `${v}h`
          },
          border: { display: false }
        }
      }
    }
  });
}

function formatHoursDecimal(h) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

/* ── Donut Chart ─────────────────────────────────────────────────── */
function renderDonut(summary) {
  const entries = sortedEntries(summary.categories);
  const total = summary.totalMs || 1;
  let start = 0;

  const stops = entries.map(([name, value]) => {
    const end = start + (value.ms / total) * 360;
    const segment = `${value.color || "#64748b"} ${start}deg ${end}deg`;
    start = end;
    return segment;
  });

  document.querySelector("#categoryDonut").style.background = entries.length
    ? `conic-gradient(${stops.join(", ")})`
    : "conic-gradient(#e2e8f0 0 360deg)";

  // Legend
  const legend = document.querySelector("#donutLegend");
  if (!legend) return;
  legend.innerHTML = entries.map(([name, value]) => {
    const pct = Math.round((value.ms / total) * 100);
    return `<div class="legend-item">
      <span class="legend-dot" style="background:${value.color}"></span>
      <span class="legend-name">${escapeHtml(name)}</span>
      <span class="legend-pct">${pct}%</span>
    </div>`;
  }).join("");
}

/* ── Generic Bucket List ─────────────────────────────────────────── */
function renderBuckets(selector, bucket, limit, showVisits = false, iconType = "domain") {
  const entries = sortedEntries(bucket).slice(0, limit);
  const total = entries.reduce((sum, [, v]) => sum + v.ms, 0) || 1;
  const html = entries.map(([name, value]) => {
    const percent = Math.round((value.ms / total) * 100);
    const meta = showVisits
      ? `<span>${formatDuration(value.ms)}</span><span class="visit-count">${value.visits} visits</span>`
      : `<span>${formatDuration(value.ms)}</span>`;
    const icon = getIconMarkup(name, value.color || "#2563eb", iconType, value);
    return `<div class="list-row">
      ${icon}
      <div class="list-main">
        <strong>${escapeHtml(name)}</strong>
        <div class="bar"><i style="width:${percent}%;background:${value.color || "#2563eb"}"></i></div>
      </div>
      <span class="row-meta">${meta}</span>
    </div>`;
  }).join("");
  const container = document.querySelector(selector);
  if (!container) return;
  container.innerHTML = html || `<p class="muted">No activity recorded yet.</p>`;
  bindFaviconFallbacks(container);
}

/* ── Categories View (full page) ─────────────────────────────────── */
function renderCategoriesView(summary) {
  const entries = sortedEntries(summary.categories);
  const total = summary.totalMs || 1;
  const container = document.querySelector("#categoriesList");
  if (!container) return;

  if (!entries.length) {
    container.innerHTML = `<p class="muted">No activity recorded yet.</p>`;
    return;
  }

  container.innerHTML = entries.map(([name, value]) => {
    const pct = Math.round((value.ms / total) * 100);
    const icon = getIconMarkup(name, value.color, "category", value);
    return `<div class="panel category-card">
      <div class="category-card-header">
        ${icon}
        <div class="category-card-info">
          <strong>${escapeHtml(name)}</strong>
          <div class="category-bar-wrap">
            <div class="bar category-bar"><i style="width:${pct}%;background:${value.color}"></i></div>
          </div>
        </div>
        <span class="category-time-badge">
          ${formatDuration(value.ms)}
          <small>(${pct}%)</small>
        </span>
      </div>
    </div>`;
  }).join("");
}

/* ── Timeline — Chrome-history style ───────────────────────────── */
// Shows individual visit sessions in chronological order with timestamps.
// Nearby sessions on the same domain (gap < 5 min) are merged into one row.
function renderTimeline(summary) {
  const container = document.querySelector("#timelineList");
  if (!container) return;

  if (!summary.timeline.length) {
    container.innerHTML = `<div class="tl-empty"><span class="tl-empty-icon">🕐</span><p>No timeline activity recorded yet.</p></div>`;
    return;
  }

  // Group raw segments by day
  const byDay = {};
  for (const item of summary.timeline) {
    const dayKey = item.dayKey || new Date(item.startedAt).toISOString().slice(0, 10);
    if (!byDay[dayKey]) byDay[dayKey] = [];
    byDay[dayKey].push(item);
  }

  // Sort days descending (most recent first)
  const sortedDays = Object.keys(byDay).sort((a, b) => b.localeCompare(a));

  let html = "";
  for (const dayKey of sortedDays) {
    const dayLabel = formatDayLabel(dayKey);
    // Merge nearby segments, then show most-recent first
    const sessions = mergeTimelineSessions(byDay[dayKey]);

    html += `<div class="tl-day">
      <div class="tl-day-header">
        <span class="tl-day-divider"></span>
        <span class="tl-day-label">${dayLabel}</span>
        <span class="tl-day-count">${sessions.length} visit${sessions.length !== 1 ? "s" : ""}</span>
      </div>
      <div class="tl-day-body">`;

    for (const session of sessions) {
      const icon     = getIconMarkup(session.domain, session.color, "domain", session);
      const timeStr  = formatTime(session.startedAt);
      const duration = formatDuration(session.ms);
      const title    = escapeHtml(session.title && session.title !== session.domain ? session.title : session.domain);
      const domain   = escapeHtml(session.domain);
      const visits   = session.visits > 1 ? `· ${session.visits} visits` : "";

      html += `<div class="tl-session">
        <span class="tl-time" title="${timeStr}">${timeStr}</span>
        <span class="tl-spine-dot" style="--dot-color:${session.color}"></span>
        <div class="tl-session-body">
          ${icon}
          <div class="tl-session-info">
            <strong class="tl-session-title">${title}</strong>
            <span class="tl-session-sub">${domain} ${visits}</span>
          </div>
          <div class="tl-session-meta">
            <span class="tl-duration">${duration}</span>
            <span class="category-pill" style="--item-color:${session.color}">${escapeHtml(session.category)}</span>
          </div>
        </div>
      </div>`;
    }

    html += `</div></div>`;
  }

  container.innerHTML = html;
  bindFaviconFallbacks(container);
}

// Merge raw 1-min recording chunks into logical visit sessions.
// Two segments merge if: same domain AND gap between them is < 5 minutes.
function mergeTimelineSessions(rawItems) {
  const GAP_MS = 5 * 60 * 1000;
  // Sort ascending by startedAt for merging
  const sorted = [...rawItems].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));

  const sessions = [];
  for (const item of sorted) {
    const last = sessions[sessions.length - 1];
    const itemEnd = item.endedAt || (item.startedAt + (item.ms || 0));
    if (last && last.domain === item.domain &&
        item.startedAt - last.endedAt < GAP_MS) {
      // Merge into the running session
      last.ms     += item.ms || 0;
      last.endedAt = Math.max(last.endedAt, itemEnd);
      last.visits += (item.visits ?? 1);
      if (item.title && item.title !== item.domain && !last.title) last.title = item.title;
    } else {
      sessions.push({
        domain:    item.domain,
        title:     item.title || item.domain,
        url:       item.url,
        pageUrl:   item.url,
        faviconUrl: item.faviconUrl || "",
        category:  item.category,
        color:     item.color,
        startedAt: item.startedAt,
        endedAt:   itemEnd,
        ms:        item.ms || 0,
        visits:    item.visits ?? 1
      });
    }
  }

  // Return descending (most recent first), like Chrome history
  return sessions.reverse();
}

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric", minute: "2-digit", hour12: true
  });
}

function formatDayLabel(dayKey) {
  const d = new Date(dayKey + "T00:00:00");
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const todayStr = todayKey(today);
  const yStr = todayKey(yesterday);
  if (dayKey === todayStr) return "Today";
  if (dayKey === yStr) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/* ── Reports ─────────────────────────────────────────────────────── */
function renderReports(summary, prev) {
  const score = productivityScore(summary);
  const prevLabel = activePeriod === "week" ? "last week" : getPrevMonthShortLabel();

  const periodName = activePeriod === "week" ? summary.label : summary.label;

  document.querySelector("#monthlySummary").textContent = summary.totalMs
    ? `You spent ${formatDuration(summary.totalMs)} on the browser — ${periodName}.`
    : "No activity recorded yet.";

  const deltaEl = document.querySelector("#reportDeltaNote");
  if (prev.totalMs && summary.totalMs) {
    const pct = Math.round(((summary.totalMs - prev.totalMs) / prev.totalMs) * 100);
    const up = pct >= 0;
    deltaEl.className = `report-delta-note ${up ? "up" : "down"}`;
    deltaEl.innerHTML = `That's ${up ? "▲" : "▼"} <strong>${Math.abs(pct)}%</strong> ${up ? "more" : "less"} than ${prevLabel}.`;
  } else {
    deltaEl.textContent = "";
  }

  document.querySelector("#reportAverage").textContent = formatDuration(summary.dailyAverageMs);
  document.querySelector("#reportLinks").textContent = summary.visits.toLocaleString();
  document.querySelector("#reportDomains").textContent = summary.domainCount.toLocaleString();

  renderScoreGauge(score);
  document.querySelector("#scoreNumber").textContent = score;
  const labelEl = document.querySelector("#scoreLabel");
  const noteEl = document.querySelector("#scoreNote");

  // BUG-09 fix: compare against last month's score so the note text
  // actually reflects the trend instead of being hardcoded.
  const prevScore = productivityScore(prev);
  const improved = !prev.totalMs || score >= prevScore;

  if (score >= 75) {
    labelEl.textContent = "Good";
    labelEl.className = "score-label-badge score-good";
    noteEl.textContent = improved
      ? "Keep it up! You are more productive than last month."
      : "Good score, but slightly down from last month — keep pushing!";
  } else if (score >= 45) {
    labelEl.textContent = "Balanced";
    labelEl.className = "score-label-badge score-balanced";
    noteEl.textContent = improved
      ? "Nice balance — try shifting more time toward productivity."
      : "Balance dipped from last month — watch your entertainment time.";
  } else if (summary.totalMs) {
    labelEl.textContent = "Needs Focus";
    labelEl.className = "score-label-badge score-poor";
    noteEl.textContent = improved
      ? "You're improving! Keep reducing entertainment and shopping time."
      : "Consider reducing entertainment and shopping time.";
  } else {
    labelEl.textContent = "No data yet";
    labelEl.className = "score-label-badge";
    noteEl.textContent = "";
  }
}

function renderScoreGauge(score) {
  const canvas = document.querySelector("#scoreGauge");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2 + 10;
  const r = 60;
  const startAngle = Math.PI * 0.75;
  const endAngle = Math.PI * 2.25;
  const fillAngle = startAngle + (score / 100) * (endAngle - startAngle);

  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.stroke();

  const color = score >= 75 ? "#10b981" : score >= 45 ? "#f59e0b" : "#ef4444";


  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, fillAngle);
  ctx.strokeStyle = color;
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.stroke();
}

/* ── Icons ───────────────────────────────────────────────────────── */
const CATEGORY_ICONS = {
  "Productivity":  "<rect x='2' y='3' width='20' height='14' rx='2'/><line x1='8' y1='21' x2='16' y2='21'/><line x1='12' y1='17' x2='12' y2='21'/>",
  "Social":        "<path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M23 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/>",
  "Entertainment": "<polygon points='5 3 19 12 5 21 5 3'/>",
  "News":          "<path d='M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a4 4 0 0 1-4-4V6a2 2 0 0 1 2-2h2'/><rect x='8' y='6' width='8' height='4' rx='1'/><line x1='8' y1='14' x2='16' y2='14'/><line x1='8' y1='18' x2='12' y2='18'/>",
  "Shopping":      "<path d='M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z'/><line x1='3' y1='6' x2='21' y2='6'/><path d='M16 10a4 4 0 0 1-8 0'/>",
  "Other":         "<rect x='3' y='3' width='7' height='7' rx='1'/><rect x='14' y='3' width='7' height='7' rx='1'/><rect x='3' y='14' width='7' height='7' rx='1'/><rect x='14' y='14' width='7' height='7' rx='1'/>"
};

function getIconMarkup(name, color, type, source = {}) {
  const safeName = escapeHtml(name);
  const initial = (name || "?").slice(0, 1).toUpperCase();

  if (type === "domain") {
    // Always try favicon first via Chrome's built-in favicon API
    const favicon = getFaviconUrl(source.pageUrl || source.url || name);
    if (favicon) {
      return `<span class="site-icon site-favicon" style="--item-color:${color}" title="${safeName}">
        <img src="${favicon}" alt="" loading="lazy" width="22" height="22">
        <span class="icon-fallback">${initial}</span>
      </span>`;
    }
    // CSS-drawn fallback for known sites
    const cssClass = domainCssClass(name);
    if (cssClass) {
      return `<span class="site-icon ${cssClass}" style="--item-color:${color}" title="${safeName}"><span></span></span>`;
    }
  }

  if (type === "category") {
    const paths = CATEGORY_ICONS[name] ?? CATEGORY_ICONS["Other"];
    return `<span class="site-icon site-category" style="--item-color:${color}" title="${safeName}">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>
    </span>`;
  }

  // Generic initial-based icon
  return `<span class="site-icon site-generic" style="--item-color:${color}" title="${safeName}">
    <span>${initial}</span>
  </span>`;
}

function getFaviconUrl(domain) {
  if (!globalThis.chrome?.runtime?.getURL) return "";
  // Return cached URL if already resolved
  if (faviconCache.has(domain)) return faviconCache.get(domain);
  try {
    const pageUrl = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", pageUrl);
    url.searchParams.set("size", "32");
    const resolved = url.toString();
    faviconCache.set(domain, resolved);
    return resolved;
  } catch {
    faviconCache.set(domain, "");
    return "";
  }
}

function domainCssClass(name) {
  const lower = name.toLowerCase();
  if (lower.includes("youtube")) return "site-youtube";
  if (lower.includes("github")) return "site-github";
  if (lower.includes("docs.google")) return "site-docs";
  if (lower.includes("google")) return "site-google";
  if (lower.includes("stackoverflow")) return "site-stackoverflow";
  if (lower.includes("twitter") || lower === "x.com") return "site-twitter";
  if (lower.includes("medium")) return "site-medium";
  if (lower.includes("linkedin")) return "site-linkedin";
  if (lower.includes("reddit")) return "site-reddit";
  if (lower.includes("amazon")) return "site-amazon";
  return "";
}

function categoryCssClass(name) {
  const lower = name.toLowerCase();
  if (lower.includes("productivity")) return "category-productivity";
  if (lower.includes("social")) return "category-social";
  if (lower.includes("entertainment")) return "category-entertainment";
  if (lower.includes("news")) return "category-news";
  if (lower.includes("shopping")) return "category-shopping";
  return "category-other";
}

function bindFaviconFallbacks(container) {
  container.querySelectorAll(".site-favicon img").forEach((img) => {
    img.addEventListener("error", () => {
      img.style.display = "none";
      const fallback = img.nextElementSibling;
      if (fallback) fallback.style.display = "";
    }, { once: true });
    img.addEventListener("load", () => {
      const fallback = img.nextElementSibling;
      if (fallback) fallback.style.display = "none";
    }, { once: true });
  });
}

/* ── Weekly insight chips + bar chart (shown in Overview when Week mode is active) */
function renderWeeklyInsights(wk) {
  const container = document.querySelector("#weekInsights");
  if (!container) return;
  if (!wk.totalMs) { container.innerHTML = ""; return; }

  const days = wk.daily;
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const bestDay     = days.reduce((a, b) => b.totalMs > a.totalMs ? b : a, days[0]);
  const activeDays  = days.filter(d => d.totalMs > 0);
  const worstActive = activeDays.length > 1
    ? activeDays.reduce((a, b) => b.totalMs < a.totalMs ? b : a)
    : null;

  const bestIdx  = days.indexOf(bestDay);
  const worstIdx = worstActive ? days.indexOf(worstActive) : -1;

  const prodMs  = wk.categories["Productivity"]?.ms || 0;
  const prodPct = wk.totalMs ? Math.round((prodMs / wk.totalMs) * 100) : 0;

  const chips = [
    { icon: "\uD83C\uDFC6", label: `Best day: <strong>${DAY_NAMES[bestIdx] ?? "\u2013"}</strong> (${formatDuration(bestDay.totalMs)})`, cls: "insight-best" },
    worstActive && worstIdx !== bestIdx
      ? { icon: "\uD83D\uDE34", label: `Lightest: <strong>${DAY_NAMES[worstIdx]}</strong> (${formatDuration(worstActive.totalMs)})`, cls: "insight-light" }
      : null,
    { icon: "\u26A1", label: `Productivity: <strong>${prodPct}%</strong> of week`, cls: prodPct >= 50 ? "insight-good" : "insight-warn" }
  ].filter(Boolean);

  container.innerHTML = chips.map(c =>
    `<div class="week-insight-chip ${c.cls}"><span class="chip-icon">${c.icon}</span><span>${c.label}</span></div>`
  ).join("");
}

function renderWeeklyDayChart(wk) {
  const canvas = document.querySelector("#weeklyDayChart");
  if (!canvas || typeof Chart === "undefined") return;

  if (weeklyChartInstance) { weeklyChartInstance.destroy(); weeklyChartInstance = null; }

  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const data = wk.daily.map(d => Math.round((d.totalMs / 3600000) * 100) / 100);
  const maxVal = Math.max(...data, 0.1);
  const colors = data.map(v => {
    const ratio = v / maxVal;
    return ratio >= 0.8 ? "#4f46e5" : ratio >= 0.5 ? "#6366f1" : "#a5b4fc";
  });

  weeklyChartInstance = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: DAY_LABELS,
      datasets: [{
        data,
        backgroundColor: colors,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => ` ${formatHoursDecimal(ctx.raw)}` },
          backgroundColor: "#1e293b",
          titleColor: "#94a3b8",
          bodyColor: "#f1f5f9",
          padding: 10,
          cornerRadius: 8
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#94a3b8", font: { size: 11 } }, border: { display: false } },
        y: {
          grid: { color: "#f1f5f9" },
          ticks: { color: "#94a3b8", font: { size: 11 }, maxTicksLimit: 4, callback: v => v === 0 ? "0" : `${v}h` },
          border: { display: false }
        }
      }
    }
  });
}


/* ── Export ──────────────────────────────────────────────────────── */
function exportReport() {
  const summary = summarizeMonth(appState, selectedMonth);
  const exportData = { ...stateToExport(appState), summary };
  downloadBlob(JSON.stringify(exportData, null, 2), `browsing-report-${selectedMonth}.json`, "application/json");
}

function exportCsv() {
  const summary = summarizeMonth(appState, selectedMonth);
  const rows = [["date", "domain", "category", "started_at", "ended_at", "seconds", "url"]];
  for (const item of summary.timeline.slice().reverse()) {
    rows.push([
      item.dayKey, item.domain, item.category,
      new Date(item.startedAt).toISOString(),
      new Date(item.endedAt).toISOString(),
      Math.round(item.ms / 1000), item.url
    ]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadBlob(csv, `browsing-report-${selectedMonth}.csv`, "text/csv");
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  // BUG-10 fix: revoke URL in finally so it's always cleaned up even if
  // link.click() throws (e.g. popup blocker, DOM exception).
  try {
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/* ── Utils ───────────────────────────────────────────────────────── */
function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}
