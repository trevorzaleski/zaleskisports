// ============================================================================
// FEEDS CONFIG — one entry per live score bug.
//
// To wire a feed to production, set `url` to the endpoint that serves the
// bug's live data (GoBound export, vMix data source, scoring API, etc.) and
// make sure it returns JSON shaped like:
//   { "homeScore": 54, "awayScore": 47, "period": "2nd Half", "clock": "3:12", "status": "live" }
// `status` may be: "upcoming" | "live" | "final".
//
// While `url` is null the feed runs in DEMO mode: the board simulates score
// changes so producers can see how the monitor behaves. Demo feeds are
// clearly badged DEMO on their cards.
//
// `pollSeconds` is how often the board re-reads that feed. The card shows
// seconds since the last successful update; a feed goes STALE after
// 3x pollSeconds without an update and DOWN after 6x.
// ============================================================================

const FEEDS = [
  {
    id: "bug-mfd-bbb",
    sport: "Boys Basketball · Varsity",
    home: "Marshfield Tigers",
    away: "Wausau West Warriors",
    venue: "Marshfield High School",
    url: null,
    pollSeconds: 10,
    demo: { status: "live", homeScore: 48, awayScore: 41, periods: ["1st Half", "2nd Half"], clockStart: 14 * 60 }
  },
  {
    id: "bug-mfd-gbb",
    sport: "Girls Basketball · Varsity",
    home: "Marshfield Tigers",
    away: "Stevens Point Panthers",
    venue: "Marshfield Fieldhouse",
    url: null,
    pollSeconds: 10,
    demo: { status: "live", homeScore: 33, awayScore: 35, periods: ["1st Half", "2nd Half"], clockStart: 9 * 60 }
  },
  {
    id: "bug-dce-hky",
    sport: "Boys Hockey · Varsity",
    home: "D.C. Everest Evergreens",
    away: "Wisconsin Rapids Raiders",
    venue: "Greenheck Field House",
    url: null,
    pollSeconds: 15,
    demo: { status: "live", homeScore: 2, awayScore: 2, periods: ["1st", "2nd", "3rd"], clockStart: 11 * 60 }
  },
  {
    id: "bug-spash-wr",
    sport: "Wrestling · Dual",
    home: "Stevens Point Panthers",
    away: "Merrill Bluejays",
    venue: "SPASH Main Gym",
    url: null,
    pollSeconds: 20,
    demo: { status: "upcoming", homeScore: 0, awayScore: 0, periods: ["Dual"], clockStart: 0 }
  },
  {
    id: "bug-wau-vb",
    sport: "Girls Volleyball · Varsity",
    home: "Wausau East Lumberjacks",
    away: "Antigo Red Robins",
    venue: "Wausau East Gym",
    url: null,
    pollSeconds: 15,
    demo: { status: "final", homeScore: 3, awayScore: 1, periods: ["Set 4"], clockStart: 0 }
  }
];

const STALE_MULTIPLIER = 3;
const DOWN_MULTIPLIER = 6;

// Runtime state per feed: last payload, last successful update time, timers.
const state = new Map();
let activeFilter = "all";

function nowMs() { return Date.now(); }

function fmtClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// --- Demo simulation: stands in for a real endpoint until `url` is set. ---
function demoTick(feed, prev) {
  const d = feed.demo;
  if (d.status !== "live") {
    return { homeScore: d.homeScore, awayScore: d.awayScore, period: d.periods[d.periods.length - 1], clock: d.status === "upcoming" ? "--:--" : "0:00", status: d.status };
  }
  const p = prev || { homeScore: d.homeScore, awayScore: d.awayScore, periodIndex: 0, clockSeconds: d.clockStart, status: "live" };
  const next = { ...p };
  next.clockSeconds = Math.max(0, p.clockSeconds - feed.pollSeconds);
  if (next.clockSeconds === 0) {
    if (p.periodIndex < d.periods.length - 1) {
      next.periodIndex = p.periodIndex + 1;
      next.clockSeconds = d.clockStart;
    } else {
      next.status = "final";
    }
  }
  // Sprinkle in scoring so the board visibly updates.
  const roll = (feed.id.length * 7 + next.clockSeconds * 13) % 10;
  if (next.status === "live" && roll < 4) next.homeScore += (roll % 3) + 1;
  if (next.status === "live" && roll >= 6) next.awayScore += (roll % 3) + 1;
  return { homeScore: next.homeScore, awayScore: next.awayScore, period: d.periods[next.periodIndex], clock: fmtClock(next.clockSeconds), status: next.status, periodIndex: next.periodIndex, clockSeconds: next.clockSeconds };
}

