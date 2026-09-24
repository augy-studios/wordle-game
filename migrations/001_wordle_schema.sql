-- Wordle schema, in the shared uwuapps Supabase project.
-- Paste into the Supabase SQL editor and run once.
-- Safe to run again: everything is "if not exists" or "or replace", apart
-- from the functions whose return types are dropped and made again.
--
-- Access model: only the Vercel functions touch these tables, with the
-- service role key. There is no Supabase Auth and no uwu_users here. RLS is
-- on with no policies, so an anon key reads nothing.

-- One ranked round is one game. The answer never leaves the server until
-- the round is over. Rounds are kept after they finish: they are the
-- player's stats.
create table if not exists wordle_rounds (
  id uuid primary key default gen_random_uuid(),
  client_key text not null,
  answer text not null check (answer ~ '^[a-z]+$'),
  length smallint not null check (length between 2 and 32),
  hard_mode boolean not null default false,
  guesses text[] not null default '{}',
  solved boolean not null default false,
  -- Out of guesses, given up, or abandoned for a new round.
  lost boolean not null default false,
  gave_up boolean not null default false,
  score int not null default 0,
  submitted boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Bumped on every write. Updates are conditional on it, so two requests at
  -- once cannot both add a guess to the same row.
  version int not null default 0
);

create index if not exists wordle_rounds_player
  on wordle_rounds (client_key, created_at desc);

create table if not exists wordle_leaderboard (
  id bigserial primary key,
  name text not null,
  score int not null,
  round_id uuid not null unique references wordle_rounds(id),
  created_at timestamptz not null default now()
);

create index if not exists wordle_lb_name
  on wordle_leaderboard (lower(name), score desc);

-- Each name's best score. The earliest of an equal top score wins, and the
-- casing shown is the one attached to that score.
create or replace view wordle_leaderboard_best
with (security_invoker = true) as
select distinct on (lower(name)) name, score, created_at
from wordle_leaderboard
order by lower(name), score desc, created_at asc;

-- Every submitted round's score added up per name. The casing shown is the
-- name's most recent submission. Ranked by total; ties go to fewer rounds,
-- then to whoever reached it first, which is the earlier last_at.
create or replace view wordle_leaderboard_total
with (security_invoker = true) as
select
  (array_agg(name order by created_at desc))[1] as name,
  sum(score)::bigint as total,
  count(*)::int as rounds,
  max(score) as best,
  max(created_at) as last_at
from wordle_leaderboard
group by lower(name);

alter table wordle_rounds enable row level security;
alter table wordle_leaderboard enable row level security;

-- Starts a round for a player, ending their other live rounds first. One
-- with a guess in it is a loss, so leaving a round cannot protect a streak;
-- one without is deleted, since nothing happened in it.
create or replace function wordle_start_round(p_client_key text, p_answer text, p_length int, p_hard_mode boolean)
returns setof wordle_rounds
language plpgsql
volatile
as $$
begin
  update wordle_rounds
  set lost = true, gave_up = true, score = 0, finished_at = now(), version = version + 1
  where client_key = p_client_key and not solved and not lost and cardinality(guesses) > 0;

  delete from wordle_rounds
  where client_key = p_client_key and not solved and not lost and cardinality(guesses) = 0;

  return query
  insert into wordle_rounds (client_key, answer, length, hard_mode)
  values (p_client_key, p_answer, p_length, p_hard_mode)
  returning *;
end;
$$;

-- Submits a solved round under a name the API has already validated. The
-- score is read from the round, never taken from the caller.
drop function if exists wordle_submit(uuid, text);

create function wordle_submit(p_round_id uuid, p_name text)
returns table (status text, best_score int, rank bigint, total bigint, rounds int, total_rank bigint)
language plpgsql
volatile
as $$
#variable_conflict use_column
declare
  v_round wordle_rounds%rowtype;
  v_best int;
  v_best_at timestamptz;
  v_total bigint;
  v_rounds int;
