// The game screen.
//
// Ranked rounds come from the API, which holds the answer until the round
// is over and checks every guess. Practice rounds are what the page plays
// when the API cannot be reached: the same rules from rules.js, the answer
// picked from the precached word list, and nothing to submit.

import { api } from "./api.js";
import { openLeaderboard } from "./leaderboard.js";
import { DEFAULT_LENGTH, MIN_GUESSES, evaluate, hardModeProblem, scoreRound, tally } from "./rules.js";
import { getSettings, saveSettings } from "./settings.js";
import { openStats, recordLocal } from "./stats.js";
import { hydrateIcons, isModalOpen, store } from "./ui.js";
import { isWord, loadWords, randomWord, triesFor, wordLengths, wordsReady } from "./words.js";

const ROUND_STORAGE = "wordle.round";
const GONE = new Set(["round_not_found", "round_over", "round_expired"]);

// Tile flip timing. The flip itself is CSS; this is only how long to wait
// before painting the keyboard and taking input again.
const FLIP_STEP_MS = 160;
const FLIP_MS = 500;

// "+" is Enter and "-" is Backspace.
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "+zxcvbnm-"];
const MARK_WORDS = { correct: "right place", present: "wrong place", absent: "not in the word" };
const MARK_ORDER = { absent: 1, present: 2, correct: 3 };

const $ = (id) => document.getElementById(id);
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// The round on screen. The same shape for both modes:
//   { mode, id, length, tries, hard_mode, rows: [{ guess, marks }], solved,
//     lost, gave_up, score, answer, expired }
// `tries` is fixed when the round starts: see maxGuesses in rules.js.
// A practice round also carries `secret`, its answer.
let round = null;
let typed = "";
let busy = false;
let giveUpTimer = null;

const isLive = (r) => Boolean(r) && !r.solved && !r.lost;

function fromView(v) {
  return {
    mode: "ranked",
    id: v.round_id,
    length: v.length,
    tries: v.max_guesses ?? MIN_GUESSES,
    hard_mode: v.hard_mode,
    rows: v.rows ?? [],
    solved: v.solved,
    lost: v.lost,
    gave_up: v.gave_up,
    score: v.score,
    answer: v.answer ?? null,
    expired: Boolean(v.expired),
    // Present once the round is over. False on a solved round means the
    // anti-cheat flagged it.
    leaderboard_ok: v.leaderboard_ok,
  };
}

function practiceRound(length, hardMode) {
  const secret = randomWord(length);
  if (!secret) return null;
  return {
    mode: "practice",
    id: `p-${Date.now().toString(36)}`,
    length,
    tries: triesFor(length),
    hard_mode: hardMode,
    rows: [],
    solved: false,
    lost: false,
    gave_up: false,
    score: 0,
    answer: null,
    expired: false,
    secret,
  };
}

// Practice rounds are rebuilt from the guesses alone, so the marks are
// always the rules' and never whatever storage says.
function restorePractice(saved) {
  const secret = saved?.secret;
  if (typeof secret !== "string" || !/^[a-z]+$/.test(secret)) return null;
  const guesses = Array.isArray(saved.guesses) ? saved.guesses : [];
  if (!guesses.every((g) => typeof g === "string" && g.length === secret.length && /^[a-z]+$/.test(g))) return null;
  // Kept with the round, since the word list may not have loaded yet.
  const tries = Number.isInteger(saved.tries) && saved.tries >= MIN_GUESSES && saved.tries <= 64 ? saved.tries : MIN_GUESSES;
  if (guesses.length > tries) return null;

  const solved = guesses.includes(secret);
  const rows = guesses.map((guess) => ({ guess, marks: evaluate(guess, secret) }));
  return {
    mode: "practice",
    id: typeof saved.id === "string" ? saved.id : `p-${Date.now().toString(36)}`,
    length: secret.length,
    tries,
    hard_mode: saved.hard_mode === true,
    rows,
    solved,
    lost: !solved && guesses.length >= tries,
    gave_up: false,
    score: scoreRound(rows, secret.length, tries, solved),
    answer: null,
    expired: false,
    secret,
  };
}

