-- =====================================================================
--  Back-office tools: delete a candidate's results, delete all data.
--  Run this file in Supabase > SQL Editor (after 01 and 02). Safe to re-run.
--  Only signed-in emails listed in public.admins can use these functions.
-- =====================================================================

-- Deletes one candidate's answers, drawn questions and signals, and
-- reopens their test link so they can take the test again.
-- The candidate, the decision and the notes are kept.
create or replace function public.admin_delete_results(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  delete from public.answers     where candidate_id = p_id;
  delete from public.events      where candidate_id = p_id;
  delete from public.assignments where candidate_id = p_id;
  update public.candidates
     set started_at = null, deadline = null, submitted_at = null,
         current_step = null, step_times = '{}'::jsonb
   where id = p_id;
end;
$$;

-- Deletes every candidate with all their results, to start from scratch.
-- Questions, stages, test settings and admin accounts are kept.
-- Returns the number of candidates deleted.
create or replace function public.admin_delete_all_candidates(p_confirm text)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  if p_confirm is distinct from 'DELETE' then
    raise exception 'Confirmation text does not match';
  end if;
  delete from public.candidates where id is not null;   -- answers, questions drawn and signals follow
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.admin_delete_results(uuid)        from public, anon;
revoke all on function public.admin_delete_all_candidates(text) from public, anon;
grant execute on function public.admin_delete_results(uuid)        to authenticated;
grant execute on function public.admin_delete_all_candidates(text) to authenticated;

notify pgrst, 'reload schema';
