-- Scénarios de test : campagnes promotionnelles et alertes des messages (assistant, livreur).
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;

create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'ÉCHEC : %', label; end if;
  raise notice 'ok  %', label;
end $$;
create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false)
$$;
create or replace function pg_temp.as_postgres() returns void language sql as $$
  select set_config('request.jwt.claims', '', false)
$$;

-- ── Comptes : 4 clients, 1 livreur, 1 administrateur général ─────────
insert into auth.users (id, email, phone, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'c1@test.cd', null, '{"full_name": "Nathan", "phone": "0812345678"}'),
  ('22222222-2222-2222-2222-222222222222', 'c2@test.cd', null, '{"full_name": "Amani"}'),
  ('33333333-3333-3333-3333-333333333333', 'c3@test.cd', null, '{"full_name": "Sans promo"}'),
  ('66666666-6666-6666-6666-666666666666', 'c4@test.cd', null, '{"full_name": "Ancien client"}'),
  ('77777777-7777-7777-7777-777777777777', 'livreur@test.cd', null, '{"full_name": "Livreur"}'),
  ('44444444-4444-4444-4444-444444444444', 'admin@test.cd', null, '{"full_name": "Admin"}');
update profiles set role = 'super_admin' where id = '44444444-4444-4444-4444-444444444444';
update profiles set role = 'driver' where id = '77777777-7777-7777-7777-777777777777';
update profiles set notification_prefs = '{"promos": false}' where id = '33333333-3333-3333-3333-333333333333';
update profiles set phone = '+243 81 234 5678' where id = '11111111-1111-1111-1111-111111111111';
delete from notifications;

insert into stores (id, name, commune, is_active, is_open) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kin Marché Gombe', 'Gombe', true, true);
insert into addresses (user_id, city, commune) values
  ('11111111-1111-1111-1111-111111111111', 'Kinshasa', 'Gombe'),
  ('22222222-2222-2222-2222-222222222222', 'Lubumbashi', 'Kampemba'),
  ('33333333-3333-3333-3333-333333333333', 'Kinshasa', 'Limete');