function save() {
  if (!isLive(round)) {
    store.remove(ROUND_STORAGE);
    return;
  }
  if (round.mode === "ranked") {
    store.set(ROUND_STORAGE, { mode: "ranked", id: round.id, guesses: round.rows.length });
  } else {
    store.set(ROUND_STORAGE, {
      mode: "practice",
      id: round.id,
      tries: round.tries,
      hard_mode: round.hard_mode,
      secret: round.secret,
      guesses: round.rows.map((r) => r.guess),
    });
  }
}

// Messages.

function say(text, tone = "") {
  const el = $("feedback");
  el.textContent = text;
  el.className = `feedback${tone ? ` ${tone}` : ""}`;
}

// For screen readers only: what the tiles of the guess just made say.
function announce(text) {
  $("announce").textContent = text;
}

function showPanel(id) {
  for (const panel of ["play", "notice"]) $(panel).classList.toggle("hidden", panel !== id);
}

// The board.

function buildBoard() {
  const board = $("board");
  board.style.setProperty("--cols", String(round.length));
  board.style.setProperty("--rows", String(round.tries));
  board.innerHTML = Array.from(
    { length: round.tries },
    (_, r) =>
      `<div class="guess-row" role="img" data-row="${r}">${`<span class="tile"></span>`.repeat(round.length)}</div>`
  ).join("");
  round.rows.forEach((_, r) => paintRow(r, false));
  paintTyping();
}

const rowEl = (r) => $("board").children[r];

function describeRow({ guess, marks }) {
  return [...guess].map((ch, i) => `${ch.toUpperCase()} ${MARK_WORDS[marks[i]]}`).join(", ");
}

function paintRow(r, animate) {
  const row = round.rows[r];
  const el = rowEl(r);
  [...el.children].forEach((tile, i) => {
    tile.textContent = row.guess[i].toUpperCase();
    tile.className = `tile filled ${row.marks[i]}${animate ? " flip" : ""}`;
    tile.style.setProperty("--delay", `${i * FLIP_STEP_MS}ms`);
  });
  el.setAttribute("aria-label", `Guess ${r + 1}: ${describeRow(row)}`);
}

function paintTyping(popAt = -1) {
  const r = round.rows.length;
  for (let n = r; n < round.tries; n++) {
    const el = rowEl(n);
    const letters = n === r && isLive(round) ? typed : "";
    [...el.children].forEach((tile, i) => {
      const ch = letters[i] ?? "";
      tile.textContent = ch.toUpperCase();
      tile.className = `tile${ch ? " filled" : ""}${i === popAt ? " pop" : ""}`;
    });
    el.setAttribute(
      "aria-label",
      n === r && isLive(round)
        ? `Guess ${n + 1}, being typed: ${letters ? letters.toUpperCase().split("").join(" ") : "empty"}`
        : `Guess ${n + 1}: empty`
    );
  }
}

