// The word list, for practice rounds and for checking a guess before it is
// sent. Precached by sw.js, so it loads offline.

import { indexWords, maxGuesses } from "./rules.js";

const URL = "/wordlist.json";

let words = null;
let loading = null;

export function loadWords() {
  loading ??= fetch(URL)
    .then((response) => {
      if (!response.ok) throw new Error(`word list: ${response.status}`);
      return response.json();
    })
    .then((raw) => {
      words = indexWords(raw);
      if (!words.size) throw new Error("word list: empty");
      return words;
    })
    .catch((err) => {
      // Let the next call try again rather than caching the failure.
      loading = null;
      throw err;
    });
  return loading;
}

export const wordsReady = () => words !== null;

export function wordLengths() {
  return words ? [...words.keys()] : [];
}

// A new practice round's tries, from the word list: see maxGuesses. Six
// until the list has loaded.
export function triesFor(length) {
  return maxGuesses(length, words?.get(length)?.list.length ?? 0);
}

export function isWord(word) {
  return words?.get(word.length)?.set.has(word) ?? false;
}

export function randomWord(length) {
  const list = words?.get(length)?.list;
  if (!list?.length) return null;
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return list[n % list.length];
}
