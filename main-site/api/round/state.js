// POST /api/round/state  { round_id, client_key }
// The round as it stands, for picking a round back up after a reload.

import { clientKey, endpoint, roundId } from "../_lib/http.js";
import { loadRound, view } from "../_lib/game.js";

export default endpoint("POST", async ({ body }) => {
  const id = roundId(body.round_id);
  const key = clientKey(body.client_key);
  return view(await loadRound(id, key));
});
