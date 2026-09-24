// POST /api/round/new  { client_key, length?, hard_mode? }
// Starts a ranked round. The answer stays in wordle_rounds; the reply has
// only the length and the empty board.
//
// Starting a round ends this player's other live rounds: one with a guess
// in it becomes a loss, one without is deleted. That is what makes leaving
// a round count, whichever client it was left in.

import { randomInt } from "node:crypto";
import { clientKey, endpoint, HttpError } from "../_lib/http.js";
import { checkLength, pickAnswer, view } from "../_lib/game.js";
import { rpc } from "../_lib/supabase.js";

export default endpoint("POST", async ({ body }) => {
  const key = clientKey(body.client_key);
  const length = checkLength(body.length);
  const hardMode = body.hard_mode === true;
  const answer = await pickAnswer(key, length);

  const [round] =
    (await rpc("wordle_start_round", {
      p_client_key: key,
      p_answer: answer,
      p_length: length,
      p_hard_mode: hardMode,
    })) ?? [];
  if (!round) throw new HttpError(500, "server");

  // Now and then, clear out rounds nobody ever guessed in.
  if (randomInt(50) === 0) rpc("wordle_prune", {}).catch((err) => console.warn("prune failed:", err.message));

  return view(round);
});
