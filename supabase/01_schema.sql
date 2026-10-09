-- =====================================================================
--  Technical assessment — database schema, version 2
--  Run this file FIRST in Supabase > SQL Editor, then 02_questions.sql.
--
--  WARNING: running it deletes all existing candidates, answers and
--  questions (it rebuilds the tables). The admins list is kept.
--
--  How it works
--  - Each candidate gets their own random set of questions, drawn when
--    they press Start, mixed across the stacks chosen at invitation
--    (JavaScript/TypeScript, Java, C#, PHP, Python) and balanced so each
--    language is represented.
--  - Candidates never touch tables directly: they call the RPC functions
--    below with their secret invitation token. Correct answers and
--    rubrics never leave the database for them.
--  - The timer, stage unlocking and grading run on the server.
--  - Only signed-in emails listed in public.admins can read results.
-- =====================================================================

-- ---------------------------------------------------- remove version 1
drop view if exists public.results;
drop view if exists public.skill_scores;
drop function if exists public.peek_test(uuid);
drop function if exists public.start_test(uuid, text);
drop function if exists public.start_test(uuid);
drop function if exists public.save_answer(uuid, text, int, text);
drop function if exists public.save_answer(uuid, text, int, text, text);
drop function if exists public.next_step(uuid, int);
drop function if exists public.finish_test(uuid);
drop function if exists public.log_event(uuid, text, text);
drop function if exists private.questions_for(text, int);
drop function if exists private.state(uuid);
drop function if exists private.finish(uuid);
drop function if exists private.draw(uuid);
drop function if exists private.expired(public.candidates);
drop table if exists public.events      cascade;
drop table if exists public.answers     cascade;
drop table if exists public.assignments cascade;
drop table if exists public.candidates  cascade;
drop table if exists public.questions   cascade;
drop table if exists public.stages      cascade;

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------- tables

create table if not exists public.admins (
  email text primary key
);

-- One row per stage. choice_count and code_count set how many questions
-- of every kind are drawn per candidate (0 disables).
create table public.stages (
  step         int primary key check (step between 1 and 20),
  title        text not null,
  intro        text not null default '',
  scenario     boolean not null default false,  -- show the MiniEvent context
  choice_count int not null default 0 check (choice_count between 0 and 30),
  code_count   int not null default 0 check (code_count between 0 and 5)
);

create table public.questions (
  id           text primary key,
  stage        int  not null references public.stages(step) on update cascade,
  lang         text not null
               check (lang in ('general', 'sql', 'design', 'algorithms', 'js', 'java', 'csharp', 'php', 'python', 'any')),
  kind         text not null check (kind in ('choice', 'code')),
  title        text,
  prompt       text not null,
  snippet      text,
  snippet_lang text,           -- syntax highlighting: javascript, jsx, java, csharp, php, python, sql
  options      jsonb,          -- array of strings for kind = 'choice'
  correct      int,            -- 0-based index of the right option (never sent to candidates)
  points       numeric not null default 1 check (points > 0),
  rubric       text,           -- scoring guide for kind = 'code' (never sent to candidates)
  active       boolean not null default true,
  check (kind = 'code' or (jsonb_typeof(options) = 'array' and correct is not null
                           and correct >= 0 and correct < jsonb_array_length(options)))
);

create table public.candidates (
  id               uuid primary key default gen_random_uuid(),
  token            uuid not null unique default gen_random_uuid(),
  full_name        text not null,
  email            text,
  position         text,                    -- internal label, never shown to the candidate
  stacks           text[] not null default array['js', 'java', 'csharp', 'php', 'python'],
  duration_minutes int  not null default 30 check (duration_minutes between 5 and 240),
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  deadline         timestamptz,
  submitted_at     timestamptz,
  current_step     int,                     -- null = not started, 99 = all stages done
  step_times       jsonb not null default '{}'::jsonb,
  decision         text check (decision in ('shortlisted', 'interview', 'on_hold', 'rejected', 'hired')),
  notes            text,
  check (cardinality(stacks) >= 1
         and stacks <@ array['js', 'java', 'csharp', 'php', 'python'])
);

-- The questions drawn per candidate.
create table public.assignments (
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  question_id  text not null references public.questions(id) on delete cascade,
  step         int  not null,
  position     int  not null,
  primary key (candidate_id, question_id)
);
create index assignments_step_idx on public.assignments(candidate_id, step);

create table public.answers (
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  question_id  text not null references public.questions(id) on delete cascade,
  choice       int,
  answer_text  text,
  answer_lang  text,           -- language the candidate chose for an open coding task
  auto_score   numeric,
  manual_score numeric,
  updated_at   timestamptz not null default now(),
  primary key (candidate_id, question_id)
);

create table public.events (
  id           bigserial primary key,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  type         text not null,
  detail       text,
  at           timestamptz not null default now()
);
create index events_candidate_idx on public.events(candidate_id);

-- ---------------------------------------------------------- admin access

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

alter table public.admins      enable row level security;
alter table public.stages      enable row level security;
alter table public.questions   enable row level security;
alter table public.candidates  enable row level security;
alter table public.assignments enable row level security;
alter table public.answers     enable row level security;
alter table public.events      enable row level security;

drop policy if exists admin_all on public.admins;
create policy admin_all on public.admins      for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.stages      for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.questions   for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.candidates  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.assignments for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.answers     for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.events      for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- No policies for "anon": anonymous visitors cannot read or write any table.

-- ------------------------------------------------- back-office views

-- One row per candidate with totals.
create view public.results with (security_invoker = true) as
select
  c.*,
  coalesce(t.auto_total, 0)   as auto_total,
  coalesce(t.manual_total, 0) as manual_total,
  coalesce(t.max_points, 0)   as max_points,
  coalesce(t.questions, 0)    as question_count,
  coalesce(t.answered, 0)     as answered_count,
  coalesce(t.pending, 0)      as pending_reviews,
  coalesce(t.total_steps, 0)  as total_steps,
  (select count(*) from public.events e
    where e.candidate_id = c.id and e.type <> 'resumed') as flag_count
from public.candidates c
left join lateral (
  select
    sum(case when q.kind = 'choice' then ans.auto_score end)   as auto_total,
    sum(case when q.kind = 'code'   then ans.manual_score end) as manual_total,
    sum(q.points)                                              as max_points,
    count(*)                                                   as questions,
    count(*) filter (where ans.choice is not null
                        or coalesce(btrim(ans.answer_text), '') <> '') as answered,
    count(*) filter (where q.kind = 'code' and ans.manual_score is null
                       and coalesce(btrim(ans.answer_text), '') <> '') as pending,
    count(distinct a.step)                                     as total_steps
  from public.assignments a
  join public.questions q on q.id = a.question_id
  left join public.answers ans
         on ans.candidate_id = a.candidate_id and ans.question_id = a.question_id
  where a.candidate_id = c.id
) t on true;

-- Score per candidate and technology, on the stages the candidate reached.
create view public.skill_scores with (security_invoker = true) as
select
  a.candidate_id,
  case when q.lang = 'any' then coalesce(ans.answer_lang, 'any') else q.lang end as lang,
  count(*)        as questions,
  sum(q.points)   as possible,
  sum(coalesce(case when q.kind = 'choice' then ans.auto_score else ans.manual_score end, 0)) as earned,
  count(*) filter (where ans.choice is not null
                      or coalesce(btrim(ans.answer_text), '') <> '') as answered,
  count(*) filter (where q.kind = 'code' and ans.manual_score is null
                     and coalesce(btrim(ans.answer_text), '') <> '') as pending
from public.assignments a
join public.candidates c on c.id = a.candidate_id
join public.questions q  on q.id = a.question_id
left join public.answers ans
       on ans.candidate_id = a.candidate_id and ans.question_id = a.question_id
where c.current_step is not null and a.step <= c.current_step
group by 1, 2;

-- ------------------------------------------------- internal helpers
-- (in the "private" schema: not reachable through the public API)

create or replace function private.expired(c public.candidates)
returns boolean
language sql stable
as $$
  select c.submitted_at is null and c.deadline is not null
         and now() > c.deadline + interval '15 seconds';
$$;

create or replace function private.finish(p_id uuid)
returns void
language plpgsql
as $$
begin
  update public.candidates
     set submitted_at = least(now(), deadline + interval '15 seconds'),
         step_times   = step_times || jsonb_build_object('end', least(now(), deadline))
   where id = p_id and submitted_at is null;
end;
$$;

create or replace function private.state(p_id uuid)
returns jsonb
language plpgsql
as $$
declare
  c public.candidates;
begin
  select * into c from public.candidates where id = p_id;
  return jsonb_build_object(
    'name',       c.full_name,
    'duration',   c.duration_minutes,
    'started',    c.started_at is not null,
    'finished',   c.submitted_at is not null,
    'deadline',   c.deadline,
    'server_now', now(),
    'step',       c.current_step,
    'steps',      coalesce((
                    select jsonb_agg(jsonb_build_object(
                             'step', s.step, 'title', s.title, 'intro', s.intro,
                             'scenario', s.scenario, 'count', x.n) order by s.step)
                    from (select step, count(*) as n from public.assignments
                           where candidate_id = c.id group by step) x
                    join public.stages s on s.step = x.step), '[]'::jsonb),
    'questions',  case when c.submitted_at is null and c.current_step between 1 and 20 then
                    coalesce((
                      select jsonb_agg(jsonb_build_object(
                               'id', q.id, 'kind', q.kind, 'lang', q.lang, 'title', q.title,
                               'prompt', q.prompt, 'snippet', q.snippet,
                               'snippet_lang', q.snippet_lang, 'options', q.options,
                               'points', q.points) order by a.position)
                      from public.assignments a
                      join public.questions q on q.id = a.question_id
                      where a.candidate_id = c.id and a.step = c.current_step), '[]'::jsonb)
                  else '[]'::jsonb end,
    'saved',      coalesce((
                    select jsonb_object_agg(ans.question_id, jsonb_build_object(
                             'choice', ans.choice, 'text', ans.answer_text, 'lang', ans.answer_lang))
                    from public.answers ans
                    join public.assignments a
                      on a.candidate_id = ans.candidate_id and a.question_id = ans.question_id
                    where ans.candidate_id = c.id and a.step = c.current_step), '{}'::jsonb)
  );
end;
$$;

-- Draws this candidate's questions: for every stage, choice_count choice
-- questions and code_count coding questions, spread across languages.
create or replace function private.draw(p_id uuid)
returns void
language plpgsql
as $$
declare
  v_stacks text[];
begin
  select stacks into v_stacks from public.candidates where id = p_id;
  delete from public.assignments where candidate_id = p_id;

  insert into public.assignments (candidate_id, question_id, step, position)
  select p_id, x.id, x.stage,
         row_number() over (partition by x.stage order by (x.kind = 'code'), x.shuffle)
  from (
    select r.id, r.stage, r.kind, random() as shuffle,
           row_number() over (partition by r.stage, r.kind order by r.lang_rank, random()) as k
    from (
      select q.id, q.stage, q.kind,
             row_number() over (partition by q.stage, q.kind, q.lang order by random()) as lang_rank
      from public.questions q
      where q.active
        and (q.lang not in ('js', 'java', 'csharp', 'php', 'python') or q.lang = any(v_stacks))
    ) r
  ) x
  join public.stages s on s.step = x.stage
  where (x.kind = 'choice' and x.k <= s.choice_count)
     or (x.kind = 'code'   and x.k <= s.code_count);
end;
$$;

revoke all on all functions in schema private from public;

-- ------------------------------------------------------ candidate API (RPC)

-- Welcome screen: who is this link for, and what does the test contain?
create or replace function public.peek_test(p_token uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  c public.candidates;
begin
  select * into c from public.candidates where token = p_token;
  if not found then
    return jsonb_build_object('error', 'INVALID_LINK');
  end if;
  if private.expired(c) then
    perform private.finish(c.id);
    select * into c from public.candidates where id = c.id;
  end if;
  return jsonb_build_object(
    'name', c.full_name, 'duration', c.duration_minutes,
    'started', c.started_at is not null, 'finished', c.submitted_at is not null,
    'stages', coalesce((select jsonb_agg(jsonb_build_object(
                                 'title', s.title, 'count', s.choice_count + s.code_count)
                                 order by s.step)
                        from public.stages s
                        where s.choice_count + s.code_count > 0
                          and exists (select 1 from public.questions q
                                       where q.stage = s.step and q.active)), '[]'::jsonb));
end;
$$;

-- Starts the timer and draws the questions (first call), or resumes.
create or replace function public.start_test(p_token uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  c public.candidates;
  v_first int;
begin
  select * into c from public.candidates where token = p_token for update;
  if not found then
    return jsonb_build_object('error', 'INVALID_LINK');
  end if;

  if c.started_at is null then
    perform private.draw(c.id);
    select min(step) into v_first from public.assignments where candidate_id = c.id;
    if v_first is null then
      return jsonb_build_object('error', 'NO_QUESTIONS');
    end if;
    update public.candidates
       set started_at   = now(),
           deadline     = now() + make_interval(mins => c.duration_minutes),
           current_step = v_first,
           step_times   = jsonb_build_object(v_first::text, now())
     where id = c.id;
  elsif private.expired(c) then
    perform private.finish(c.id);
  end if;

  return private.state(c.id);
end;
$$;

-- Saves one answer. Choice questions are graded here, on the server.
create or replace function public.save_answer(
  p_token uuid, p_question_id text, p_choice int default null,
  p_text text default null, p_lang text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  c public.candidates;
  q public.questions;
  s numeric;
begin
  select * into c from public.candidates where token = p_token;
  if not found then return jsonb_build_object('error', 'INVALID_LINK'); end if;
  if c.started_at is null then return jsonb_build_object('error', 'NOT_STARTED'); end if;
  if c.submitted_at is not null then return jsonb_build_object('error', 'ALREADY_SUBMITTED'); end if;
  if private.expired(c) then
    perform private.finish(c.id);
    return jsonb_build_object('error', 'TIME_UP');
  end if;

  select q2.* into q
    from public.questions q2
    join public.assignments a on a.question_id = q2.id and a.candidate_id = c.id
   where q2.id = p_question_id;
  if not found then return jsonb_build_object('error', 'UNKNOWN_QUESTION'); end if;

  -- Progressive unlocking: only questions of the current stage can be answered.
  if not exists (select 1 from public.assignments
                  where candidate_id = c.id and question_id = q.id and step = c.current_step) then
    return jsonb_build_object('error', 'QUESTION_LOCKED');
  end if;

  if q.kind = 'choice' then
    s := case when p_choice is not null and p_choice = q.correct then q.points else 0 end;
  else
    s := null;
  end if;

  insert into public.answers (candidate_id, question_id, choice, answer_text, answer_lang, auto_score, updated_at)
  values (c.id, q.id,
          case when q.kind = 'choice' then p_choice end,
          case when q.kind = 'code' then left(p_text, 20000) end,
          case when q.kind = 'code' and q.lang = 'any'
                and p_lang in ('js', 'java', 'csharp', 'php', 'python', 'other') then p_lang end,
          s, now())
  on conflict (candidate_id, question_id) do update
     set choice      = excluded.choice,
         answer_text = excluded.answer_text,
         answer_lang = coalesce(excluded.answer_lang, public.answers.answer_lang),
         auto_score  = excluded.auto_score,
         updated_at  = now();

  return jsonb_build_object('ok', true, 'server_now', now());
end;
$$;

-- Locks the current stage and unlocks the next one (no going back).
create or replace function public.next_step(p_token uuid, p_from int)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  c public.candidates;
  v_next int;
begin
  select * into c from public.candidates where token = p_token for update;
  if not found then return jsonb_build_object('error', 'INVALID_LINK'); end if;
  if c.started_at is null then return jsonb_build_object('error', 'NOT_STARTED'); end if;

  if c.submitted_at is null and private.expired(c) then
    perform private.finish(c.id);
  elsif c.submitted_at is null and c.current_step = p_from then
    select min(step) into v_next from public.assignments
     where candidate_id = c.id and step > c.current_step;
    if v_next is null then
      update public.candidates set current_step = 99 where id = c.id;
      perform private.finish(c.id);
    else
      update public.candidates
         set current_step = v_next,
             step_times   = step_times || jsonb_build_object(v_next::text, now())
       where id = c.id;
    end if;
  end if;
  -- If p_from does not match (double click, second tab), nothing changes.

  return private.state(c.id);
end;
$$;

-- Ends the test early or when the timer reaches zero.
create or replace function public.finish_test(p_token uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  c public.candidates;
begin
  select * into c from public.candidates where token = p_token for update;
  if not found then return jsonb_build_object('error', 'INVALID_LINK'); end if;
  if c.started_at is not null then
    perform private.finish(c.id);
  end if;
  return private.state(c.id);
end;
$$;

-- Records integrity signals (tab switches, pastes...).
create or replace function public.log_event(p_token uuid, p_type text, p_detail text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  c public.candidates;
begin
  if p_type not in ('tab_hidden', 'focus_lost', 'paste', 'copy', 'resumed') then return; end if;
  select * into c from public.candidates where token = p_token;
  if not found or c.started_at is null or c.submitted_at is not null then return; end if;
  if (select count(*) from public.events where candidate_id = c.id) >= 500 then return; end if;
  insert into public.events (candidate_id, type, detail) values (c.id, p_type, left(p_detail, 200));
end;
$$;

revoke all on function public.peek_test(uuid)                          from public;
revoke all on function public.start_test(uuid)                         from public;
revoke all on function public.save_answer(uuid, text, int, text, text) from public;
revoke all on function public.next_step(uuid, int)                     from public;
revoke all on function public.finish_test(uuid)                        from public;
revoke all on function public.log_event(uuid, text, text)              from public;

grant execute on function public.peek_test(uuid)                          to anon, authenticated;
grant execute on function public.start_test(uuid)                         to anon, authenticated;
grant execute on function public.save_answer(uuid, text, int, text, text) to anon, authenticated;
grant execute on function public.next_step(uuid, int)                     to anon, authenticated;
grant execute on function public.finish_test(uuid)                        to anon, authenticated;
grant execute on function public.log_event(uuid, text, text)              to anon, authenticated;
grant execute on function public.is_admin()                               to authenticated;

-- Make the API pick up the new functions immediately.
notify pgrst, 'reload schema';