-- c1 : commande récente ; c4 : commande il y a 60 jours ; c2 : aucune commande.
insert into orders (id, order_number, customer_id, store_id, subtotal_usd, total_usd, delivery_address) values
  ('dddddddd-0000-0000-0000-000000000001', 'KM-0001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 10, 11, '{}'),
  ('dddddddd-0000-0000-0000-000000000002', 'KM-0002', '66666666-6666-6666-6666-666666666666', 'aaaaaaaa-0000-0000-0000-000000000001', 10, 11, '{}');
update orders set created_at = now() - interval '60 days' where id = 'dddddddd-0000-0000-0000-000000000002';
delete from notifications;

-- ── Sécurité : un client ne voit ni ne crée de campagne ───────────────
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
do $$ begin
  insert into campaigns (title, body) values ('x', 'y');
  raise exception 'ÉCHEC : un client a créé une campagne';
exception when insufficient_privilege then raise notice 'ok  un client ne peut pas créer de campagne';
end $$;
do $$ begin
  perform public.campaign_audiences();
  raise exception 'ÉCHEC : un client lit les publics';
exception when insufficient_privilege then raise notice 'ok  un client ne lit pas les publics';
end $$;
do $$ begin
  perform public.set_channel_secret('RESEND_API_KEY', 'pirate');
  raise exception 'ÉCHEC : un client modifie une clé';
exception when insufficient_privilege then raise notice 'ok  un client ne modifie pas les clés';
end $$;
do $$ begin
  perform * from public.campaign_recipients((select gen_random_uuid()), null);
  raise exception 'ÉCHEC : un client lit les destinataires';
exception when insufficient_privilege then raise notice 'ok  la liste des destinataires est réservée au serveur';
end $$;
reset role;

-- ── Administrateur général ────────────────────────────────────────────
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
set role authenticated;
insert into campaigns (id, title, body, image_url, link_type, link_value, audience, channels)
values ('eeeeeeee-0000-0000-0000-000000000001', 'Promo huile -20 %', 'Toute la semaine sur l’huile végétale.',
        'https://exemple.supabase.co/storage/v1/object/public/branding/campaign-1.jpg', 'promotion', null, 'all', array['app', 'email']);
select pg_temp.check((select created_by from campaigns where id = 'eeeeeeee-0000-0000-0000-000000000001') = '44444444-4444-4444-4444-444444444444', 'auteur enregistré');

-- Publics : 3 clients joignables (c1, c2, c4) ; c3 a coupé les promotions.
select pg_temp.check((public.campaign_audiences() -> 'segments' -> 'all' ->> 'customers')::int = 3, 'public « tous » = 3 (promotions coupées exclues)');
select pg_temp.check((public.campaign_audiences() -> 'segments' -> 'all' ->> 'phone')::int = 1, '1 client avec numéro');
select pg_temp.check((public.campaign_audiences() -> 'segments' -> 'all' ->> 'email')::int = 3, '3 clients avec e-mail');
select pg_temp.check((public.campaign_audiences() -> 'segments' -> 'buyers' ->> 'customers')::int = 2, 'clients ayant commandé = 2');
select pg_temp.check((public.campaign_audiences() -> 'segments' -> 'new' ->> 'customers')::int = 1, 'nouveaux clients = 1');
select pg_temp.check((public.campaign_audiences() -> 'segments' -> 'lapsed' ->> 'customers')::int = 1, 'clients inactifs depuis 30 jours = 1');
select pg_temp.check(jsonb_array_length(public.campaign_audiences() -> 'cities') = 2, 'villes listées (Kinshasa, Lubumbashi)');

-- Test : seulement à l'administrateur, sans statistiques.
select pg_temp.check(public.campaign_send_app('eeeeeeee-0000-0000-0000-000000000001', true) = 1, 'test envoyé à soi-même');
reset role;
select pg_temp.check((select count(*) from notifications where kind = 'promo') = 1
  and (select user_id from notifications where kind = 'promo') = '44444444-4444-4444-4444-444444444444', 'test reçu par l''administrateur seulement');
select pg_temp.check((select stats from campaigns where id = 'eeeeeeee-0000-0000-0000-000000000001') = '{}'::jsonb, 'test sans statistiques');
set role authenticated;

-- Envoi réel.
select pg_temp.check(public.campaign_send_app('eeeeeeee-0000-0000-0000-000000000001') = 3, 'campagne envoyée à 3 clients');
reset role;
select pg_temp.check((select count(*) from notifications where kind = 'promo' and data ->> 'campaign_id' = 'eeeeeeee-0000-0000-0000-000000000001'
  and user_id <> '44444444-4444-4444-4444-444444444444') = 3, '3 notifications « promo »');
select pg_temp.check(not exists (select 1 from notifications where user_id = '33333333-3333-3333-3333-333333333333'), 'client sans promotions non dérangé');
select pg_temp.check((select data from notifications where user_id = '11111111-1111-1111-1111-111111111111' and kind = 'promo')
  = '{"campaign_id": "eeeeeeee-0000-0000-0000-000000000001", "image_url": "https://exemple.supabase.co/storage/v1/object/public/branding/campaign-1.jpg", "link_type": "promotion"}'::jsonb,
  'photo et lien dans la notification');
select pg_temp.check((select status from campaigns where id = 'eeeeeeee-0000-0000-0000-000000000001') = 'sent'
  and (select (stats -> 'app' ->> 'sent')::int from campaigns where id = 'eeeeeeee-0000-0000-0000-000000000001') = 3, 'statut et statistiques');
set role authenticated;
do $$ begin
  perform public.campaign_send_app('eeeeeeee-0000-0000-0000-000000000001');
  raise exception 'ÉCHEC : double envoi';
exception when unique_violation then raise notice 'ok  pas de double envoi';
end $$;

-- Vues : c1 lit la notification.
reset role;
update notifications set read_at = now() where user_id = '11111111-1111-1111-1111-111111111111' and kind = 'promo';
set role authenticated;
select pg_temp.check((select delivered from public.campaign_stats() where campaign_id = 'eeeeeeee-0000-0000-0000-000000000001') = 3
  and (select seen from public.campaign_stats() where campaign_id = 'eeeeeeee-0000-0000-0000-000000000001') = 1, 'statistiques : 3 reçues, 1 vue (test exclu)');

-- Public par ville (insensible à la casse et aux accents).
insert into campaigns (id, title, body, audience, audience_value) values
  ('eeeeeeee-0000-0000-0000-000000000002', 'Kinshasa', 'Offre Kinshasa', 'city', ' kinshasa ');
select pg_temp.check(public.campaign_send_app('eeeeeeee-0000-0000-0000-000000000002') = 1, 'public par ville : seulement c1 (c3 a coupé les promotions)');

-- Réglages des canaux : écriture possible, lecture impossible.
select public.set_channel_secret('RESEND_API_KEY', 're_test_123');
select public.set_channel_secret('EMAIL_FROM', 'Kin Marché <promo@kinmarche.cd>');
select pg_temp.check((public.campaign_channels() ->> 'email')::boolean and not (public.campaign_channels() ->> 'whatsapp')::boolean, 'e-mail configuré, WhatsApp non');
select pg_temp.check(public.campaign_channels()::text not like '%re_test_123%', 'la clé n''est jamais renvoyée');
select public.set_channel_secret('RESEND_API_KEY', '');
select pg_temp.check(not (public.campaign_channels() ->> 'email')::boolean, 'clé effacée');
do $$ begin
  perform public.set_channel_secret('PUSH_WEBHOOK_SECRET', 'x');
  raise exception 'ÉCHEC : clé système modifiée';
exception when invalid_parameter_value then raise notice 'ok  les clés système ne sont pas modifiables';
end $$;

-- Retrait des « Messages » des clients.
select pg_temp.check(public.campaign_withdraw('eeeeeeee-0000-0000-0000-000000000001') = 4, 'campagne retirée de 4 boîtes (3 clients + le test)');
reset role;
select pg_temp.check(not exists (select 1 from notifications where data ->> 'campaign_id' = 'eeeeeeee-0000-0000-0000-000000000001'
  and not data ? 'test'), 'plus de notification de la campagne');

-- ── Messages de l'assistant et du livreur : le client est alerté ──────
select pg_temp.as_postgres();
insert into support_tickets (id, customer_id, order_id, channel, subject) values
  ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, 'general', 'Question'),
  ('ffffffff-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001', 'driver', 'Livraison');
delete from notifications;
insert into messages (ticket_id, sender_id, body) values
  ('ffffffff-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'Bonjour, votre commande arrive bientôt.'),
  ('ffffffff-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777', 'Je suis devant votre porte.');
select pg_temp.check((select count(*) from notifications where user_id = '11111111-1111-1111-1111-111111111111' and kind = 'message') = 2, 'client alerté des 2 messages');
select pg_temp.check((select title from notifications where user_id = '11111111-1111-1111-1111-111111111111' and data ->> 'ticket_id' = 'ffffffff-0000-0000-0000-000000000002')
  = 'LIVREUR Kin Marché', 'message du livreur signé « LIVREUR Kin Marché »');
select pg_temp.check((select body from notifications where user_id = '11111111-1111-1111-1111-111111111111' and data ->> 'ticket_id' = 'ffffffff-0000-0000-0000-000000000002')
  = 'Je suis devant votre porte.', 'texte du message dans l''alerte');
