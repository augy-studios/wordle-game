#!/usr/bin/env node
// The game rules in main-site/js/rules.js, which ranked and practice rounds
// share. Repeated letters and hard mode are the parts that go quietly wrong.
//
// Run: node scripts/check-rules.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bestScore, evaluate, hardModeProblem, indexWords, maxGuesses, scoreRound, tally } from "../main-site/js/rules.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "main-site");
const failures = [];

function same(label, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const C = "correct";
const P = "present";
const A = "absent";

same("all right", evaluate("crane", "crane"), [C, C, C, C, C]);
same("none", evaluate("fjord", "sweat"), [A, A, A, A, A]);
// One L in the answer: only the first L gets gold, the second grey.
same("repeat in guess", evaluate("llama", "world"), [P, A, A, A, A]);
// Both of the answer's Ls are green, so the guess's third L is grey.
same("repeat, greens first", evaluate("lolly", "hello"), [A, P, C, C, A]);
same("green then golds", evaluate("hotel", "hello"), [C, P, A, P, P]);
same("present then absent", evaluate("speed", "abide"), [A, A, P, A, P]);

// Tries: letters + 1, at least 6, and 6 where the list has too few words.
same("tries 4 letters", maxGuesses(4, 3731), 6);
same("tries 5 letters", maxGuesses(5, 6587), 6);
same("tries 12 letters", maxGuesses(12, 243), 13);
same("tries 13 letters, 43 words", maxGuesses(13, 43), 14);
same("tries 14 letters, 10 words", maxGuesses(14, 10), 6);
same("tries, pool equal to n + 1", maxGuesses(9, 10), 6);

// Scoring, worked through: answer SHINE, 6 tries.
const row = (g, a) => ({ guess: g, marks: evaluate(g, a) });
const shine = [row("crane", "shine")];
same("crane finds N, E, both placed, x6", tally(shine, 6), 4 * 10 * 6);
shine.push(row("noise", "shine"));
same("noise adds I and S, places I, x5", tally(shine, 6), 240 + 3 * 10 * 5);
shine.push(row("shine", "shine"));
same("shine adds H, places S and H, x4, plus bonus", scoreRound(shine, 5, 6, true), 390 + 3 * 10 * 4 + 20 * 5 * 4);
same("lost round scores 0", scoreRound(shine, 5, 6, false), 0);
same("repeating a guess earns nothing", tally([row("crane", "shine"), row("crane", "shine")], 6), 240);
same("first try", scoreRound([row("shine", "shine")], 5, 6, true), 1200);
same("best score", bestScore(5, 6), 1200);
same("best score, 12 letters", bestScore(12, 13), 6240);
// An anagram first (all gold) then the answer must still not beat it.
same("anagram then solve", scoreRound([row("ester", "reset"), row("reset", "reset")], 5, 6, true) < 1200, true);

const rows = [{ guess: "crane", marks: evaluate("crane", "cloth") }]; // C green, nothing else
same("hard: keeps green", hardModeProblem("clock", rows), null);
same("hard: moves green", hardModeProblem("block", rows), "Letter 1 must be C.");
const gold = [{ guess: "stare", marks: evaluate("stare", "earth") }]; // t, a, r, e gold
same("hard: drops gold", hardModeProblem("trace", gold), null);
same("hard: missing gold", hardModeProblem("tread", [{ guess: "loans", marks: evaluate("loans", "salty") }]), "Use the L you found.");
same("hard: two of a letter", hardModeProblem("sweat", [{ guess: "geese", marks: evaluate("geese", "eerie") }]), "Letter 2 must be E.");
same("hard: nothing yet", hardModeProblem("crane", []), null);

const words = indexWords({ 5: ["Crane", "crane", "ab-cd", "slate"], 4: ["word"] });
same("index groups and cleans", [...words.entries()].map(([n, w]) => [n, w.list]), [[4, ["word"]], [5, ["crane", "slate"]]]);
same("index takes a flat list", indexWords(["apple", "pear"]).get(5).list, ["apple"]);

const real = indexWords(JSON.parse(readFileSync(join(ROOT, "wordlist.json"), "utf8")));
if (!real.get(5)?.list.length) failures.push("wordlist.json has no 5 letter words");

// Over real words: no solve after the first guess reaches a first try's
// score. Seeded, so a failure repeats.
let seed = 42;
const rand = (n) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
for (const length of [4, 5, 7, 12]) {
  const list = real.get(length).list;
  const tries = maxGuesses(length, list.length);
  for (let n = 0; n < 3000; n++) {
    const answer = list[rand(list.length)];
    const k = 1 + rand(tries - 1);
    const rows = Array.from({ length: k }, () => row(list[rand(list.length)], answer)).filter((r) => r.guess !== answer);
    rows.push(row(answer, answer));
    if (rows.length > 1 && scoreRound(rows, length, tries, true) >= bestScore(length, tries)) {
      failures.push(`${rows.map((r) => r.guess).join(",")} scores ${scoreRound(rows, length, tries, true)}, first try is ${bestScore(length, tries)}`);
      break;
    }
  }
}

if (failures.length) {
  console.error("rules check failed:");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}

const sizes = [...real.entries()].map(([n, w]) => `${n}:${w.list.length}`).join(" ");
console.log(`rules ok. wordlist.json lengths ${sizes}`);
