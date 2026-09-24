-- Tries by word length. Run after 002. Safe to run again.
--
-- A round now has max(6, letters + 1) tries, or 6 where the word list has
-- no more words of that length than that (see maxGuesses in
-- main-site/js/rules.js). The API works the number out when the round
-- starts and it is kept on the round, so a later word list change never
-- changes a round already under way. Rounds from before this are 6.

alter table wordle_rounds add column if not exists max_guesses smallint not null default 6
  check (max_guesses between 1 and 64);

-- Takes the round's tries. The signature changes, hence the drop.
drop function if exists wordle_start_round(text, text, int, boolean);
drop function if exists wordle_start_round(text, text, int, boolean, int);

create function wordle_start_round(p_client_key text, p_answer text, p_length int, p_hard_mode boolean, p_max_guesses int)
returns setof wordle_rounds
language plpgsql
volatile
as $$
begin
  -- A live round with a guess in it is a loss, so leaving a round cannot
  -- protect a streak; one without is deleted, since nothing happened in it.
  update wordle_rounds
  set lost = true, gave_up = true, score = 0, finished_at = now(), version = version + 1
  where client_key = p_client_key and not solved and not lost and cardinality(guesses) > 0;

  delete from wordle_rounds
  where client_key = p_client_key and not solved and not lost and cardinality(guesses) = 0;

  return query
  insert into wordle_rounds (client_key, answer, length, hard_mode, max_guesses)
  values (p_client_key, p_answer, p_length, p_hard_mode, p_max_guesses)
  returning *;
end;
$$;

-- As in 001, but the guess distribution runs as far as the player's longest
-- win rather than stopping at 6: distribution[n] is rounds solved in n
-- guesses, and it always has at least 6 entries.
create or replace function wordle_stats(p_client_key text)
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
      from generate_series(1, greatest(6, (select coalesce(max(n), 0) from counted where solved))) as g
      order by g
    );
$$;

revoke all on function wordle_start_round(text, text, int, boolean, int) from public, anon, authenticated;
revoke all on function wordle_stats(text) from public, anon, authenticated;
grant execute on function wordle_start_round(text, text, int, boolean, int) to service_role;
grant execute on function wordle_stats(text) to service_role;