begin
  select * into v_round from wordle_rounds where id = p_round_id for update;

  if not found then
    return query select 'not_found'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;
  if not v_round.solved then
    return query select 'unfinished'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;
  if v_round.submitted then
    return query select 'already_submitted'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;
  if v_round.created_at < now() - interval '24 hours' then
    return query select 'expired'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;

  update wordle_rounds set submitted = true where id = p_round_id;
  insert into wordle_leaderboard (name, score, round_id)
  values (p_name, v_round.score, p_round_id);

  select l.score, l.created_at into v_best, v_best_at
  from wordle_leaderboard l
  where lower(l.name) = lower(p_name)
  order by l.score desc, l.created_at asc
  limit 1;

  select sum(l.score)::bigint, count(*)::int into v_total, v_rounds
  from wordle_leaderboard l
  where lower(l.name) = lower(p_name);

  return query
  select
    'ok'::text,
    v_best,
    (
      select count(*) + 1
      from wordle_leaderboard_best b
      where b.score > v_best or (b.score = v_best and b.created_at < v_best_at)
    ),
    v_total,
    v_rounds,
    (
      select count(*) + 1
      from wordle_leaderboard_total t
      where lower(t.name) <> lower(p_name)
        and (
          t.total > v_total
          or (t.total = v_total and t.rounds < v_rounds)
          -- This name's total was only just reached, so an equal one got there first.
          or (t.total = v_total and t.rounds = v_rounds)
        )
    );
end;
$$;

-- A player's record over every ranked round they have finished. A round
-- counts once it is solved or lost, or once it is a day old with a guess in
-- it. distribution[n] is rounds solved in n guesses.
drop function if exists wordle_stats(text);

create function wordle_stats(p_client_key text)
returns table (played int, wins int, current_streak int, best_streak int, distribution int[])
language sql
stable
as $$
  with counted as (
    select coalesce(finished_at, created_at) as at, solved, cardinality(guesses) as n
    from wordle_rounds
    where client_key = p_client_key
      and (solved or lost or (cardinality(guesses) > 0 and created_at < now() - interval '24 hours'))
  ),
  -- Each loss starts a new run; a run's wins are the streak after it.
  runs as (
    select solved,
      count(*) filter (where not solved) over (order by at rows between unbounded preceding and current row) as run
    from counted
  ),
  per_run as (
    select run, count(*) filter (where solved) as wins
    from runs
    group by run
  )
  select
    (select count(*) from counted)::int,
    (select count(*) from counted where solved)::int,
    coalesce((select wins from per_run order by run desc limit 1), 0)::int,
    coalesce((select max(wins) from per_run), 0)::int,
    array(
      select (select count(*) from counted c where c.solved and c.n = g)::int
      from generate_series(1, 6) as g
      order by g
    );
$$;

-- Housekeeping, called now and then by /api/round/new. Rounds nobody ever
-- guessed in, past any use. Rounds with a guess are kept: they are stats.
create or replace function wordle_prune()
returns void
language sql
volatile
as $$
  delete from wordle_rounds r
  where r.created_at < now() - interval '2 days'
    and cardinality(r.guesses) = 0
    and not r.solved
    and not exists (select 1 from wordle_leaderboard l where l.round_id = r.id);
$$;

-- Service role only.
revoke all on function wordle_start_round(text, text, int, boolean) from public, anon, authenticated;
revoke all on function wordle_submit(uuid, text) from public, anon, authenticated;
revoke all on function wordle_stats(text) from public, anon, authenticated;
revoke all on function wordle_prune() from public, anon, authenticated;
grant execute on function wordle_start_round(text, text, int, boolean) to service_role;
grant execute on function wordle_submit(uuid, text) to service_role;
grant execute on function wordle_stats(text) to service_role;
grant execute on function wordle_prune() to service_role;
