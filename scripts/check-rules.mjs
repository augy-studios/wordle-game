#!/usr/bin/env node
// The game rules in main-site/js/rules.js, which ranked and practice rounds
// share. Repeated letters and hard mode are the parts that go quietly wrong.
//
// Run: node scripts/check-rules.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, hardModeProblem, indexWords, scoreFor } from "../main-site/js/rules.js";

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

same("score 1", scoreFor(1), 600);
same("score 6", scoreFor(6), 100);

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

if (failures.length) {
  console.error("rules check failed:");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}

const sizes = [...real.entries()].map(([n, w]) => `${n}:${w.list.length}`).join(" ");
console.log(`rules ok. wordlist.json lengths ${sizes}`);
