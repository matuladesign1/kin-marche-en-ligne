-- =====================================================================
-- Test d'appel des livreurs : l'administrateur général fait sonner le téléphone d'un livreur
-- (même appel que pour une vraie course : sonnerie, écran plein, Accepter / Refuser),
-- sans créer de commande. La réponse du livreur s'affiche dans l'administration.
-- =====================================================================

create table if not exists public.driver_call_tests (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  status text not null default 'sent' check (status in ('sent', 'shown', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  shown_at timestamptz,
  answered_at timestamptz
);
create index if not exists driver_call_tests_driver_idx on public.driver_call_tests (driver_id, created_at desc);
create index if not exists driver_call_tests_created_idx on public.driver_call_tests (created_at desc);

alter table public.driver_call_tests enable row level security;
drop policy if exists "tests d'appel : administrateur général" on public.driver_call_tests;
create policy "tests d'appel : administrateur général" on public.driver_call_tests for select to authenticated
  using ((select public.is_super_admin()));
drop policy if exists "tests d'appel : le livreur" on public.driver_call_tests;
create policy "tests d'appel : le livreur" on public.driver_call_tests for select to authenticated
  using (driver_id = (select auth.uid()));

-- Textes de l'appel de test (langue du livreur).
insert into public.notification_templates (key, language, title, body) values
  ('call.test', 'fr', 'Appel de test — Kin Marché 📞', 'L''administration teste l''appel des nouvelles courses. Répondez pour confirmer qu''il fonctionne.'),
  ('call.test', 'en', 'Test call — Kin Marché 📞', 'The team is testing the new-delivery call. Answer to confirm it works.'),
  ('call.test', 'ln', 'Appel ya komeka — Kin Marché 📞', 'Bakambi bazali komeka appel ya mibembo ya sika. Yanola mpo na kondimisa ete esalaka.'),
  ('call.test', 'sw', 'Simu ya majaribio — Kin Marché 📞', 'Timu inajaribu simu ya safari mpya. Jibu kuthibitisha kwamba inafanya kazi.')
on conflict (key, language) do update set title = excluded.title, body = excluded.body;

-- Envoi d'un appel de test à un livreur (administrateur général).
create or replace function public.send_call_test(p_driver uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_driver and role = 'driver') then
    raise exception 'NOT_A_DRIVER' using errcode = '22023';
  end if;
  insert into public.driver_call_tests (driver_id) values (p_driver) returning id into v_id;
  perform public._notify(p_driver, 'call_test', 'call.test', '{}'::jsonb,
    jsonb_build_object('test_id', v_id, 'expires_at', now() + interval '60 seconds'));
  return v_id;
end $$;
revoke execute on function public.send_call_test(uuid) from public, anon;
grant execute on function public.send_call_test(uuid) to authenticated;

-- Réponse du livreur (affiché, accepté, refusé, sans réponse).
create or replace function public.answer_call_test(p_test uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('shown', 'accepted', 'declined', 'expired') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  update public.driver_call_tests
     set status = case when p_status = 'shown' then (case when status = 'sent' then 'shown' else status end) else p_status end,
         shown_at = coalesce(shown_at, now()),
         answered_at = case when p_status in ('accepted', 'declined', 'expired') then coalesce(answered_at, now()) else answered_at end
   where id = p_test and driver_id = auth.uid() and status in ('sent', 'shown');
end $$;
revoke execute on function public.answer_call_test(uuid, text) from public, anon;
grant execute on function public.answer_call_test(uuid, text) to authenticated;
