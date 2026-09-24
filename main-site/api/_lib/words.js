// The word list, server side. The same wordlist.json the page precaches,
// read once per warm instance. require() rather than a fetch or a file read
// by computed path, so Vercel's file tracing bundles it with the functions.

import { createRequire } from "node:module";
import { randomInt } from "node:crypto";
import { indexWords } from "../../js/rules.js";

const require = createRequire(import.meta.url);
const WORDS = indexWords(require("../../wordlist.json"));

export function wordLengths() {
  return [...WORDS.keys()];
}

export function poolSize(length) {
  return WORDS.get(length)?.list.length ?? 0;
}

export function hasWord(word) {
  return WORDS.get(word.length)?.set.has(word) ?? false;
}

// A word of this length, skipping `recent` where there is anything left.
export function pickWord(length, recent = new Set()) {
  const list = WORDS.get(length)?.list ?? [];
  const pool = list.filter((w) => !recent.has(w));
  const from = pool.length ? pool : list;
  return from[randomInt(from.length)];
}