async function pollFeed(feed) {
  const s = state.get(feed.id);
  try {
    let payload;
    if (feed.url) {
      const res = await fetch(feed.url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      payload = await res.json();
    } else {
      payload = demoTick(feed, s.payload);
    }
    s.payload = payload;
    s.lastUpdate = nowMs();
    s.error = null;
  } catch (err) {
    s.error = String(err);
  }
  render();
}

function feedHealth(feed, s) {
  if (!s.lastUpdate) return "down";
  const status = s.payload?.status || "live";
  if (status === "final") return "final";
  if (status === "upcoming") return "upcoming";
  const age = (nowMs() - s.lastUpdate) / 1000;
  if (age > feed.pollSeconds * DOWN_MULTIPLIER) return "down";
  if (age > feed.pollSeconds * STALE_MULTIPLIER) return "stale";
  return "live";
}

function ageLabel(s) {
  if (!s.lastUpdate) return { text: "never", cls: "updated-bad" };
  const age = Math.floor((nowMs() - s.lastUpdate) / 1000);
  const cls = age <= 30 ? "updated-ok" : age <= 90 ? "updated-warn" : "updated-bad";
  return { text: age === 0 ? "just now" : `${age}s ago`, cls };
}

function matchesFilter(health) {
  if (activeFilter === "all") return true;
  if (activeFilter === "live") return health === "live";
  if (activeFilter === "issues") return health === "stale" || health === "down";
  return true;
}

function render() {
  const grid = document.getElementById("feedGrid");
  const counts = { live: 0, stale: 0, down: 0 };
  const cards = [];

  for (const feed of FEEDS) {
    const s = state.get(feed.id);
    const health = feedHealth(feed, s);
    if (counts[health] !== undefined) counts[health] += 1;
    if (!matchesFilter(health)) continue;

    const p = s.payload || {};
    const age = ageLabel(s);
    const isDemo = !feed.url;
    cards.push(`
      <article class="feed-card ${health}">
        <div class="feed-top">
          <div class="feed-meta">${feed.sport}<br>${feed.venue}</div>
          <div class="badges">
            ${isDemo ? `<span class="badge demo">Demo</span>` : ""}
            <span class="badge ${health}">${health === "live" ? `<span class="pulse"></span>Live` : health}</span>
          </div>
        </div>
        <div class="matchup">
          <div class="row"><strong>${feed.away}</strong><b>${p.awayScore ?? "–"}</b></div>
          <div class="row"><strong>${feed.home}</strong><b>${p.homeScore ?? "–"}</b></div>
          <div class="game-state">
            <span>Period <b>${p.period ?? "–"}</b></span>
            <span>Clock <b>${p.clock ?? "–:–"}</b></span>
          </div>
        </div>
        <div class="feed-detail">
          <div class="kv"><span>Feed</span><code>${feed.url || `demo://${feed.id}`}</code></div>
          <div class="kv"><span>Poll rate</span><div>every ${feed.pollSeconds}s</div></div>
          <div class="kv"><span>Last update</span><div class="${age.cls}">${age.text}</div></div>
          ${s.error ? `<div class="kv"><span>Error</span><div class="updated-bad">${s.error}</div></div>` : ""}
        </div>
      </article>
    `);
  }

  grid.innerHTML = cards.join("") || `<div class="empty-note">No feeds match this filter.</div>`;
  document.getElementById("countLive").textContent = counts.live;
  document.getElementById("countStale").textContent = counts.stale;
  document.getElementById("countDown").textContent = counts.down;
  document.getElementById("demoBanner").style.display = FEEDS.some(f => !f.url) ? "" : "none";
}

document.querySelectorAll(".pill").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
    button.classList.add("active");
    activeFilter = button.dataset.filter;
    render();
  });
});

setInterval(() => {
  document.getElementById("boardClock").textContent = new Date().toLocaleTimeString();
}, 1000);

// Re-render every second so the "last update" ages tick live even between polls.
setInterval(render, 1000);

// Seed state for every feed before the first poll — pollFeed() re-renders the
// whole board, so all entries must exist before any poll fires.
for (const feed of FEEDS) {
  state.set(feed.id, { payload: null, lastUpdate: null, error: null });
}
for (const feed of FEEDS) {
  pollFeed(feed);
  setInterval(() => pollFeed(feed), feed.pollSeconds * 1000);
}
render();
