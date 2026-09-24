// Ranked round rules on the server. The rules themselves are js/rules.js,
// shared with the page's practice rounds; this adds what only the server
// may do: pick the answer, keep it, and check guesses against it.

import { DEFAULT_LENGTH, MAX_GUESSES, evaluate, hardModeProblem, normaliseWord, scoreFor } from "../../js/rules.js";
import { HttpError } from "./http.js";
import { rest } from "./supabase.js";
import { hasWord, pickWord, wordLengths } from "./words.js";

// A round can be played, and a solved one submitted, for a day. Left with a
// guess in it past that, it counts as a loss in the player's stats.
export const ROUND_TTL_MS = 24 * 60 * 60 * 1000;

// Anti-cheat. Between one guess and the next a person reads the reply and
// types a word and Enter; a script sends in milliseconds. A guess that
// arrives sooner than this after the round started, or after the previous
// guess, flags the round: it plays on and counts in stats, but cannot go on
// the leaderboard. Refusing the guess instead would only teach a script to
// wait; flagging keeps the check quiet.
//
// Half a second, not more: a fast typist with a memorised opener, or with
// reduced motion on so no tiles flip, can send a planned word in well under
// a second, and must not be flagged for it.
export const FASTEST_GUESS_MS = 500;

const finished = (round) => round.solved || round.lost;
const expired = (round, now) => now - Date.parse(round.created_at) > ROUND_TTL_MS;

export function checkLength(value) {
  const length = value === undefined || value === null ? DEFAULT_LENGTH : Number(value);
  const lengths = wordLengths();
  if (!Number.isInteger(length) || !lengths.includes(length)) {
    throw new HttpError(400, "bad_length", `Pick a word length from ${lengths[0]} to ${lengths.at(-1)}.`);
  }
  return length;
}

// Recent answers for this player at this length are skipped, so replays
// do not repeat.
export async function pickAnswer(clientKey, length) {
  const recent = await rest(
    `wordle_rounds?select=answer&client_key=eq.${encodeURIComponent(clientKey)}&length=eq.${length}&order=created_at.desc&limit=50`
  );
  return pickWord(length, new Set((recent ?? []).map((r) => r.answer)));
}

export function assertPlayable(round, now = Date.now()) {
  if (finished(round)) throw new HttpError(409, "round_over", "This round is already over.");
  if (expired(round, now)) throw new HttpError(410, "round_expired", "This round has expired. Start a new one.");
}

// `at` is when the request arrived, taken once before any retry. The round's
// created_at is the database's clock and `at` is this function's; both are
// NTP synced, and the skew is far below FASTEST_GUESS_MS.
export function applyGuess(round, text, at = Date.now()) {
  const guess = normaliseWord(text);
  if (!/^[a-z]+$/.test(guess) || guess.length !== round.length) {
    throw new HttpError(400, "wrong_length", `This word has ${round.length} letters.`);
  }
  if (!hasWord(guess)) throw new HttpError(400, "not_in_list", "Not in the word list.");
  if (round.hard_mode) {
    const problem = hardModeProblem(guess, rowsOf(round));
    if (problem) throw new HttpError(400, "hard_mode", `Hard mode: ${problem}`);
  }

  // Only guesses that count are timed: a refused one never reaches here.
  const times = round.guess_times ?? [];
  const previous = Date.parse(times.at(-1) ?? round.created_at);
  if (at - previous < FASTEST_GUESS_MS) round.flag ??= "too_fast";
  round.guess_times = [...times, new Date(at).toISOString()];

  round.guesses = [...round.guesses, guess];
  if (guess === round.answer) {
    round.solved = true;
    round.score = scoreFor(round.guesses.length);
    round.finished_at = new Date().toISOString();
  } else if (round.guesses.length >= MAX_GUESSES) {
    round.lost = true;
    round.score = 0;
    round.finished_at = new Date().toISOString();
  }
}

export function applyGiveUp(round) {
  round.gave_up = true;
  round.lost = true;
  round.score = 0;
  round.finished_at = new Date().toISOString();
}

const rowsOf = (round) => round.guesses.map((guess) => ({ guess, marks: evaluate(guess, round.answer) }));

// What a client may see. The answer only appears once the round is over.
export function view(round, now = Date.now()) {
  const over = finished(round);
  const out = {
    round_id: round.id,
    length: round.length,
    max_guesses: MAX_GUESSES,
    hard_mode: round.hard_mode,
    rows: rowsOf(round),
    solved: round.solved,
    lost: round.lost,
    gave_up: round.gave_up,
    score: round.score,
    expired: !over && expired(round, now),
    created_at: round.created_at,
  };
  if (over) {
    out.answer = round.answer;
    // Told only once nothing can change, so it cannot be watched for while
    // playing. The page uses it to say why there is no leaderboard form.
    out.leaderboard_ok = round.solved && !round.flag;
  }
  return out;
}

const WRITABLE = ["guesses", "guess_times", "flag", "solved", "lost", "gave_up", "score", "finished_at"];

export async function loadRound(id, clientKey) {
  const rows = await rest(`wordle_rounds?id=eq.${id}&select=*`);
  const round = rows?.[0];
  // Someone else's round reads as no round at all.
  if (!round || round.client_key !== clientKey) throw new HttpError(404, "round_not_found");
  return round;
}

// Load, change, write back only if nobody else wrote in between; otherwise
// start again from the fresh row. `change` returns { write: false } to skip
// the write.
export async function updateRound(id, clientKey, change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const round = await loadRound(id, clientKey);
    const result = change(round);
    if (result?.write === false) return { round, result };

    const patch = Object.fromEntries(WRITABLE.map((k) => [k, round[k]]));
    patch.version = round.version + 1;
    const saved = await rest(`wordle_rounds?id=eq.${id}&version=eq.${round.version}`, {
      method: "PATCH",
      body: patch,
      prefer: "return=representation",
    });
    if (saved?.length) return { round: saved[0], result };
  }
  throw new HttpError(409, "busy", "That round is busy. Try again.");
}
