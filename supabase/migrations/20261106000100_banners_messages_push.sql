-- Bannières de la page Messages (1667 × 238 px, gérées par l'administrateur général)
-- et push vers le téléphone pour toutes les notifications.
-- Ré-exécutable sans risque.

-- ---------------------------------------------------------------------
-- 1. Bannières : emplacement (accueil 1200 × 448 ou page Messages 1667 × 238)
-- ---------------------------------------------------------------------
alter table public.banners add column if not exists placement text not null default 'home';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'banners_placement_chk' and conrelid = 'public.banners'::regclass) then
    alter table public.banners add constraint banners_placement_chk check (placement in ('home', 'messages'));
  end if;
end $$;
create index if not exists banners_placement_idx on public.banners (placement, sort_order) where is_active;

-- Page Messages : réservée à l'administrateur général (politique « bannières admin »).
-- Les agents marketing gardent les bannières de l'accueil de leur zone.
drop policy if exists "bannières : agents marketing" on public.banners;
create policy "bannières : agents marketing" on public.banners for all to authenticated
  using ((select public.is_agent()) and public.can_market(store_id) and placement = 'home')
  with check ((select public.is_agent()) and public.can_market(store_id) and placement = 'home');

-- ---------------------------------------------------------------------
-- 2. Chaque notification part aussi en push vers le téléphone.
--    L'ancien drapeau data.push = false (gains de la roue) est ignoré ;
--    seules les catégories que le client a coupées dans ses Paramètres restent muettes.
-- ---------------------------------------------------------------------
create or replace function public.tg_notification_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cat text := public._notification_category(new.kind);
  v_prefs jsonb;
begin
  if v_cat <> 'system' then
    select notification_prefs into v_prefs from public.profiles where id = new.user_id;
    if coalesce(v_prefs, '{}'::jsonb) -> v_cat = 'false'::jsonb then return new; end if;
  end if;
  if exists (select 1 from public.push_tokens where user_id = new.user_id) then
    perform net.http_post(
      url := 'https://trobgcehelmxkvqjtdbo.supabase.co/functions/v1/push-send',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-push-secret', (select value from km_private.secrets where name = 'PUSH_WEBHOOK_SECRET')),
      body := jsonb_build_object('notification_id', new.id)
    );
  end if;
  return new;
end $$;
revoke execute on function public.tg_notification_push() from public, anon, authenticated;
