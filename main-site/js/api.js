// The game API. For ranked rounds every rule lives on the server; this only
// carries requests.

import { store } from "./ui.js";

const KEY_STORAGE = "wordle.clientKey";

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

// A random id tying this browser's requests to its own rounds and stats.
// Not an identity: it grants nothing and is never shown.
function makeKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let memoryKey = null;

export function clientKey() {
  let key = store.get(KEY_STORAGE);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(key ?? "")) {
    key = memoryKey ?? makeKey();
    memoryKey = key;
    // If storage is blocked this keeps the key for this page view only.
    store.set(KEY_STORAGE, key);
  }
  return key;
}

async function call(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "offline", "Ranked rounds need a connection.");
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    // An HTML error page from the platform, not the API.
  }
  if (!response.ok) {
    throw new ApiError(response.status, data?.error ?? "server", data?.message);
  }
  return data;
}

const round = (path, roundId, extra = {}) =>
  call("POST", `/api/round/${path}`, { round_id: roundId, client_key: clientKey(), ...extra });

export const api = {
  newRound: (length, hardMode) =>
    call("POST", "/api/round/new", { client_key: clientKey(), length, hard_mode: hardMode }),
  state: (roundId) => round("state", roundId),
  guess: (roundId, guess) => round("guess", roundId, { guess }),
  giveUp: (roundId) => round("giveup", roundId),
  checkName: (name) => call("POST", "/api/leaderboard/name", { name }),
  submit: (roundId, name) => call("POST", "/api/leaderboard/submit", { round_id: roundId, name }),
  leaderboard: (board) => call("GET", `/api/leaderboard?board=${encodeURIComponent(board)}`),
  stats: () => call("POST", "/api/stats", { client_key: clientKey() }),
};
