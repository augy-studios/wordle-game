# Wordle

Guess the hidden word in six tries, from 4 to 14 letters. Ranked rounds go
on the leaderboard, and practice rounds work offline.

Live at <https://wordle.uwuapps.org>. A PWA and its game API, both on Vercel.

## What runs where

| Part | Runs on |
| --- | --- |
| `main-site/`, the PWA and the game API (`main-site/api/`) | Vercel, root directory `main-site` |
| Database, `wordle_*` tables | The shared uwuapps Supabase project |

## Layout

```
README.md
migrations/      SQL to run in the Supabase SQL editor
scripts/         pre-deploy checks
main-site/       the site Vercel deploys, including api/
```

The `uwuapps-*.md` and `update-bar-spec.md` files at the root are the specs
the site is built to: the theme system with time-based mode, and the update
bar.

## How a round works

**Ranked** (online): `/api/round/new` picks the word and keeps it in
`wordle_rounds`. The browser sends each guess and gets back the marks; the
answer only comes back once the round is over. A solved round scores 600 for
one guess down to 100 for six, and can be added to the leaderboard under a
name.

**Practice** (offline, or when the API does not answer): the page picks a
word from the precached `wordlist.json` and plays the same rules itself.
Practice rounds count in the device's stats but never reach the leaderboard.

Both use one rules file, `main-site/js/rules.js`, which the API imports too,
so the two cannot mark a guess differently.

**Anti-cheat.** The answer never reaches the browser during a ranked round,
and the score is worked out on the server. On top of that, the server times
every guess: one that arrives less than half a second after the round
started, or after the previous guess, is faster than a person can play, and
flags the round. A flagged round plays on and counts in stats but cannot go
on the leaderboard. Only the browser that played a round can submit it.

**Abandoning is a loss.** Starting a new ranked round ends any other live one
for that browser: one with a guess in it becomes a loss, one without is
deleted. Giving up takes two taps.

## First setup

1. Run `migrations/001_wordle_schema.sql`, then
   `migrations/002_wordle_anticheat.sql`, in the Supabase SQL editor.
2. On the Vercel project (root directory `main-site`), set `SUPABASE_URL`
   and `SUPABASE_SERVICE_KEY` for the shared uwuapps project. See
   `main-site/.env.example`.
3. Point `wordle.uwuapps.org` at the project and deploy.

Until the migration and the two variables are in place, the API answers
`503 not_configured` and every round is a practice round. Nothing breaks.

## Migrations

SQL for the shared uwuapps Supabase project, in `migrations/`. Paste each file
into the SQL editor and run it once, in number order.

**Never edit a file once it has been run.** Every change is a new file with
the next number.

| File | What it does |
| --- | --- |
| `001_wordle_schema.sql` | The rounds and leaderboard tables, both leaderboard views, and the start round, submit, stats and prune functions. |
| `002_wordle_anticheat.sql` | Guess times and a flag on each round; submit needs the playing browser's `client_key` and refuses flagged rounds. |

Every table has row level security on with no policies. Only the service role
key, used by the Vercel functions, can read or write.

## Before every deploy

1. Bump `VERSION` in `main-site/sw.js`. Without it, returning visitors keep
   the previous build and never see the update bar.
2. Run the checks, from the repo root, with Node 18 or later and no installs:

```
node scripts/check-rules.mjs
node scripts/check-sw.mjs
node scripts/check-precache.mjs
node scripts/check-theme.mjs
```

| Script | Fails when |
| --- | --- |
| `check-rules.mjs` | A rule in `js/rules.js` marks repeated letters or hard mode wrong, or `wordlist.json` has no 5 letter words. |
| `check-sw.mjs` | `skipWaiting()` or `clients.claim()` appear outside the service worker's message handler, or another update bar rule breaks. |
| `check-precache.mjs` | A `PRECACHE` entry is missing on disk, or a module, stylesheet or the word list is not precached. |
| `check-theme.mjs` | A page's pre-paint script drifts from the hours or key in `js/theme.js`. `404.html` is skipped until it is on the theme system. |

## Not done yet

- `404.html` and `404.css` are still the old template and are not on the
  theme system.
- `browserconfig.xml` names `tile.png` and `tile-wide.png`, which do not
  exist.
- `wordlist.json` is used as it is. Some common words (`hello`, `their`,
  `apple`, `happy`) are missing, so they are refused as guesses, and some
  abbreviations (`hdqrs`, `admrx`) can come up as answers.
