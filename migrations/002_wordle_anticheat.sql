-- A simple anti-cheat. Run after 001. Safe to run again.
--
-- 1. Every guess's arrival time is kept, and a round with a guess sent
--    faster than a person can play (see FASTEST_GUESS_MS in
--    main-site/api/_lib/game.js) is flagged. A flagged round still plays
--    and still counts in the player's stats; it cannot go on the
--    leaderboard.
-- 2. Submitting needs the client_key that played the round, so a round id
--    on its own is not enough to put a round on the board.

alter table wordle_rounds add column if not exists guess_times timestamptz[] not null default '{}';

-- Why the round cannot go on the leaderboard, or null. Only ever 'too_fast'
-- for now; a text so later checks can add their own reason.
alter table wordle_rounds add column if not exists flag text;

-- The signature changes, which "create or replace" cannot do, hence the drops.
drop function if exists wordle_submit(uuid, text);
drop function if exists wordle_submit(uuid, text, text);

create function wordle_submit(p_round_id uuid, p_client_key text, p_name text)
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

  -- Someone else's round reads as no round at all.
  if not found or v_round.client_key <> p_client_key then
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
  if v_round.flag is not null then
    return query select 'flagged'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
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

revoke all on function wordle_submit(uuid, text, text) from public, anon, authenticated;
grant execute on function wordle_submit(uuid, text, text) to service_role;
