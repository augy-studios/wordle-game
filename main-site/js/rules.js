// The game rules, in one place. The API imports this file for ranked rounds
// and the page imports it for practice rounds, so the two cannot drift.
// No DOM and no Node APIs here: it has to run in both.

export const MAX_GUESSES = 6;
export const DEFAULT_LENGTH = 5;

// Solved on the first guess is 600, on the sixth 100. A lost round is 0.
export function scoreFor(guessCount) {
  return (MAX_GUESSES + 1 - guessCount) * 100;
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
