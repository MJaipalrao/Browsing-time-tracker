const STORAGE_KEY = "btt_state_v1";

const DEFAULT_STATE = {
  settings: {
    trackingEnabled: true,
    idleThresholdMinutes: 2,
    ignoredDomains: [],
    retentionDays: 180
  },
  active: {
    tabId: null,
    url: "",
    domain: "",
    title: "",
    faviconUrl: "",
    startedAt: null,
    visitRecorded: false
  },
  days: {}
};

const CATEGORY_RULES = [
  { name: "Productivity", color: "#2563eb", words: ["github", "gitlab", "docs.", "notion", "trello", "asana", "figma", "stackoverflow", "developer", "localhost"] },
  { name: "Social Media", color: "#10b981", words: ["twitter", "x.com", "facebook", "instagram", "linkedin", "reddit", "threads", "whatsapp"] },
  { name: "Entertainment", color: "#f59e0b", words: ["youtube", "netflix", "spotify", "twitch", "primevideo", "hotstar", "disney"] },
  { name: "News", color: "#7c3aed", words: ["news", "bbc", "cnn", "reuters", "nytimes", "thehindu", "indianexpress"] },
  { name: "Shopping", color: "#f43f5e", words: ["amazon", "flipkart", "ebay", "etsy", "myntra", "shop"] }
];

const OTHER_CATEGORY = { name: "Other", color: "#64748b" };

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(date = new Date()) {
  return todayKey(date).slice(0, 7);
}

function getMonthLabel(key = monthKey()) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

// Returns Monday of the week containing `date` as a "YYYY-MM-DD" key
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon…
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  d.setDate(d.getDate() + diff);
  return todayKey(d);
}

// "Jun 2 – Jun 8, 2025" style label for a week starting on weekStartKey
function getWeekLabel(weekStartKey) {
  const start = new Date(weekStartKey + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const year = end.getFullYear();
  return `${fmt(start)} – ${fmt(end)}, ${year}`;
}

// Returns sorted array of all unique week-start keys (Monday) found in state.days
function getAllWeekStarts(state) {
  const seen = new Set();
  for (const dayKey of Object.keys(state.days || {})) {
    seen.add(getWeekStart(new Date(dayKey + "T00:00:00")));
  }
  // Always include current week
  seen.add(getWeekStart());
  return [...seen].sort().reverse();
}

// Summarize all days within a Mon–Sun window starting at weekStartKey
function summarizeWeek(state, weekStartKey) {
  const start = new Date(weekStartKey + "T00:00:00");
  const dayKeys = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dayKeys.push(todayKey(d));
  }

  const summary = {
    weekStartKey,
    label: getWeekLabel(weekStartKey),
    totalMs: 0,
    visits: 0,
    domains: {},
    categories: {},
    timeline: [],
    daily: dayKeys.map((dk) => ({ dayKey: dk, totalMs: 0 }))
  };

  for (const [i, dk] of dayKeys.entries()) {
    const day = state.days[dk];
    if (!day) continue;
    summary.totalMs += day.totalMs || 0;
    summary.visits  += day.visits  || 0;
    mergeBuckets(summary.domains,    day.domains    || {});
    mergeBuckets(summary.categories, day.categories || {});
    summary.timeline.push(...(day.timeline || []).map((item) => ({ ...item, dayKey: dk })));
    summary.daily[i].totalMs = day.totalMs || 0;
  }

  summary.domainCount = Object.keys(summary.domains).length;
  const activeDays = summary.daily.filter((d) => d.totalMs > 0).length;
  summary.dailyAverageMs = activeDays > 0 ? summary.totalMs / activeDays : 0;
  summary.timeline.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return summary;
}

function createEmptyDay() {
  return {
    totalMs: 0,
    visits: 0,
    domains: {},
    categories: {},
    timeline: []
  };
}

