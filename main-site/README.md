# main-site

What Vercel deploys, served at <https://wordle.uwuapps.org>. No build step:
these files are served as they are, and `api/` holds the serverless
functions.

| Path | What it is |
| --- | --- |
| `index.html` | The game page. Its `<head>` is the template every other page copies. |
| `404.html`, `404.css` | Not-found page. Not yet on the theme system. |
| `sw.js` | Service worker: the offline shell, and the update bar's waiting worker. |
| `manifest.json` | PWA manifest. |
| `wordlist.json` | Every word, grouped by length. Answers and valid guesses for both round types. |
| `api/` | The game API, the only place ranked rounds are judged. |
| `css/` | `theme.css` is the uwuapps theme system verbatim; `style.css` is this app, using theme tokens only. |
| `js/` | ES modules, with `app.js` as the entry point. Every file here must be in `PRECACHE` in `sw.js`. |
| `images/` | Manifest screenshots. |

## The page

The page opens on a round: a board, a keyboard and nothing to read first. A
chip says whether it is **Ranked** or **Practice**, and the length picker next
to it sets 4 to 14 letters. With no guess made, a new length starts a new
round straight away; mid-round, it applies from the next one. Hard mode shows
as a second chip.

A finished ranked round that was solved can go on the leaderboard under a
name. The top bar opens How to play, Stats, the Leaderboard, Settings and
Theme.

| Module | What it does |
| --- | --- |
| `app.js` | Boot, and the theme modal wiring. |
| `game.js` | The board, keyboard, ranked and practice rounds, resuming, giving up and the result. |
| `rules.js` | Marking a guess, hard mode, scoring, reading the word list. Shared with `api/`. |
| `words.js` | Loads `wordlist.json` for practice rounds and checking guesses before they are sent. |
| `api.js` | Calls to `/api/`, and this browser's random `client_key`. |
| `stats.js` | The stats window: this device's record and the ranked one from the database. |
| `leaderboard.js` | The leaderboard window, both boards. |
| `settings.js` | The settings window and the settings themselves. |
| `theme.js` | The theme system with time-based mode, from `uwuapps-theme.md`, `APP_KEY` "wordle". |
| `icons.js` | Inline SVG icons. No emoji and no icon font. |
| `ui.js` | Icon hydration, modals, HTML escaping, local storage that never throws. |
| `update-bar.js` | Service worker registration and the update bar. |

## Settings

Kept in this browser's local storage, under `wordle.settings`.

| Setting | Default | What it does |
| --- | --- | --- |
| Leaderboard name | not set | Checked by `/api/leaderboard/name`; also saved by every successful submit. |
| Add solved rounds automatically | off | Submits every solved ranked round under the saved name. Needs a name; clearing it turns this off. |
| Hard mode | off | Green letters stay in place and gold letters must be used again. Fixed per round from when it starts; checked by the API for ranked rounds. |
| Word length | 5 | Set from the game card. |

## Stats

Two records in the stats window:

- **This device**: every round finished in this browser, practice included,
  under `wordle.stats` in local storage.
- **Ranked**: every ranked round this browser has played, worked out by
  `wordle_stats()` in the database from `wordle_rounds`. A round counts once
  it is solved or lost, or once it is a day old with a guess in it.

Both show played, win rate, current and best streak, and how many guesses
each win took.

## API

