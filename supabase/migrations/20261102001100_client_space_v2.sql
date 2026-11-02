-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Espace client v2 : preuves de paiement,
-- messagerie interne et pièces jointes, avis sur l'application,
-- préférences de confidentialité.
-- =====================================================================

-- Preuves de paiement : une preuve ne vaut JAMAIS paiement tant qu'un
-- administrateur ne l'a pas vérifiée et approuvée (review_payment_proof).
create table public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  method public.payment_method not null default 'bank_transfer',
  reference text,
  note text,
  status public.moderation_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index payment_proofs_order_idx on public.payment_proofs (order_id);
alter table public.payment_proofs enable row level security;
create policy "preuves paiement : lecture" on public.payment_proofs for select to authenticated
  using (customer_id = (select auth.uid()) or public.is_super_admin() or public.is_order_store_manager(order_id));
create policy "preuves paiement : dépôt client" on public.payment_proofs for insert to authenticated
  with check (customer_id = (select auth.uid()) and status = 'pending' and reviewed_by is null
              and public.is_order_customer(order_id));

create or replace function public.review_payment_proof(p_proof_id uuid, p_approve boolean, p_amount numeric default null,
  p_currency public.currency_code default 'USD', p_reference text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p public.payment_proofs;
  v_o public.orders;
  v_pay uuid;
  v_res jsonb;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_p from public.payment_proofs where id = p_proof_id for update;
  if not found or v_p.status <> 'pending' then raise exception 'PROOF_NOT_PENDING'; end if;
  select * into v_o from public.orders where id = v_p.order_id;
  if p_approve then
    if p_amount is null or p_amount <= 0 then raise exception 'AMOUNT_REQUIRED'; end if;
    insert into public.payments (order_id, customer_id, method, provider, provider_reference, amount, currency, amount_usd, status)
    values (v_o.id, v_o.customer_id, v_p.method, 'verification_manuelle', coalesce(nullif(trim(p_reference), ''), 'PREUVE-' || v_p.id::text),
            p_amount, p_currency, v_o.total_usd, 'processing')
    returning id into v_pay;
    v_res := public.confirm_payment(v_pay, coalesce(nullif(trim(p_reference), ''), 'PREUVE-' || v_p.id::text), p_amount, p_currency,
                                    jsonb_build_object('proof_id', v_p.id, 'verified_by', auth.uid()));
    if coalesce((v_res->>'ok')::boolean, false) = false then
      raise exception 'PAYMENT_NOT_CONFIRMED' using detail = v_res::text;
    end if;
  end if;
  update public.payment_proofs set status = case when p_approve then 'approved'::public.moderation_status else 'rejected'::public.moderation_status end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note where id = p_proof_id;
  insert into public.notifications (user_id, kind, title, body, data)
  values (v_p.customer_id, 'payment_proof', case when p_approve then 'Preuve de paiement acceptée' else 'Preuve de paiement refusée' end,
          coalesce(p_note, 'Commande ' || v_o.order_number), jsonb_build_object('order_id', v_o.id));
  perform public.write_audit('payment_proof_review', 'payment_proofs', p_proof_id::text,
    jsonb_build_object('approve', p_approve, 'amount', p_amount, 'currency', p_currency, 'reference', p_reference));
  return coalesce(v_res, jsonb_build_object('ok', true));
end $$;
revoke execute on function public.review_payment_proof(uuid, boolean, numeric, public.currency_code, text, text) from public, anon;

-- Messagerie interne : fil « magasin » marqué interne (directeurs, assistants, direction).
alter table public.support_tickets add column if not exists is_internal boolean not null default false;

create or replace function public.tg_ticket_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_internal and auth.uid() is not null
     and not (public.is_super_admin() or (new.store_id is not null and public.is_store_manager(new.store_id))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if new.is_internal then new.channel := 'store'; end if;
  return new;
end $$;
revoke execute on function public.tg_ticket_guard() from public, anon, authenticated;
create trigger support_tickets_guard before insert on public.support_tickets for each row execute function public.tg_ticket_guard();

create policy "messages : marquer lu" on public.messages for update to authenticated
  using (public.can_view_ticket(ticket_id)) with check (public.can_view_ticket(ticket_id));

create or replace function public.tg_message_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_t public.support_tickets;
begin
  select * into v_t from public.support_tickets where id = new.ticket_id;
  update public.support_tickets set updated_at = now(),
         status = case when status in ('resolved','closed') then 'open'::public.ticket_status else status end where id = v_t.id;
  insert into public.notifications (user_id, kind, title, body, data)
  select distinct u, 'message', 'Nouveau message : ' || v_t.subject, left(new.body, 120), jsonb_build_object('ticket_id', v_t.id)
  from (
    select v_t.customer_id as u
    union select sm.user_id from public.store_managers sm where v_t.store_id is not null and sm.store_id = v_t.store_id and v_t.channel = 'store'
    union select p.id from public.profiles p where p.role = 'super_admin' and (v_t.channel = 'general' or v_t.is_internal)
    union select a.driver_id from public.delivery_assignments a where v_t.channel = 'driver' and a.order_id = v_t.order_id and a.status = 'accepted'
  ) x where u is not null and u <> new.sender_id;
  return new;
end $$;
revoke execute on function public.tg_message_notify() from public, anon, authenticated;
create trigger messages_notify after insert on public.messages for each row execute function public.tg_message_notify();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 10485760, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "km chat : lecture participants" on storage.objects for select to authenticated
  using (bucket_id = 'chat-attachments' and public.can_view_ticket(((storage.foldername(name))[1])::uuid));
create policy "km chat : envoi participants" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-attachments' and (storage.foldername(name))[2] = (select auth.uid())::text
              and public.can_view_ticket(((storage.foldername(name))[1])::uuid));
create policy "km preuves paiement : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_super_admin()));
create policy "km preuves paiement : dépôt" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Vérification d'une commande par son numéro (uniquement les siennes, via RLS)
create or replace function public.lookup_my_order(p_order_number text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'order_number', o.order_number, 'status', o.status, 'payment_status', o.payment_status,
                            'total_usd', o.total_usd, 'created_at', o.created_at, 'store_id', o.store_id)
  from public.orders o where upper(o.order_number) = upper(trim(p_order_number)) limit 1
$$;
revoke execute on function public.lookup_my_order(text) from public, anon;

create table public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (length(comment) <= 2000),
  app_version text,
  platform text,
  created_at timestamptz not null default now()
);
alter table public.app_feedback enable row level security;
create policy "avis app : envoi" on public.app_feedback for insert to authenticated with check (user_id = (select auth.uid()));
create policy "avis app : lecture" on public.app_feedback for select to authenticated using (user_id = (select auth.uid()) or public.is_super_admin());

alter table public.customer_profiles
  add column if not exists notify_promotions boolean not null default true,
  add column if not exists share_usage_statistics boolean not null default false,
  add column if not exists accepted_terms_at timestamptz,
  add column if not exists terms_version text;

create or replace function public.orders_awaiting_review()
returns setof uuid language sql stable security invoker set search_path = '' as $$
  select o.id from public.orders o
  where o.customer_id = auth.uid() and o.status = 'completed'
    and not exists (select 1 from public.reviews r where r.order_id = o.id and r.author_id = auth.uid())
$$;
revoke execute on function public.orders_awaiting_review() from public, anon;

alter publication supabase_realtime add table public.support_tickets;
