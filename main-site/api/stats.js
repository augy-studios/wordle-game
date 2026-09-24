// POST /api/stats  { client_key }
//   -> { played, wins, current_streak, best_streak, distribution }
// Every ranked round this browser has finished, from the database.
// distribution[i] is rounds solved in i + 1 guesses. A round left with a
// guess in it, whether abandoned for a new one or left past a day, is a
// loss.

import { clientKey, endpoint } from "./_lib/http.js";
import { rpc } from "./_lib/supabase.js";

export default endpoint("POST", async ({ body }) => {
  const key = clientKey(body.client_key);
  const [row] = (await rpc("wordle_stats", { p_client_key: key })) ?? [];
  return {
    played: row?.played ?? 0,
    wins: row?.wins ?? 0,
    current_streak: row?.current_streak ?? 0,
    best_streak: row?.best_streak ?? 0,
    distribution: row?.distribution ?? [0, 0, 0, 0, 0, 0],
  };
});