function shakeRow() {
  const el = rowEl(round.rows.length);
  if (!el) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

// Resolves once the row has finished flipping.
function reveal(r) {
  const still = reducedMotion();
  paintRow(r, !still);
  const wait = still ? 0 : (round.length - 1) * FLIP_STEP_MS + FLIP_MS;
  return new Promise((resolve) => setTimeout(resolve, wait));
}

// The keyboard.

function buildKeyboard() {
  const kb = $("keyboard");
  kb.innerHTML = KEY_ROWS.map(
    (row) =>
      `<div class="k-row">${[...row]
        .map((k) => {
          if (k === "+") return `<button type="button" class="key wide" data-key="enter">Enter</button>`;
          if (k === "-")
            return `<button type="button" class="key wide" data-key="back" aria-label="Backspace"><span data-icon="backspace"></span></button>`;
          return `<button type="button" class="key" data-key="${k}">${k.toUpperCase()}</button>`;
        })
        .join("")}</div>`
  ).join("");
  hydrateIcons(kb);

  // A tap or click must not leave focus on a key, or the next Enter from a
  // physical keyboard would press that key again.
  kb.addEventListener("mousedown", (e) => {
    if (e.target.closest(".key")) e.preventDefault();
  });
  kb.addEventListener("click", (e) => {
    const key = e.target.closest(".key");
    if (key) press(key.dataset.key);
  });
}

function paintKeys() {
  const best = {};
  for (const { guess, marks } of round?.rows ?? []) {
    [...guess].forEach((ch, i) => {
      if (!best[ch] || MARK_ORDER[marks[i]] > MARK_ORDER[best[ch]]) best[ch] = marks[i];
    });
  }
  document.querySelectorAll("#keyboard .key").forEach((el) => {
    const k = el.dataset.key;
    if (k.length !== 1) return;
    el.classList.remove("correct", "present", "absent");
    if (best[k]) el.classList.add(best[k]);
    el.setAttribute("aria-label", best[k] ? `${k.toUpperCase()}, ${MARK_WORDS[best[k]]}` : k.toUpperCase());
  });
}

// The meta row and the round's buttons.

function fillLengths() {
  const select = $("lengthSelect");
  const available = wordLengths();
  let chosen = getSettings().length;
  if (available.length && !available.includes(chosen)) {
    chosen = available.includes(DEFAULT_LENGTH) ? DEFAULT_LENGTH : available[0];
    saveSettings({ length: chosen });
  }
  const options = available.length ? available : [chosen];
  select.innerHTML = options.map((n) => `<option value="${n}">${n} letters, ${triesFor(n)} tries</option>`).join("");
  select.value = String(chosen);
}

function renderMeta() {
  const ranked = round.mode === "ranked";
  $("modeChip").textContent = ranked ? "Ranked" : "Practice";
  $("modeChip").classList.toggle("practice", !ranked);
  $("modeChip").title = ranked ? "Can go on the leaderboard" : "Played in this browser. Cannot go on the leaderboard.";
  $("hardChip").classList.toggle("hidden", !round.hard_mode);
  // Points so far, for a live ranked round. Practice rounds score nothing,
  // and a finished round's score is on the result instead.
  const points = ranked && isLive(round) ? tally(round.rows, round.tries) : null;
  $("scoreChip").classList.toggle("hidden", points === null);
  if (points !== null) $("scoreChip").textContent = `${points} points`;
}

function renderActions() {
  const started = isLive(round) && round.rows.length > 0;
  const btn = $("newBtn");
  btn.disabled = busy;
  btn.classList.toggle("armed", Boolean(giveUpTimer));
  $("newLabel").textContent = !started ? "New word" : giveUpTimer ? "Tap again to give up" : "Give up";
  const iconEl = $("newIcon");
  iconEl.setAttribute("data-icon", started ? "flag" : "refresh");
  hydrateIcons(btn);
}

function disarmGiveUp() {
  clearTimeout(giveUpTimer);
  giveUpTimer = null;
}

// Input.

function press(key) {
  if (!isLive(round) || busy) return;
  if (key === "enter") {
    submitGuess();
    return;
  }
  if (key === "back") {
    if (!typed) return;
    typed = typed.slice(0, -1);
    paintTyping();
    return;
  }
  if (/^[a-z]$/.test(key) && typed.length < round.length) {
    typed += key;
    say("");
    paintTyping(typed.length - 1);
  }
}

function onKeyDown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || isModalOpen()) return;
  if ($("play").classList.contains("hidden") || !isLive(round)) return;

  const target = e.target;
  // Typing a name, or picking a length: not a guess.
  if (target.closest?.("input, textarea, select")) return;
  // Enter on a focused button presses that button, unless a guess is being
  // typed: then it sends the guess, which is what somebody typing means.
  if (target.closest?.("button, a") && !target.closest(".key") && e.key === "Enter" && !typed) return;

  let key = null;
  if (e.key === "Enter") key = "enter";
  else if (e.key === "Backspace") key = "back";
  else if (/^[a-z]$/i.test(e.key)) key = e.key.toLowerCase();
  if (!key) return;

  e.preventDefault();
  press(key);
}

