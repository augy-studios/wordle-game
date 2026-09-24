// POST /api/round/guess  { round_id, client_key, guess }
// -> the round view, with the new row. A guess the rules refuse (wrong
// length, not a word, against hard mode) is a 400 that says why, and is not
// counted.

import { clientKey, endpoint, HttpError, roundId } from "../_lib/http.js";
import { applyGuess, assertPlayable, updateRound, view } from "../_lib/game.js";

export default endpoint("POST", async ({ body }) => {
  const id = roundId(body.round_id);
  const key = clientKey(body.client_key);
  const guess = typeof body.guess === "string" ? body.guess.slice(0, 64) : "";
  if (!guess.trim()) throw new HttpError(400, "empty_guess");

  const { round } = await updateRound(id, key, (round) => {
    assertPlayable(round);
    applyGuess(round, guess);
  });

  return view(round);
});