All take and return JSON. Round endpoints need `client_key`, a random id the
browser keeps in local storage. A round is only visible to the key that
started it, and the answer is only in a reply once the round is over.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/round/new` | `client_key, length?, hard_mode?` | the round view |
| `POST /api/round/guess` | `round_id, client_key, guess` | the round view, with the new row |
| `POST /api/round/state` | `round_id, client_key` | the round view |
| `POST /api/round/giveup` | `round_id, client_key` | the round view, with `answer` |
| `POST /api/leaderboard/submit` | `round_id, client_key, name` | `name, rank, best_score, total, rounds, total_rank` |
| `POST /api/leaderboard/name` | `name` | `name`, cleaned, or a `400` saying why not |
| `GET /api/leaderboard` | `?board=best` (default) or `?board=total` | `board, entries`, cached 30 s |
| `POST /api/stats` | `client_key` | `played, wins, current_streak, best_streak, distribution` |

The round view:

```json
{
  "round_id": "…",
  "length": 5,
  "max_guesses": 6,
  "hard_mode": false,
  "rows": [{ "guess": "crane", "marks": ["absent", "present", "correct", "absent", "absent"] }],
  "solved": false,
  "lost": false,
  "gave_up": false,
  "score": 0,
  "expired": false,
  "created_at": "…"
}
```

Errors are `{ "error": code, "message"? }` with a matching status: `400` bad
input or a guess the rules refuse (`wrong_length`, `not_in_list`,
`hard_mode`, each with a message to show), `404` no such round, `409` round
over, busy or flagged, `410` round or submission more than a day old, `503`
Supabase not configured.

Once a round is over the view also has `answer`, and `leaderboard_ok`: false
on a solved round means the anti-cheat flagged it.

## Anti-cheat

Kept simple, and all on the server:

- The answer is never in a reply while the round is live, and the score is
  read from the round, never from a request.
- Every guess's arrival time is kept in `guess_times`. A guess that arrives
  less than `FASTEST_GUESS_MS` (500 ms, in `_lib/game.js`) after the round
  started or after the previous guess sets `flag = 'too_fast'`. People read
  and type; scripts do not. Half a second leaves room for a fast typist with
  a memorised opener, or with reduced motion on.
- A flagged round is not refused or slowed: it plays on and counts in the
  player's stats, so a script learns nothing mid-round. It only cannot be
  submitted, and the result says why.
- Submitting needs the `client_key` that played the round. Another browser's
  round reads as `404`.

There is no rate limiting.

| Score | |
| --- | --- |
| Solved in 1 guess | 600 |
| Each guess after that | -100, down to 100 on the sixth |
| Lost or given up | 0, and cannot be submitted |

Leaderboard names are 20 characters at most: letters in any script, digits,
spaces, hyphens and underscores, with a word filter (`api/_lib/names.js`,
shared with MRT Station Guesser). Names are compared case-insensitively, so
anyone who picks the same name shares its entry.

| File | What it is |
| --- | --- |
| `round/*.js`, `leaderboard/*.js`, `stats.js` | The endpoints. |
| `_lib/game.js` | Ranked round rules, the speed check, the round view, optimistic updates. |
| `_lib/words.js` | `wordlist.json`, loaded with `require` so Vercel bundles it. |
| `_lib/http.js` | Input checks and error replies. |
| `_lib/names.js` | Leaderboard name cleaning and the word filter. |
| `_lib/supabase.js` | Supabase REST with the service role key. |

Vercel does not route files under `_lib/`.

## Offline

The page, its modules, the word list, the icons and the Jua font are
precached, so the site loads and plays with no connection. Offline, a new
round is a practice round. A ranked round left open when the connection went
can wait until you are back, or be swapped for practice, which counts it as a
loss if it had a guess in it. Nothing under `/api/` is ever cached.

## Updates

A new service worker installs and waits. The update bar at the top of the
page offers Reload or Not now, and nothing reloads until the reader asks. See
`update-bar-spec.md` at the repo root.

Bump `VERSION` in `sw.js` on every change to anything in this directory.

## Environment variables (Vercel)

Documented in `.env.example`. `.vercelignore` keeps every env file out of
deployments, since anything in this directory would otherwise be served.

| Variable | Used for |
| --- | --- |
| `SUPABASE_URL` | The shared uwuapps project. |
| `SUPABASE_SERVICE_KEY` | Service role key. Server side only, never sent to a browser. |