function normalizeDomain(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isIgnoredDomain(domain, settings = DEFAULT_STATE.settings) {
  const ignored = settings.ignoredDomains || [];
  return ignored.some((pattern) => {
    const normalized = String(pattern).trim().toLowerCase().replace(/^www\./, "");
    if (!normalized) return false;
    return domain === normalized || domain.endsWith(`.${normalized}`);
  });
}

function categorizeDomain(domain) {
  const lower = domain.toLowerCase();
  return CATEGORY_RULES.find((rule) => rule.words.some((word) => lower.includes(word))) || OTHER_CATEGORY;
}

async function getState() {
  if (!globalThis.chrome?.storage?.local) return createPreviewState();
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return mergeState(result[STORAGE_KEY]);
}

async function saveState(state) {
  if (!globalThis.chrome?.storage?.local) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function mergeState(state) {
  return {
    ...DEFAULT_STATE,
    ...(state || {}),
    settings: { ...DEFAULT_STATE.settings, ...(state?.settings || {}) },
    active: { ...DEFAULT_STATE.active, ...(state?.active || {}) },
    days: { ...(state?.days || {}) }
  };
}

function ensureDay(state, key = todayKey()) {
  if (!state.days[key]) state.days[key] = createEmptyDay();
  return state.days[key];
}

function pruneOldDays(state, now = new Date()) {
  const retentionDays = Math.max(1, Number(state.settings.retentionDays) || DEFAULT_STATE.settings.retentionDays);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffKey = todayKey(cutoff);
  for (const key of Object.keys(state.days || {})) {
    if (key < cutoffKey) delete state.days[key];
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function summarizeMonth(state, key = monthKey()) {
  const days = Object.entries(state.days)
    .filter(([dayKey]) => dayKey.startsWith(key))
    .sort(([a], [b]) => a.localeCompare(b));

  const summary = {
    key,
    label: getMonthLabel(key),
    totalMs: 0,
    visits: 0,
    domains: {},
    categories: {},
    timeline: [],
    daily: []
  };

  for (const [dayKey, day] of days) {
    summary.totalMs += day.totalMs || 0;
    summary.visits += day.visits || 0;
    mergeBuckets(summary.domains, day.domains || {});
    mergeBuckets(summary.categories, day.categories || {});
    summary.timeline.push(...(day.timeline || []).map((item) => ({ ...item, dayKey })));
    summary.daily.push({ dayKey, totalMs: day.totalMs || 0 });
  }

  summary.domainCount = Object.keys(summary.domains).length;

  // BUG-06 fix: divide by calendar days, not just days-with-activity.
  // Using only active days inflates the average (e.g. 5 active days in a
  // 31-day month makes the average 6× too high).
  // For the current month, use days elapsed so far; for past months, use
  // the total days in that month.
  const [keyYear, keyMonth] = key.split("-").map(Number);
  const now = new Date();
  const isCurrentMonth = keyYear === now.getFullYear() && keyMonth === (now.getMonth() + 1);
  const calendarDays = isCurrentMonth
    ? now.getDate()
    : new Date(keyYear, keyMonth, 0).getDate();
  summary.dailyAverageMs = calendarDays > 0 ? summary.totalMs / calendarDays : 0;

  summary.timeline.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return summary;
}


function mergeBuckets(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (!target[key]) target[key] = { ms: 0, visits: 0, color: value.color, pageUrl: value.pageUrl || "", faviconUrl: value.faviconUrl || "" };
    target[key].ms += value.ms || 0;
    target[key].visits += value.visits || 0;
    if (value.color) target[key].color = value.color;
    if (value.pageUrl) target[key].pageUrl = value.pageUrl;
    if (isUsableImageUrl(value.faviconUrl)) target[key].faviconUrl = value.faviconUrl;
  }
}

function sortedEntries(bucket) {
  return Object.entries(bucket || {}).sort((a, b) => (b[1].ms || 0) - (a[1].ms || 0));
}

function productivityScore(summary) {
  if (!summary.totalMs) return 0;
  const productive = summary.categories.Productivity?.ms || 0;
  const entertainment = summary.categories.Entertainment?.ms || 0;
  const shopping = summary.categories.Shopping?.ms || 0;
  const score = ((productive - entertainment * 0.45 - shopping * 0.25) / summary.totalMs) * 100;
  return Math.max(0, Math.min(100, Math.round(55 + score)));
}

function stateToExport(state) {
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    settings: state.settings,
    days: state.days
  };
}

function isUsableImageUrl(url) {
  return /^(https?:|data:|blob:|chrome-extension:)/i.test(String(url || ""));
}

function createPreviewState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return mergeState(JSON.parse(stored));
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const state = mergeState();

  // Seed multiple days this week + last week for Weekly Report demo
  const now = new Date();

  // Per-day template: [domain, category, color, seconds, visits]
  const DAY_TEMPLATES = [
    // Day 0 (Mon-like: heavy productivity)
    [
      ["github.com",        "Productivity",  "#2563eb", 3*3600+10*60,  80],
      ["docs.google.com",   "Productivity",  "#2563eb", 2*3600+20*60,  55],
      ["stackoverflow.com", "Productivity",  "#2563eb", 1*3600+30*60,  40],
      ["youtube.com",       "Entertainment", "#f59e0b", 0*3600+45*60,  22],
      ["twitter.com",       "Social Media",  "#10b981", 0*3600+30*60,  18]
    ],
    // Day 1 (Tue)
    [
      ["google.com",        "Productivity",  "#2563eb", 4*3600+0*60,  100],
      ["github.com",        "Productivity",  "#2563eb", 2*3600+0*60,   60],
      ["medium.com",        "Social Media",  "#10b981", 1*3600+0*60,   35],
      ["netflix.com",       "Entertainment", "#f59e0b", 1*3600+20*60,  25],
      ["amazon.com",        "Shopping",      "#f43f5e", 0*3600+25*60,  15]
    ],
    // Day 2 (Wed)
    [
      ["stackoverflow.com", "Productivity",  "#2563eb", 2*3600+45*60,  70],
      ["docs.google.com",   "Productivity",  "#2563eb", 1*3600+50*60,  45],
      ["reddit.com",        "Social Media",  "#10b981", 1*3600+10*60,  40],
      ["youtube.com",       "Entertainment", "#f59e0b", 2*3600+0*60,   55],
      ["bbc.com",           "News",          "#7c3aed", 0*3600+40*60,  20]
    ],
    // Day 3 (Thu)
    [
      ["github.com",        "Productivity",  "#2563eb", 3*3600+30*60,  90],
      ["google.com",        "Productivity",  "#2563eb", 2*3600+10*60,  65],
      ["linkedin.com",      "Social Media",  "#10b981", 0*3600+50*60,  28],
      ["twitter.com",       "Social Media",  "#10b981", 0*3600+35*60,  22],
      ["amazon.com",        "Shopping",      "#f43f5e", 0*3600+20*60,  12]
    ],
    // Day 4 (Fri)
    [
      ["google.com",        "Productivity",  "#2563eb", 2*3600+30*60,  70],
      ["youtube.com",       "Entertainment", "#f59e0b", 2*3600+30*60,  60],
      ["reddit.com",        "Social Media",  "#10b981", 1*3600+20*60,  45],
      ["netflix.com",       "Entertainment", "#f59e0b", 1*3600+0*60,   30],
      ["bbc.com",           "News",          "#7c3aed", 0*3600+30*60,  18]
    ],
    // Day 5 (Sat — more entertainment)
    [
      ["youtube.com",       "Entertainment", "#f59e0b", 3*3600+20*60,  80],
      ["netflix.com",       "Entertainment", "#f59e0b", 2*3600+0*60,   40],
      ["reddit.com",        "Social Media",  "#10b981", 1*3600+30*60,  55],
      ["amazon.com",        "Shopping",      "#f43f5e", 0*3600+45*60,  30],
      ["twitter.com",       "Social Media",  "#10b981", 0*3600+40*60,  25]
    ],
    // Day 6 (Sun)
    [
      ["medium.com",        "Social Media",  "#10b981", 1*3600+30*60,  40],
      ["bbc.com",           "News",          "#7c3aed", 1*3600+10*60,  32],
      ["youtube.com",       "Entertainment", "#f59e0b", 2*3600+0*60,   50],
      ["github.com",        "Productivity",  "#2563eb", 0*3600+50*60,  22],
      ["google.com",        "Productivity",  "#2563eb", 0*3600+40*60,  18]
    ]
  ];

  function seedDay(dateObj, templateIdx) {
    const key = todayKey(dateObj);
    const dayData = ensureDay(state, key);
    const samples = DAY_TEMPLATES[templateIdx % DAY_TEMPLATES.length];
    let tsOffset = 9 * 3600 * 1000;
    for (const [domain, category, color, seconds, visits] of samples) {
      const ms = seconds * 1000;
      dayData.totalMs += ms;
      dayData.visits  += visits;
      dayData.domains[domain] = { ms, visits, color, pageUrl: `https://${domain}`, faviconUrl: "" };
      dayData.categories[category] = dayData.categories[category] || { ms: 0, visits: 0, color };
      dayData.categories[category].ms     += ms;
      dayData.categories[category].visits += visits;
      const base = new Date(dateObj); base.setHours(0,0,0,0);
      const startedAt = base.getTime() + tsOffset;
      dayData.timeline.push({
        domain, title: domain, url: `https://${domain}`, faviconUrl: "",
        category, color, startedAt, endedAt: startedAt + ms, ms, visits: 1
      });
      tsOffset += ms + 5 * 60 * 1000;
    }
  }

  // Seed this week (Mon–today)
  const thisWeekStart = new Date(getWeekStart(now) + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(thisWeekStart);
    d.setDate(d.getDate() + i);
    if (d > now) break;
    seedDay(d, i);
  }

  // Seed last week (Mon–Sun)
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  for (let i = 0; i < 7; i++) {
    const d = new Date(lastWeekStart);
    d.setDate(d.getDate() + i);
    seedDay(d, (i + 2) % 7); // slightly different pattern
  }

  // Previous month samples (for monthly delta comparison)
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  seedDay(prevDate, 0);
  const prevDate2 = new Date(now.getFullYear(), now.getMonth() - 1, 10);
  seedDay(prevDate2, 3);
  const prevDate3 = new Date(now.getFullYear(), now.getMonth() - 1, 5);
  seedDay(prevDate3, 5);

  return state;
}