function reject(message) {
  say(message, "miss");
  shakeRow();
}

function failed(err) {
  if (GONE.has(err.code)) return roundGone();
  say(
    err.code === "offline"
      ? "No connection, so nothing was sent. Try again once you are back online."
      : err.code === "busy"
        ? err.message
        : "The game server did not answer. Try again in a moment.",
    "error"
  );
}

async function submitGuess() {
  const guess = typed;
  if (guess.length < round.length) return reject(`This word has ${round.length} letters.`);
  if (wordsReady() && !isWord(guess)) return reject("Not in the word list.");
  if (round.hard_mode) {
    const problem = hardModeProblem(guess, round.rows);
    if (problem) return reject(`Hard mode: ${problem}`);
  }

  busy = true;
  disarmGiveUp();
  renderActions();
  const before = tally(round.rows, round.tries);
  try {
    if (round.mode === "ranked") {
      round = fromView(await api.guess(round.id, guess));
    } else {
      round.rows.push({ guess, marks: evaluate(guess, round.secret) });
      if (guess === round.secret) {
        round.solved = true;
        round.score = scoreRound(round.rows, round.length, round.tries, true);
      } else if (round.rows.length >= round.tries) {
        round.lost = true;
      }
    }
  } catch (err) {
    busy = false;
    renderActions();
    // The server's own word, for a guess it refused: not in its list, or
    // against hard mode.
    if (err.status === 400 && err.message && err.message !== err.code) return reject(err.message);
    return failed(err);
  }

  typed = "";
  save();
  const r = round.rows.length - 1;
  await reveal(r);
  paintKeys();
  announce(`Guess ${r + 1}: ${describeRow(round.rows[r])}.`);
  busy = false;

  if (!isLive(round)) {
    finish();
    return;
  }
  paintTyping();
  renderActions();
  renderMeta();
  const gained = round.mode === "ranked" ? tally(round.rows, round.tries) - before : 0;
  const left = round.tries - round.rows.length;
  // "+150 points", "Last guess." or "+150 points, last guess".
  say(
    gained > 0 && left === 1
      ? `+${gained} points, last guess`
      : gained > 0
        ? `+${gained} points`
        : left === 1
          ? "Last guess."
          : ""
  );
}

// Giving up takes two taps, so a stray one does not end the round.
function onNewOrGiveUp() {
  if (busy || !isLive(round)) return;
  if (!round.rows.length) {
    newRound();
    return;
  }
  if (!giveUpTimer) {
    giveUpTimer = setTimeout(() => {
      disarmGiveUp();
      renderActions();
    }, 3000);
    renderActions();
    return;
  }
  disarmGiveUp();
  giveUp();
}

async function giveUp() {
  busy = true;
  renderActions();
  try {
    if (round.mode === "ranked") {
      round = fromView(await api.giveUp(round.id));
    } else {
      Object.assign(round, { gave_up: true, lost: true, answer: round.secret });
    }
  } catch (err) {
    busy = false;
    if (err.code !== "offline") {
      renderActions();
      return failed(err);
    }
    // Offline in a ranked round. It ends here, counted as a loss, and the
    // server counts it the same way the next time a round is started.
    Object.assign(round, { gave_up: true, lost: true, answer: null });
  }
  busy = false;
  finish();
}

// The end of a round.

