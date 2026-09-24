// The stats window. Two records of the same player:
//   This device   every round finished in this browser, practice included,
//                 kept in local storage
//   Ranked        every ranked round this browser has played, kept in the
//                 database and read from /api/stats

import { api } from "./api.js";
import { MAX_GUESSES } from "./rules.js";
import { escapeHtml, openModal, store } from "./ui.js";

const STORAGE = "wordle.stats";

const EMPTY = () => ({ played: 0, wins: 0, streak: 0, best: 0, dist: Array(MAX_GUESSES).fill(0) });

function loadLocal() {
  const saved = store.getJson(STORAGE);
  const out = EMPTY();
  if (!saved || typeof saved !== "object") return out;
  for (const k of ["played", "wins", "streak", "best"]) {
    if (Number.isInteger(saved[k]) && saved[k] >= 0) out[k] = saved[k];
  }
  if (Array.isArray(saved.dist)) {
    out.dist = out.dist.map((_, i) => (Number.isInteger(saved.dist[i]) ? saved.dist[i] : 0));
  }
  return out;
}

// One finished round on this device. A loss includes giving up.
export function recordLocal({ won, guesses }) {
  const s = loadLocal();
  s.played += 1;
  if (won) {
    s.wins += 1;
    s.streak += 1;
    s.best = Math.max(s.best, s.streak);
    if (guesses >= 1 && guesses <= MAX_GUESSES) s.dist[guesses - 1] += 1;
  } else {
    s.streak = 0;
  }
  store.set(STORAGE, s);
}

const TABS = {
  local: "Every round finished on this device, practice rounds included.",
  ranked: "Ranked rounds from this browser, kept on the server. A ranked round left with a guess in it counts as a loss.",
};

let tab = "local";
let loading = 0;
let highlight = null;

function setTab(next) {
  tab = next;
  document.querySelectorAll("#statsTabs [data-stats]").forEach((el) => {
    const on = el.dataset.stats === tab;
    el.classList.toggle("active", on);
    el.setAttribute("aria-selected", String(on));
  });
  document.getElementById("statsNote").textContent = TABS[tab];
}

function renderStats(s) {
  const winRate = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  const most = Math.max(1, ...s.dist);
  const tiles = [
    [s.played, "Played"],
    [`${winRate}%`, "Win rate"],
    [s.streak, "Streak"],
    [s.best, "Best streak"],
  ];
  return `
    <div class="stats-grid">
      ${tiles.map(([v, label]) => `<div class="stat"><div class="stat-value">${escapeHtml(v)}</div><div class="stat-label">${label}</div></div>`).join("")}
    </div>
    <p class="modal-section-label">Solved in</p>
    <ol class="dist" aria-label="Rounds solved, by number of guesses">
      ${s.dist
        .map((n, i) => {
          const width = Math.max(8, Math.round((n / most) * 100));
          const mark = highlight === i + 1 ? " latest" : "";
          return `<li class="dist-row"><span class="dist-n">${i + 1}</span><span class="dist-bar${mark}" style="width:${width}%" aria-label="${i + 1} ${i ? "guesses" : "guess"}: ${n}">${n}</span></li>`;
        })
        .join("")}
    </ol>`;
}

async function load() {
  const body = document.getElementById("statsBody");
  const ticket = ++loading;

  if (tab === "local") {
    body.removeAttribute("aria-busy");
    body.innerHTML = renderStats(loadLocal());
    return;
  }

  body.setAttribute("aria-busy", "true");
  try {
    const r = await api.stats();
    if (ticket !== loading) return;
    body.innerHTML = renderStats({
      played: r.played,
      wins: r.wins,
      streak: r.current_streak,
      best: r.best_streak,
      dist: Array.from({ length: MAX_GUESSES }, (_, i) => r.distribution?.[i] ?? 0),
    });
  } catch (err) {
    if (ticket !== loading) return;
    body.innerHTML = `<p class="board-empty">${
      err.code === "offline" ? "Ranked stats need a connection." : "Ranked stats did not load. Try again in a moment."
    }</p>`;
  } finally {
    if (ticket === loading) body.removeAttribute("aria-busy");
  }
}

// `solvedIn` marks the bar for the round just finished, if there was one.
export function openStats(which = tab, solvedIn = null) {
  highlight = solvedIn;
  setTab(which);
  openModal("statsModal");
  load();
}

export function initStats() {
  document.getElementById("statsBtn").addEventListener("click", () => openStats(tab));
  document.getElementById("statsTabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-stats]");
    if (!t || t.dataset.stats === tab) return;
    setTab(t.dataset.stats);
    load();
  });
}
