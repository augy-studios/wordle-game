// The game rules, in one place. The API imports this file for ranked rounds
// and the page imports it for practice rounds, so the two cannot drift.
// No DOM and no Node APIs here: it has to run in both.

export const MIN_GUESSES = 6;
export const DEFAULT_LENGTH = 5;

// One more try than the word has letters, never fewer than six. But only
// where the word list has more words of that length than there would be
// tries: otherwise a player could simply guess every word there is, so the
// length stays at six. `poolSize` is how many words of that length exist.
// A round's tries are fixed when it starts and kept with it.
export function maxGuesses(length, poolSize) {
  return poolSize > length + 1 ? Math.max(MIN_GUESSES, length + 1) : MIN_GUESSES;
}

// What a guess is worth: the first is times the number of tries, the last
// times 1.
export function multiplier(guessNumber, tries) {
  return tries - guessNumber + 1;
}

// Scoring. Every letter of the answer is worth two finds: one for knowing it
// is in the word (green or gold), one for knowing where (green). Each find
// is paid once, at the multiplier of the guess that made it, so a gold that
// later turns green earns its second half then, at a lower multiplier.
// Solving adds the whole word again at the solving guess's multiplier.
//
// So each letter earns at most 2 x FIND_POINTS x the first multiplier, and
// only by being green on the first guess; and the bonus is also biggest on
// the first guess. Solving on the first try is always the highest score,
// and longer words, with more letters and more tries, score more.
export const FIND_POINTS = 10;
export const SOLVE_POINTS = 20;

// Points from finds so far, without the solving bonus. `rows` are
// { guess, marks }, in order; `tries` is the round's number of tries.
export function tally(rows, tries) {
  const known = {};
  const placed = new Set();
  let total = 0;

  rows.forEach(({ guess, marks }, i) => {
    const found = {};
    let newlyPlaced = 0;
    [...guess].forEach((ch, p) => {
      if (marks[p] !== "absent") found[ch] = (found[ch] ?? 0) + 1;
      if (marks[p] === "correct" && !placed.has(p)) {
        placed.add(p);
        newlyPlaced++;
      }
    });
    // A letter the answer has twice is known twice only once a guess shows
    // both; each guess's marks never show more copies than the answer has.
    let newlyKnown = 0;
    for (const [ch, n] of Object.entries(found)) {
      if (n > (known[ch] ?? 0)) {
        newlyKnown += n - (known[ch] ?? 0);
        known[ch] = n;
      }
    }
    total += FIND_POINTS * (newlyKnown + newlyPlaced) * multiplier(i + 1, tries);
  });
  return total;
}

// The round's score. A lost round is 0, whatever it found on the way.
export function scoreRound(rows, length, tries, solved) {
  if (!solved) return 0;
  return tally(rows, tries) + SOLVE_POINTS * length * multiplier(rows.length, tries);
}

// The highest score a round allows: solved on the first guess.
export function bestScore(length, tries) {
  return (2 * FIND_POINTS + SOLVE_POINTS) * length * tries;
}

// "correct", "present" or "absent" per letter. A repeated letter is only
// marked as often as the answer has it, greens first.
export function evaluate(guess, answer) {
  const marks = Array(guess.length).fill("absent");
  const left = {};

  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) marks[i] = "correct";
    else left[answer[i]] = (left[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < guess.length; i++) {
    if (marks[i] === "correct") continue;
    if (left[guess[i]] > 0) {
      marks[i] = "present";
      left[guess[i]]--;
    }
  }
  return marks;
}

// Hard mode: a green letter stays where it was found, and every gold letter
// is used again. Returns why a guess breaks that, or null if it does not.
// `rows` are the earlier guesses, each { guess, marks }.
export function hardModeProblem(guess, rows) {
  const fixed = [];
  const needed = {};

  for (const { guess: g, marks } of rows) {
    const found = {};
    [...g].forEach((ch, i) => {
      if (marks[i] === "correct") fixed[i] = ch;
      if (marks[i] !== "absent") found[ch] = (found[ch] ?? 0) + 1;
    });
    for (const [ch, n] of Object.entries(found)) needed[ch] = Math.max(needed[ch] ?? 0, n);
  }

  for (let i = 0; i < fixed.length; i++) {
    if (fixed[i] && guess[i] !== fixed[i]) return `Letter ${i + 1} must be ${fixed[i].toUpperCase()}.`;
  }
  for (const [ch, n] of Object.entries(needed)) {
    const used = [...guess].filter((c) => c === ch).length;
    if (used < n) return n > 1 ? `Use ${ch.toUpperCase()} ${n} times.` : `Use the ${ch.toUpperCase()} you found.`;
  }
  return null;
}

export function normaliseWord(text) {
  return String(text ?? "").trim().toLowerCase();
}

// The word list, grouped by length. Takes either shape wordlist.json has
// had: { "5": [...], "6": [...] } or a flat array. Anything that is not
// plain a to z is dropped.
export function indexWords(raw) {
  const all = Array.isArray(raw) ? raw : Object.values(raw ?? {}).flat();
  const byLength = new Map();
  for (const item of all) {
    const word = normaliseWord(item);
    if (!/^[a-z]+$/.test(word)) continue;
    if (!byLength.has(word.length)) byLength.set(word.length, new Set());
    byLength.get(word.length).add(word);
  }
  return new Map(
    [...byLength.entries()]
      .sort(([a], [b]) => a - b)
      .map(([length, set]) => [length, { set, list: [...set] }])
  );
}