function finish() {
  disarmGiveUp();
  store.remove(ROUND_STORAGE);
  if (!round.recorded) {
    round.recorded = true;
    recordLocal({ won: round.solved, guesses: round.rows.length });
  }

  const n = round.rows.length;
  const ranked = round.mode === "ranked";
  const answer = (round.answer ?? round.secret ?? "").toUpperCase();

  $("resultTitle").textContent = round.solved
    ? `Solved in ${n} ${n === 1 ? "guess" : "guesses"}`
    : answer
      ? `It was ${answer}`
      : "Round over";
  const flagged = ranked && round.solved && round.leaderboard_ok === false;
  // "points" never ends a sentence with a full stop.
  $("resultScore").textContent = round.solved
    ? ranked
      ? flagged
        ? `${round.score} points, but guesses came in faster than a person can play, so this round cannot go on the leaderboard.`
        : `${round.score} points`
      : "A practice round, so no points"
    : answer
      ? "No points this round."
      : "You are offline, so the answer cannot be shown. No points this round.";

  const prefs = getSettings();
  const canSubmit = ranked && round.solved && !flagged;
  $("submitForm").classList.toggle("hidden", !canSubmit);
  $("submitted").classList.add("hidden");
  $("submitMsg").textContent = "";
  $("nameInput").value = prefs.name ?? "";
  $("submitBtn").disabled = false;

  $("keyboard").classList.add("hidden");
  $("roundActions").classList.add("hidden");
  $("scoreChip").classList.add("hidden");
  $("result").classList.remove("hidden");
  paintTyping();
  say("");
  $("resultTitle").focus();

  if (canSubmit && prefs.auto_submit && prefs.name) submitAs(prefs.name, true);
}

// Adds the round under a name, typed or saved. Any name that goes through
// becomes the saved one.
async function submitAs(name, auto = false) {
  const msg = $("submitMsg");
  $("submitBtn").disabled = true;
  msg.textContent = auto ? `Adding as ${name}.` : "";
  try {
    const r = await api.submit(round.id, name);
    saveSettings({ name: r.name });
    const rounds = r.rounds === 1 ? "1 round" : `${r.rounds} rounds`;
    $("submittedText").textContent =
      `Added as ${r.name}. Best score ${r.best_score}, ranked ${r.rank}. ` +
      `Total ${r.total} over ${rounds}, ranked ${r.total_rank}.`;
    $("submitForm").classList.add("hidden");
    $("submitted").classList.remove("hidden");
  } catch (err) {
    if (err.code === "offline") msg.textContent = "No connection. Try again once you are back online.";
    else if (auto && err.status === 400) msg.textContent = "Your saved name was refused, so this round was not added. Change it in Settings.";
    else if (auto && err.status !== 409 && err.status !== 410) msg.textContent = "This round could not be added automatically. Try the button.";
    else msg.textContent = err.message || "That did not go through. Try again in a moment.";
    if (["already_submitted", "expired", "flagged"].includes(err.code)) $("submitForm").classList.add("hidden");
    else $("submitBtn").disabled = false;
  }
}

function onSubmit(event) {
  event.preventDefault();
  const name = $("nameInput").value.trim();
  if (!name) {
    $("submitMsg").textContent = "Enter a name.";
    $("nameInput").focus();
    return;
  }
  submitAs(name);
}

// Starting and resuming.

function begin(r) {
  round = r;
  typed = "";
  disarmGiveUp();
  $("result").classList.add("hidden");
  $("keyboard").classList.remove("hidden");
  $("roundActions").classList.remove("hidden");
  buildBoard();
  paintKeys();
  renderMeta();
  renderActions();
  save();
  say("");
  announce("");
  showPanel("play");
}

function showNotice(text, iconName, { label = "Try again", practice = false } = {}) {
  $("notice").dataset.kind = iconName;
  $("noticeIcon").setAttribute("data-icon", iconName);
  hydrateIcons($("notice"));
  $("noticeText").textContent = text;
  $("noticeBtnLabel").textContent = label;
  $("practiceBtn").classList.toggle("hidden", !practice);
  showPanel("notice");
}

function roundGone() {
  if (isLive(round) && round.rows.length && !round.recorded) {
    round.recorded = true;
    recordLocal({ won: false, guesses: round.rows.length });
  }
  store.remove(ROUND_STORAGE);
  round = null;
  showNotice("That round is over.", "flag", { label: "New round" });
}

async function newRound({ practiceOnly = false } = {}) {
  if (busy) return;
  busy = true;
  $("playAgainBtn").disabled = true;
  if (round) renderActions();

  const { length, hard_mode } = getSettings();
  let next = null;
  let why = null;

  if (!practiceOnly) {
    try {
      next = fromView(await api.newRound(length, hard_mode));
    } catch (err) {
      why = err;
    }
  }
  if (!next) {
    try {
      await loadWords();
    } catch {
      // Handled below: no word list, no practice round.
    }
    next = practiceRound(length, hard_mode) ?? practiceRound(DEFAULT_LENGTH, hard_mode);
  }

  busy = false;
  $("playAgainBtn").disabled = false;

  if (!next) {
    showNotice("The word list did not load, so there is nothing to play offline. Reload to try again.", "offline");
    return;
  }
  begin(next);
  if (why) {
    say(
      why.code === "offline"
        ? "You are offline, so this is a practice round. It will not go on the leaderboard."
        : "The game server did not answer, so this is a practice round. It will not go on the leaderboard."
    );
  } else if (practiceOnly) {
    say("A practice round. It will not go on the leaderboard.");
  }
}

// A ranked round left open in this browser, with no connection to carry it
// on. The player can wait, or play practice rounds meanwhile; the ranked
// round then counts as a loss if it had a guess in it.
function pendingOffline(saved) {
  round = null;
  showNotice(
    "Your ranked round needs a connection to carry on. Wait until you are back online, or play a practice round instead.",
    "offline",
    { practice: true }
  );
  $("practiceBtn").onclick = () => {
    if (saved.guesses > 0) recordLocal({ won: false, guesses: saved.guesses });
    store.remove(ROUND_STORAGE);
    newRound({ practiceOnly: true });
  };
}

async function resumeOrStart() {
  const saved = store.getJson(ROUND_STORAGE);

  if (saved?.mode === "practice") {
    const r = restorePractice(saved);
    if (isLive(r)) return begin(r);
  } else if (saved?.mode === "ranked" && typeof saved.id === "string") {
    try {
      const r = fromView(await api.state(saved.id));
      if (isLive(r) && !r.expired) return begin(r);
      // Left too long with a guess in it: the server has it as a loss.
      if (isLive(r) && r.rows.length) recordLocal({ won: false, guesses: r.rows.length });
    } catch (err) {
      if (err.code === "offline") return pendingOffline(saved);
    }
  }

  store.remove(ROUND_STORAGE);
  await newRound();
}

let starting = false;

async function start() {
  if (starting) return;
  starting = true;
  $("noticeBtn").disabled = true;
  try {
    if (!round) await resumeOrStart();
    else await newRound();
  } finally {
    starting = false;
    $("noticeBtn").disabled = false;
  }
}

function onLengthChange(e) {
  const length = Number(e.target.value);
  // Letters typed next are a guess, not a search through the list.
  e.target.blur();
  saveSettings({ length });
  if (isLive(round) && round.rows.length === 0 && !busy) {
    newRound();
    return;
  }
  if (isLive(round)) say(`${length} letters from the next round.`);
}

export function initGame() {
  buildKeyboard();
  fillLengths();
  // Needed for practice rounds and for checking guesses before sending;
  // a ranked round can start without it.
  loadWords().then(fillLengths, (err) => console.warn(err));

  document.addEventListener("keydown", onKeyDown);
  $("newBtn").addEventListener("click", onNewOrGiveUp);
  // As with the keys: a click leaves focus where it was.
  $("newBtn").addEventListener("mousedown", (e) => e.preventDefault());
  $("lengthSelect").addEventListener("change", onLengthChange);
  $("submitForm").addEventListener("submit", onSubmit);
  $("playAgainBtn").addEventListener("click", () => newRound());
  $("resultBoardBtn").addEventListener("click", () => openLeaderboard());
  $("resultStatsBtn").addEventListener("click", () =>
    openStats(round?.mode === "ranked" ? "ranked" : "local", round?.solved ? round.rows.length : null)
  );
  $("noticeBtn").addEventListener("click", start);

  window.addEventListener("online", () => {
    const notice = $("notice");
    if (!notice.classList.contains("hidden") && notice.dataset.kind === "offline") start();
  });

  start();
}
