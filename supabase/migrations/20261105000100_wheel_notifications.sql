-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Roue de la chance et notifications réelles (v1.0.0)
-- =====================================================================
-- 1. Modèles de notification en 4 langues (fr, en, ln, sw) et envoi centralisé
-- 2. Une notification à CHAQUE étape de la commande (remerciement, félicitations, livraison…)
-- 3. Message de bienvenue à la création du compte
-- 4. Préférences de notification par catégorie (respectées par l'envoi push)
-- 5. Codes promo personnels (réservés à un client)
-- 6. Roue de la chance : lots, tours offerts dès 50 $ payés, tirage côté serveur,
--    gains (points, codes promo, cadeaux, tours supplémentaires), annulation si
--    la commande est annulée ou remboursée, cadeaux joints à la commande suivante
-- 7. Fonctions d'administration (administrateur général) et des supermarchés
--
-- Ré-exécutable sans risque : rien n'est supprimé, les réglages déjà saisis sont conservés.

-- ---------------------------------------------------------------------
-- 1. Modèles de notification et envoi centralisé
-- ---------------------------------------------------------------------

create table if not exists public.notification_templates (
  key text not null,
  language public.app_language not null,
  title text not null,
  body text,
  updated_at timestamptz not null default now(),
  primary key (key, language)
);
alter table public.notification_templates enable row level security;
drop policy if exists "modèles de notification : administration" on public.notification_templates;
create policy "modèles de notification : administration" on public.notification_templates for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- Préférences par catégorie : {"orders": true, "rewards": true, "messages": true, "promos": true}
-- (absent = activé). Les notifications « système » (sécurité, bienvenue, missions) sont toujours envoyées.
alter table public.profiles add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

create or replace function public._notification_category(p_kind text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_kind in ('order_status', 'new_order', 'no_driver') then 'orders'
    when p_kind in ('loyalty', 'wheel') then 'rewards'
    when p_kind in ('message', 'ticket') then 'messages'
    when p_kind in ('promo', 'marketing') then 'promos'
    else 'system' end
$$;

-- Crée une notification à partir d'un modèle, dans la langue du destinataire.
-- {clé} est remplacé par la valeur correspondante de p_params.
create or replace function public._notify(p_user uuid, p_kind text, p_key text,
  p_params jsonb default '{}'::jsonb, p_data jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_lang public.app_language;
  v_tpl public.notification_templates;
  v_title text;
  v_body text;
  v_k text;
  v_v text;
  v_id uuid;
begin
  if p_user is null then return null; end if;
  select language into v_lang from public.profiles where id = p_user;
  if not found then return null; end if;
  select * into v_tpl from public.notification_templates where key = p_key and language = coalesce(v_lang, 'fr');
  if not found then
    select * into v_tpl from public.notification_templates where key = p_key and language = 'fr';
    if not found then return null; end if;
  end if;
  v_title := v_tpl.title;
  v_body := v_tpl.body;
  for v_k, v_v in select e.key, e.value from jsonb_each_text(coalesce(p_params, '{}'::jsonb)) e loop
    v_title := replace(v_title, '{' || v_k || '}', coalesce(v_v, ''));
    v_body := replace(v_body, '{' || v_k || '}', coalesce(v_v, ''));
  end loop;
  insert into public.notifications (user_id, kind, title, body, data)
  values (p_user, p_kind, v_title, v_body, coalesce(p_data, '{}'::jsonb) || jsonb_build_object('template', p_key))
  returning id into v_id;
  return v_id;
end $$;

-- Envoi push : respecte les préférences du client (une notification marquée "push": false n'est pas envoyée).
create or replace function public.tg_notification_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cat text := public._notification_category(new.kind);
  v_prefs jsonb;
begin
  if new.data -> 'push' = 'false'::jsonb then return new; end if;
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

-- ---------------------------------------------------------------------
-- 2. Textes (français, anglais, lingala, kiswahili)
-- ---------------------------------------------------------------------

insert into public.notification_templates (key, language, title, body) values
  -- Commande : remerciement, félicitations et chaque étape de livraison
  ('order.received', 'fr', 'Merci pour votre commande ! 🛒', 'Commande {order} enregistrée chez {store}. Réglez-la pour lancer la préparation.'),
  ('order.received', 'en', 'Thank you for your order! 🛒', 'Order {order} has been placed with {store}. Complete the payment to start the preparation.'),
  ('order.received', 'ln', 'Matondi mpo na komandi na yo ! 🛒', 'Komandi {order} ekomami epai ya {store}. Futa yango mpo bábanda kobongisa yango.'),
  ('order.received', 'sw', 'Asante kwa agizo lako! 🛒', 'Agizo {order} limepokelewa na {store}. Kamilisha malipo ili maandalizi yaanze.'),
  ('order.payment_confirmed', 'fr', 'Félicitations, paiement confirmé ! 🎉', 'Votre commande {order} est validée. {store} la prépare pour vous.'),
  ('order.payment_confirmed', 'en', 'Congratulations, payment confirmed! 🎉', 'Your order {order} is confirmed. {store} is preparing it for you.'),
  ('order.payment_confirmed', 'ln', 'Felisitasyo, mbongo ekoti ! 🎉', 'Komandi na yo {order} endimami. {store} ezali kobongisa yango mpo na yo.'),
  ('order.payment_confirmed', 'sw', 'Hongera, malipo yamethibitishwa! 🎉', 'Agizo lako {order} limethibitishwa. {store} inaliandaa kwa ajili yako.'),
  ('order.sent_to_store', 'fr', 'Commande transmise au supermarché', '{store} a bien reçu votre commande {order}.'),
  ('order.sent_to_store', 'en', 'Order sent to the supermarket', '{store} has received your order {order}.'),
  ('order.sent_to_store', 'ln', 'Komandi etindami na magazini', '{store} ezwi komandi na yo {order}.'),
  ('order.sent_to_store', 'sw', 'Agizo limetumwa kwa supamaketi', '{store} imepokea agizo lako {order}.'),
  ('order.preparing', 'fr', 'Préparation en cours 🧺', 'Nos équipes rassemblent les articles de votre commande {order}.'),
  ('order.preparing', 'en', 'Preparing your order 🧺', 'Our team is gathering the items of your order {order}.'),
  ('order.preparing', 'ln', 'Tozali kobongisa komandi 🧺', 'Basali na biso bazali kosangisa biloko ya komandi na yo {order}.'),
  ('order.preparing', 'sw', 'Tunaandaa agizo lako 🧺', 'Timu yetu inakusanya bidhaa za agizo lako {order}.'),
  ('order.verified', 'fr', 'Articles vérifiés ✅', 'Chaque article de votre commande {order} a été contrôlé.'),
  ('order.verified', 'en', 'Items checked ✅', 'Every item of your order {order} has been checked.'),
  ('order.verified', 'ln', 'Biloko etalelami ✅', 'Eloko nyonso ya komandi na yo {order} etalelami malamu.'),
  ('order.verified', 'sw', 'Bidhaa zimekaguliwa ✅', 'Kila bidhaa ya agizo lako {order} imekaguliwa.'),
  ('order.packed', 'fr', 'Commande emballée 📦', 'Votre commande {order} est emballée avec soin.'),
  ('order.packed', 'en', 'Order packed 📦', 'Your order {order} has been carefully packed.'),
  ('order.packed', 'ln', 'Komandi ekangami 📦', 'Komandi na yo {order} ekangami malamu.'),
  ('order.packed', 'sw', 'Agizo limefungwa 📦', 'Agizo lako {order} limefungwa kwa uangalifu.'),
  ('order.ready', 'fr', 'Commande prête', 'Votre commande {order} attend son livreur.'),
  ('order.ready', 'en', 'Order ready', 'Your order {order} is waiting for its driver.'),
  ('order.ready', 'ln', 'Komandi esili kobongama', 'Komandi na yo {order} ezali kozela livreur.'),
  ('order.ready', 'sw', 'Agizo liko tayari', 'Agizo lako {order} linamsubiri msafirishaji.'),
  ('order.driver_assigned', 'fr', 'Livreur assigné 🛵', 'Un livreur Kin Marché prend en charge votre commande {order}.'),
  ('order.driver_assigned', 'en', 'Driver assigned 🛵', 'A Kin Marché driver is taking care of your order {order}.'),
  ('order.driver_assigned', 'ln', 'Livreur aponami 🛵', 'Livreur ya Kin Marché azwi komandi na yo {order} na maboko.'),
  ('order.driver_assigned', 'sw', 'Msafirishaji amepangwa 🛵', 'Msafirishaji wa Kin Marché anashughulikia agizo lako {order}.'),
  ('order.driver_to_store', 'fr', 'Le livreur va chercher votre commande', 'Il se rend chez {store} pour récupérer la commande {order}.'),
  ('order.driver_to_store', 'en', 'Your driver is heading to the store', 'Going to {store} to collect order {order}.'),
  ('order.driver_to_store', 'ln', 'Livreur azali kokende kozwa komandi na yo', 'Azali kokende na {store} kozwa komandi {order}.'),
  ('order.driver_to_store', 'sw', 'Msafirishaji anaenda kuchukua agizo lako', 'Anaelekea {store} kuchukua agizo {order}.'),
  ('order.picked_up', 'fr', 'Commande récupérée', 'Le livreur a récupéré votre commande {order} chez {store}.'),
  ('order.picked_up', 'en', 'Order picked up', 'The driver has collected your order {order} at {store}.'),
  ('order.picked_up', 'ln', 'Komandi ezwami', 'Livreur azwi komandi na yo {order} na {store}.'),
  ('order.picked_up', 'sw', 'Agizo limechukuliwa', 'Msafirishaji amechukua agizo lako {order} kutoka {store}.'),
  ('order.in_delivery', 'fr', 'En route vers vous 🚚', 'Votre commande {order} est en cours de livraison. Suivez-la en direct dans l''application.'),
  ('order.in_delivery', 'en', 'On its way to you 🚚', 'Your order {order} is out for delivery. Track it live in the app.'),
  ('order.in_delivery', 'ln', 'Ezali koya epai na yo 🚚', 'Komandi na yo {order} ezali na nzela. Landa yango na application.'),
  ('order.in_delivery', 'sw', 'Iko njiani kukujia 🚚', 'Agizo lako {order} liko njiani. Lifuatilie moja kwa moja kwenye programu.'),
  ('order.driver_near', 'fr', 'Votre livreur arrive 📍', 'Il est tout proche. Préparez votre code de livraison à 6 chiffres.'),
  ('order.driver_near', 'en', 'Your driver is nearby 📍', 'Almost there. Have your 6-digit delivery code ready.'),
  ('order.driver_near', 'ln', 'Livreur na yo akomi pene 📍', 'Akomi pene. Bongisa code na yo ya livraison ya bilembo 6.'),
  ('order.driver_near', 'sw', 'Msafirishaji wako yuko karibu 📍', 'Amekaribia. Andaa msimbo wako wa uwasilishaji wa tarakimu 6.'),
  ('order.driver_arrived', 'fr', 'Votre livreur est arrivé 🔔', 'Retrouvez-le et donnez-lui votre code de livraison.'),
  ('order.driver_arrived', 'en', 'Your driver has arrived 🔔', 'Meet your driver and give them your delivery code.'),
  ('order.driver_arrived', 'ln', 'Livreur na yo akomi 🔔', 'Kende kokutana na ye mpe pesa ye code na yo ya livraison.'),
  ('order.driver_arrived', 'sw', 'Msafirishaji wako amefika 🔔', 'Mpokee na umpe msimbo wako wa uwasilishaji.'),
  ('order.recipient_check', 'fr', 'Vérification de la remise', 'Vérifiez votre commande {order} avec le livreur.'),
  ('order.recipient_check', 'en', 'Delivery check', 'Check your order {order} with the driver.'),
  ('order.recipient_check', 'ln', 'Botaleli ya biloko', 'Talela komandi na yo {order} elongo na livreur.'),
  ('order.recipient_check', 'sw', 'Ukaguzi wa uwasilishaji', 'Kagua agizo lako {order} pamoja na msafirishaji.'),
  ('order.delivered', 'fr', 'Commande livrée 🎉', 'Merci d''avoir choisi Kin Marché ! Votre commande {order} vous a été remise.'),
  ('order.delivered', 'en', 'Order delivered 🎉', 'Thank you for choosing Kin Marché! Your order {order} has been handed to you.'),
  ('order.delivered', 'ln', 'Komandi ekomi 🎉', 'Matondi mpo oponi Kin Marché ! Ozwi komandi na yo {order}.'),
  ('order.delivered', 'sw', 'Agizo limewasilishwa 🎉', 'Asante kwa kuchagua Kin Marché! Umekabidhiwa agizo lako {order}.'),
  ('order.completed', 'fr', 'Commande terminée ⭐', 'Donnez votre avis sur la commande {order} : il nous aide à progresser.'),
  ('order.completed', 'en', 'Order completed ⭐', 'Rate your order {order}: your feedback helps us improve.'),
  ('order.completed', 'ln', 'Komandi esili ⭐', 'Pesa likanisi na yo na komandi {order} : ekosalisa biso tokola.'),
  ('order.completed', 'sw', 'Agizo limekamilika ⭐', 'Toa maoni kuhusu agizo {order}: yanatusaidia kuboresha huduma.'),
  ('order.cancelled', 'fr', 'Commande annulée', 'La commande {order} a été annulée. Si vous aviez payé, notre équipe s''occupe du remboursement.'),
  ('order.cancelled', 'en', 'Order cancelled', 'Order {order} has been cancelled. If you had paid, our team will handle the refund.'),
  ('order.cancelled', 'ln', 'Komandi elongolami', 'Komandi {order} elongolami. Soki osilaki kofuta, basali na biso bakozongisela yo mbongo.'),
  ('order.cancelled', 'sw', 'Agizo limeghairiwa', 'Agizo {order} limeghairiwa. Ikiwa ulikuwa umelipa, timu yetu itashughulikia urejeshaji wa pesa.'),
  ('order.failed', 'fr', 'Livraison non aboutie', 'Nous n''avons pas pu livrer la commande {order}. Notre assistance vous contacte.'),
  ('order.failed', 'en', 'Delivery unsuccessful', 'We could not deliver order {order}. Our support team will contact you.'),
  ('order.failed', 'ln', 'Livraison esalemi te', 'Tokokaki te komema komandi {order}. Basali ya lisalisi bakobenga yo.'),
  ('order.failed', 'sw', 'Uwasilishaji haukufaulu', 'Hatukuweza kuwasilisha agizo {order}. Timu yetu ya msaada itawasiliana nawe.'),
  ('order.refunded', 'fr', 'Commande remboursée', 'Le remboursement de la commande {order} a été effectué.'),
  ('order.refunded', 'en', 'Order refunded', 'The refund for order {order} has been completed.'),
  ('order.refunded', 'ln', 'Mbongo ezongisami', 'Mbongo ya komandi {order} ezongisami.'),
  ('order.refunded', 'sw', 'Pesa zimerejeshwa', 'Urejeshaji wa pesa za agizo {order} umekamilika.'),
  -- Compte
  ('welcome', 'fr', 'Bienvenue chez Kin Marché{name} ! 🎉', 'Votre compte est prêt. Faites vos courses au prix du Grand Marché, livrées chez vous.'),
  ('welcome', 'en', 'Welcome to Kin Marché{name}! 🎉', 'Your account is ready. Shop at Grand Marché prices, delivered to your door.'),
  ('welcome', 'ln', 'Boyei malamu na Kin Marché{name} ! 🎉', 'Compte na yo ebongi. Somba biloko na ntalo ya Zando monene, tokomemela yo yango na ndako.'),
  ('welcome', 'sw', 'Karibu Kin Marché{name}! 🎉', 'Akaunti yako iko tayari. Nunua kwa bei ya Grand Marché, tunakuletea nyumbani.'),
  -- Roue de la chance
  ('wheel.spin_granted_one', 'fr', 'Un tour de Roue de la chance offert ! 🎡', 'Merci pour votre commande {order}. Tournez la roue et tentez de gagner un cadeau.'),
  ('wheel.spin_granted_one', 'en', 'You''ve earned a Lucky Wheel spin! 🎡', 'Thank you for your order {order}. Spin the wheel for a chance to win a gift.'),
  ('wheel.spin_granted_one', 'ln', 'Ozwi libaku ya kobalusa Roue de la chance ! 🎡', 'Matondi mpo na komandi {order}. Balusa roue mpe meka kolonga likabo.'),
  ('wheel.spin_granted_one', 'sw', 'Umepata mzunguko wa Gurudumu la Bahati! 🎡', 'Asante kwa agizo lako {order}. Zungusha gurudumu ujaribu kushinda zawadi.'),
  ('wheel.spin_granted_many', 'fr', '{count} tours de Roue de la chance offerts ! 🎡', 'Merci pour votre commande {order}. Tournez la roue et tentez de gagner des cadeaux.'),
  ('wheel.spin_granted_many', 'en', 'You''ve earned {count} Lucky Wheel spins! 🎡', 'Thank you for your order {order}. Spin the wheel for a chance to win gifts.'),
  ('wheel.spin_granted_many', 'ln', 'Ozwi mabaku {count} ya kobalusa Roue de la chance ! 🎡', 'Matondi mpo na komandi {order}. Balusa roue mpe meka kolonga makabo.'),
  ('wheel.spin_granted_many', 'sw', 'Umepata mizunguko {count} ya Gurudumu la Bahati! 🎡', 'Asante kwa agizo lako {order}. Zungusha gurudumu ujaribu kushinda zawadi.'),
  ('wheel.gift_spins_one', 'fr', 'Kin Marché vous offre un tour de roue 🎡', 'Tentez votre chance dans la Roue de la chance.'),
  ('wheel.gift_spins_one', 'en', 'Kin Marché gives you a free spin 🎡', 'Try your luck on the Lucky Wheel.'),
  ('wheel.gift_spins_one', 'ln', 'Kin Marché apesi yo libaku moko ya kobalusa roue 🎡', 'Meka libaku na yo na Roue de la chance.'),
  ('wheel.gift_spins_one', 'sw', 'Kin Marché inakupa mzunguko mmoja 🎡', 'Jaribu bahati yako kwenye Gurudumu la Bahati.'),
  ('wheel.gift_spins_many', 'fr', 'Kin Marché vous offre {count} tours de roue 🎡', 'Tentez votre chance dans la Roue de la chance.'),
  ('wheel.gift_spins_many', 'en', 'Kin Marché gives you {count} free spins 🎡', 'Try your luck on the Lucky Wheel.'),
  ('wheel.gift_spins_many', 'ln', 'Kin Marché apesi yo mabaku {count} ya kobalusa roue 🎡', 'Meka libaku na yo na Roue de la chance.'),
  ('wheel.gift_spins_many', 'sw', 'Kin Marché inakupa mizunguko {count} 🎡', 'Jaribu bahati yako kwenye Gurudumu la Bahati.'),
  ('wheel.won_points', 'fr', 'Félicitations ! +{points} points 🎉', 'Gagnés à la Roue de la chance et ajoutés à votre compte Kin Marché Fidélité.'),
  ('wheel.won_points', 'en', 'Congratulations! +{points} points 🎉', 'Won on the Lucky Wheel and added to your Kin Marché Fidélité account.'),
  ('wheel.won_points', 'ln', 'Felisitasyo ! +{points} points 🎉', 'Olongi yango na Roue de la chance, ebakisami na compte na yo ya Kin Marché Fidélité.'),
  ('wheel.won_points', 'sw', 'Hongera! Pointi +{points} 🎉', 'Umezishinda kwenye Gurudumu la Bahati na zimeongezwa kwenye akaunti yako ya Kin Marché Fidélité.'),
  ('wheel.won_coupon', 'fr', 'Félicitations ! {label} 🎁', 'Votre code {code} est valable jusqu''au {date} sur votre prochaine commande.'),
  ('wheel.won_coupon', 'en', 'Congratulations! {label} 🎁', 'Your code {code} is valid until {date} on your next order.'),
  ('wheel.won_coupon', 'ln', 'Felisitasyo ! {label} 🎁', 'Code na yo {code} ekosala kino {date} na komandi na yo oyo ekoya.'),
  ('wheel.won_coupon', 'sw', 'Hongera! {label} 🎁', 'Msimbo wako {code} unatumika hadi {date} kwenye agizo lako lijalo.'),
  ('wheel.won_product', 'fr', 'Félicitations ! Vous gagnez : {label} 🎁', 'Ce cadeau sera joint gratuitement à votre prochaine commande payée.'),
  ('wheel.won_product', 'en', 'Congratulations! You win: {label} 🎁', 'This gift will be added free of charge to your next paid order.'),
  ('wheel.won_product', 'ln', 'Felisitasyo ! Olongi : {label} 🎁', 'Likabo oyo ekoya ofele elongo na komandi na yo oyo ekoya oyo ofuti.'),
  ('wheel.won_product', 'sw', 'Hongera! Umeshinda: {label} 🎁', 'Zawadi hii itaongezwa bure kwenye agizo lako lijalo lililolipiwa.'),
  ('wheel.won_extra', 'fr', 'Un tour supplémentaire ! 🎡', 'La chance vous sourit : relancez la roue.'),
  ('wheel.won_extra', 'en', 'An extra spin! 🎡', 'Luck is on your side: spin the wheel again.'),
  ('wheel.won_extra', 'ln', 'Libaku mosusu ya kobalusa ! 🎡', 'Libaku ezali na yo : balusa roue lisusu.'),
  ('wheel.won_extra', 'sw', 'Mzunguko wa ziada! 🎡', 'Bahati iko upande wako: zungusha gurudumu tena.'),
  ('wheel.gift_attached', 'fr', 'Votre cadeau arrive avec la commande {order} 🎁', '{label} sera livré avec cette commande.'),
  ('wheel.gift_attached', 'en', 'Your gift comes with order {order} 🎁', '{label} will be delivered with this order.'),
  ('wheel.gift_attached', 'ln', 'Likabo na yo ekoya na komandi {order} 🎁', '{label} ekoya elongo na komandi oyo.'),
  ('wheel.gift_attached', 'sw', 'Zawadi yako inakuja na agizo {order} 🎁', '{label} itawasilishwa pamoja na agizo hili.'),
  ('wheel.gift_delivered', 'fr', 'Cadeau remis 🎁', '{label} vous a été remis. Merci pour votre fidélité !'),
  ('wheel.gift_delivered', 'en', 'Gift delivered 🎁', '{label} has been handed to you. Thank you for your loyalty!'),
  ('wheel.gift_delivered', 'ln', 'Likabo epesami 🎁', 'Ozwi {label}. Matondi mpo na bosembo na yo !'),
  ('wheel.gift_delivered', 'sw', 'Zawadi imekabidhiwa 🎁', 'Umekabidhiwa {label}. Asante kwa uaminifu wako!'),
  ('wheel.reward_cancelled', 'fr', 'Gains de la roue annulés', 'La commande {order} a été annulée : les tours et gains obtenus grâce à elle ont été retirés.'),
  ('wheel.reward_cancelled', 'en', 'Wheel rewards cancelled', 'Order {order} was cancelled: the spins and rewards earned with it have been withdrawn.'),
  ('wheel.reward_cancelled', 'ln', 'Makabo ya roue elongolami', 'Komandi {order} elongolami : mabaku mpe makabo oyo ozwaki na yango elongolami.'),
  ('wheel.reward_cancelled', 'sw', 'Zawadi za gurudumu zimefutwa', 'Agizo {order} limeghairiwa: mizunguko na zawadi ulizopata kupitia agizo hilo zimeondolewa.')
on conflict (key, language) do update set title = excluded.title, body = excluded.body, updated_at = now();

-- ---------------------------------------------------------------------
-- 3. Notification à chaque étape de la commande
-- ---------------------------------------------------------------------

create or replace function public.tg_order_status_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_store text;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_status_history (order_id, status, actor_id)
    values (new.id, new.status, auth.uid());
    -- Une notification ne doit jamais bloquer le suivi de la commande.
    begin
      select name into v_store from public.stores where id = new.store_id;
      perform public._notify(new.customer_id, 'order_status', 'order.' || new.status::text,
        jsonb_build_object('order', new.order_number, 'store', coalesce(v_store, 'Kin Marché')),
        jsonb_build_object('order_id', new.id, 'status', new.status));
    exception when others then
      raise warning 'notification de commande non créée (%): %', new.order_number, sqlerrm;
    end;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4. Bienvenue à la création du compte client
-- ---------------------------------------------------------------------

create or replace function public.tg_profile_welcome()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_first text;
begin
  if new.role = 'customer' then
    begin
      v_first := nullif(split_part(trim(coalesce(new.full_name, '')), ' ', 1), '');
      perform public._notify(new.id, 'welcome', 'welcome',
        jsonb_build_object('name', case when v_first is null then '' else ', ' || v_first end),
        jsonb_build_object('screen', 'home'));
    exception when others then
      raise warning 'notification de bienvenue non créée : %', sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists profiles_welcome on public.profiles;
create trigger profiles_welcome after insert on public.profiles
  for each row execute function public.tg_profile_welcome();

-- ---------------------------------------------------------------------
-- 5. Codes promo personnels
-- ---------------------------------------------------------------------

alter table public.coupons add column if not exists assigned_user_id uuid references public.profiles(id) on delete cascade;
create index if not exists coupons_assigned_idx on public.coupons (assigned_user_id) where assigned_user_id is not null;
drop policy if exists "coupons : les miens" on public.coupons;
create policy "coupons : les miens" on public.coupons for select to authenticated
  using (assigned_user_id = (select auth.uid()));

-- Un code personnel n'est accepté que pour son titulaire.
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public._order_quote(uuid,uuid,text,integer)'::regprocedure);
  if position('assigned_user_id' in d) = 0 then
    n := replace(d,
      'or (v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit) then',
      'or (v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit)
       or (v_coupon.assigned_user_id is not null and v_coupon.assigned_user_id is distinct from p_user) then');
    if n = d then raise exception '_order_quote : extrait à remplacer introuvable'; end if;
    execute n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Roue de la chance
-- ---------------------------------------------------------------------

insert into public.app_settings (key, value) values
  ('wheel', '{"enabled": true, "min_order_usd": 50, "spins_per_order": 1, "spin_validity_days": 30, "coupon_validity_days": 30}')
on conflict (key) do nothing;

create or replace function public._wheel_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select '{"enabled": true, "min_order_usd": 50, "spins_per_order": 1, "spin_validity_days": 30, "coupon_validity_days": 30}'::jsonb
         || coalesce(public.setting('wheel'), '{}'::jsonb)
$$;

create table if not exists public.wheel_prizes (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(trim(label)) between 1 and 40),
  label_i18n jsonb not null default '{}'::jsonb,
  kind text not null check (kind in ('points', 'coupon_percent', 'coupon_fixed', 'product', 'extra_spin', 'nothing')),
  value numeric(12,2) not null default 0 check (value >= 0),
  product_id uuid references public.products(id) on delete restrict,
  quantity integer not null default 1 check (quantity between 1 and 100),
  min_order_usd numeric(12,2) not null default 0 check (min_order_usd >= 0),
  weight numeric(10,3) not null default 1 check (weight >= 0),
  stock integer check (stock is null or stock >= 0),
  won_count integer not null default 0,
  color text not null default '#DE3530' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wheel_prizes_value_chk check (
    (kind = 'points' and value >= 1 and value = trunc(value))
    or (kind = 'coupon_percent' and value > 0 and value <= 100)
    or (kind = 'coupon_fixed' and value > 0)
    or (kind = 'product' and product_id is not null)
    or kind in ('extra_spin', 'nothing'))
);

create table if not exists public.wheel_spins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Commande qui a donné le tour (aussi pour les tours gagnés à la roue : ils suivent son sort).
  order_id uuid references public.orders(id) on delete set null,
  source text not null check (source in ('order', 'extra', 'admin')),
  status text not null default 'available' check (status in ('available', 'used', 'revoked', 'expired')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz,
  prize_id uuid references public.wheel_prizes(id) on delete set null,
  result jsonb,
  granted_by uuid references public.profiles(id) on delete set null,
  note text
);
create index if not exists wheel_spins_user_idx on public.wheel_spins (user_id, status, granted_at desc);
create index if not exists wheel_spins_order_idx on public.wheel_spins (order_id) where order_id is not null;

create table if not exists public.wheel_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  spin_id uuid not null unique references public.wheel_spins(id) on delete cascade,
  prize_id uuid references public.wheel_prizes(id) on delete set null,
  kind text not null,
  label text not null,
  points integer,
  coupon_id uuid references public.coupons(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  quantity integer not null default 1,
  extra_spin_id uuid references public.wheel_spins(id) on delete set null,
  -- credited : points ou tour ajoutés · issued : code promo créé · pending → attached → delivered : cadeau
  status text not null default 'pending' check (status in ('pending', 'attached', 'delivered', 'credited', 'issued', 'cancelled')),
  order_id uuid references public.orders(id) on delete set null,
  claim_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null,
  note text
);
create index if not exists wheel_rewards_user_idx on public.wheel_rewards (user_id, created_at desc);
create index if not exists wheel_rewards_status_idx on public.wheel_rewards (status, created_at desc);
create index if not exists wheel_rewards_order_idx on public.wheel_rewards (order_id) where order_id is not null;

alter table public.wheel_prizes enable row level security;
alter table public.wheel_spins enable row level security;
alter table public.wheel_rewards enable row level security;
drop policy if exists "roue : lots (administration)" on public.wheel_prizes;
create policy "roue : lots (administration)" on public.wheel_prizes for select to authenticated using (public.is_super_admin());
drop policy if exists "roue : mes tours" on public.wheel_spins;
create policy "roue : mes tours" on public.wheel_spins for select to authenticated
  using (user_id = (select auth.uid()) or public.is_super_admin());
drop policy if exists "roue : mes gains" on public.wheel_rewards;
create policy "roue : mes gains" on public.wheel_rewards for select to authenticated
  using (user_id = (select auth.uid()) or public.is_super_admin()
         or (order_id is not null and public.is_order_store_manager(order_id)));
-- Aucune écriture directe : tout passe par les fonctions ci-dessous.
revoke insert, update, delete on public.wheel_prizes, public.wheel_spins, public.wheel_rewards from anon, authenticated;

-- Lots de départ (modifiables par l'administrateur général), seulement à la première installation.
insert into public.wheel_prizes (label, label_i18n, kind, value, min_order_usd, weight, color, sort_order)
select v.label, v.i18n::jsonb, v.kind, v.value, v.min_order, v.weight, v.color, v.sort_order
from (values
  ('50 points', '{"en": "50 points", "ln": "50 points", "sw": "Pointi 50"}', 'points', 50, 0, 30, '#DE3530', 1),
  ('-5 %', '{"en": "5% off", "ln": "-5 %", "sw": "Punguzo 5%"}', 'coupon_percent', 5, 20, 18, '#0097FC', 2),
  ('100 points', '{"en": "100 points", "ln": "100 points", "sw": "Pointi 100"}', 'points', 100, 0, 14, '#E8A317', 3),
  ('Tour gratuit', '{"en": "Free spin", "ln": "Libaku ya ofele", "sw": "Mzunguko bure"}', 'extra_spin', 0, 0, 10, '#13A35F', 4),
  ('-2 $', '{"en": "$2 off", "ln": "-2 $", "sw": "Punguzo $2"}', 'coupon_fixed', 2, 20, 10, '#01789D', 5),
  ('200 points', '{"en": "200 points", "ln": "200 points", "sw": "Pointi 200"}', 'points', 200, 0, 5, '#7B3FE4', 6),
  ('Pas de chance', '{"en": "No luck", "ln": "Libaku te", "sw": "Hakuna bahati"}', 'nothing', 0, 0, 13, '#5B6472', 7)
) as v(label, i18n, kind, value, min_order, weight, color, sort_order)
where not exists (select 1 from public.wheel_prizes);

-- Lots tirables : actifs, avec du stock, et produit encore au catalogue pour un cadeau.
create or replace function public._wheel_drawable(p public.wheel_prizes)
returns boolean language sql stable security definer set search_path = '' as $$
  select p.is_active and p.weight > 0 and (p.stock is null or p.stock > 0)
     and (p.kind <> 'product' or exists (select 1 from public.products pr where pr.id = p.product_id and pr.is_active))
$$;

create or replace function public._wheel_grant(p_user uuid, p_count integer, p_source text,
  p_order uuid default null, p_by uuid default null, p_note text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_days integer := greatest(coalesce((public._wheel_settings()->>'spin_validity_days')::integer, 30), 1);
  v_n integer := least(greatest(coalesce(p_count, 0), 0), 50);
  i integer;
begin
  for i in 1..v_n loop
    insert into public.wheel_spins (user_id, order_id, source, expires_at, granted_by, note)
    values (p_user, p_order, p_source, now() + make_interval(days => v_days), p_by, p_note);
  end loop;
  return v_n;
end $$;

-- Commande payée : cadeaux en attente joints à la commande, puis tours offerts dès le montant minimum.
create or replace function public._wheel_order_paid(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_s jsonb := public._wheel_settings();
  v_n integer;
  r record;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.payment_status <> 'succeeded' or v_order.status in ('cancelled', 'refunded', 'failed') then
    return;
  end if;

  for r in update public.wheel_rewards set status = 'attached', order_id = v_order.id, updated_at = now()
            where user_id = v_order.customer_id and kind = 'product' and status = 'pending'
            returning label loop
    perform public._notify(v_order.customer_id, 'wheel', 'wheel.gift_attached',
      jsonb_build_object('order', v_order.order_number, 'label', r.label),
      jsonb_build_object('screen', 'wheel', 'order_id', v_order.id));
  end loop;

  if v_s -> 'enabled' = 'false'::jsonb then return; end if;
  if v_order.total_usd < coalesce((v_s->>'min_order_usd')::numeric, 50) then return; end if;
  if exists (select 1 from public.wheel_spins where order_id = p_order_id and source = 'order') then return; end if;
  v_n := public._wheel_grant(v_order.customer_id, greatest(coalesce((v_s->>'spins_per_order')::integer, 1), 1), 'order', p_order_id);
  if v_n > 0 then
    perform public._notify(v_order.customer_id, 'wheel',
      case when v_n = 1 then 'wheel.spin_granted_one' else 'wheel.spin_granted_many' end,
      jsonb_build_object('order', v_order.order_number, 'count', v_n),
      jsonb_build_object('screen', 'wheel', 'order_id', v_order.id));
  end if;
end $$;

-- Commande livrée : les cadeaux joints sont remis.
create or replace function public._wheel_order_delivered(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in update public.wheel_rewards set status = 'delivered', handled_at = now(), updated_at = now()
            where order_id = p_order_id and status = 'attached'
            returning user_id, label loop
    perform public._notify(r.user_id, 'wheel', 'wheel.gift_delivered',
      jsonb_build_object('label', r.label), jsonb_build_object('screen', 'wheel', 'order_id', p_order_id));
  end loop;
end $$;

-- Livraison échouée : les cadeaux joints repartent en attente (prochaine commande).
create or replace function public._wheel_order_detach(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.wheel_rewards set status = 'pending', order_id = null, updated_at = now()
   where order_id = p_order_id and status = 'attached';
end $$;

-- Commande annulée ou remboursée : tours non utilisés retirés, gains obtenus avec eux annulés
-- (points retirés dans la limite du solde, code promo désactivé s'il n'a pas servi, cadeau non remis annulé).
create or replace function public._wheel_order_revoked(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_any boolean := false;
  v_bal integer;
  v_take integer;
  v_n integer;
  r record;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then return; end if;

  perform public._wheel_order_detach(p_order_id);

  update public.wheel_spins set status = 'revoked', note = coalesce(note || ' · ', '') || 'Commande ' || v_order.order_number || ' annulée'
   where order_id = p_order_id and status = 'available';
  get diagnostics v_n = row_count;
  v_any := v_n > 0;

  for r in select rw.* from public.wheel_rewards rw join public.wheel_spins s on s.id = rw.spin_id
            where s.order_id = p_order_id and rw.status in ('pending', 'attached', 'credited', 'issued')
            for update of rw loop
    if r.kind = 'points' and coalesce(r.points, 0) > 0 then
      select points_balance into v_bal from public.loyalty_accounts where user_id = r.user_id for update;
      v_take := least(coalesce(v_bal, 0), r.points);
      if v_take > 0 then
        insert into public.loyalty_transactions (user_id, type, points, note)
        values (r.user_id, 'adjust', -v_take, 'Roue de la chance annulée (commande ' || v_order.order_number || ')');
        update public.loyalty_accounts set points_balance = points_balance - v_take, updated_at = now() where user_id = r.user_id;
      end if;
    elsif r.kind in ('coupon_percent', 'coupon_fixed') then
      if exists (select 1 from public.coupons c where c.id = r.coupon_id and c.used_count > 0) then
        continue; -- code déjà utilisé : rien à reprendre
      end if;
      update public.coupons set is_active = false where id = r.coupon_id;
    elsif r.kind = 'extra_spin' then
      update public.wheel_spins set status = 'revoked' where id = r.extra_spin_id and status = 'available';
    end if;
    update public.wheel_rewards set status = 'cancelled', updated_at = now(),
           note = 'Commande ' || v_order.order_number || ' annulée ou remboursée'
     where id = r.id;
    v_any := true;
  end loop;

  if v_any then
    perform public._notify(v_order.customer_id, 'wheel', 'wheel.reward_cancelled',
      jsonb_build_object('order', v_order.order_number), jsonb_build_object('screen', 'wheel', 'order_id', p_order_id));
  end if;
end $$;

create or replace function public.tg_wheel_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- La roue ne doit jamais bloquer un paiement ni une livraison.
  begin
    if new.payment_status = 'succeeded' and old.payment_status is distinct from 'succeeded' then
      perform public._wheel_order_paid(new.id);
    end if;
    if new.status in ('delivered', 'completed') and old.status is distinct from new.status then
      perform public._wheel_order_delivered(new.id);
    end if;
    if new.status = 'failed' and old.status is distinct from new.status then
      perform public._wheel_order_detach(new.id);
    end if;
    if (new.status in ('cancelled', 'refunded') and old.status is distinct from new.status)
       or (new.payment_status = 'refunded' and old.payment_status is distinct from 'refunded') then
      perform public._wheel_order_revoked(new.id);
    end if;
  exception when others then
    raise warning 'roue de la chance (commande %) : %', new.order_number, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists orders_wheel on public.orders;
create trigger orders_wheel after update of payment_status, status on public.orders
  for each row execute function public.tg_wheel_order();

-- Lots tels que la roue les affiche (même ordre que le tirage), avec la chance de gain.
create or replace function public._wheel_public_prizes()
returns jsonb language sql stable security definer set search_path = '' as $$
  with p as (
    select wp.*, sum(wp.weight) over () as total
    from public.wheel_prizes wp where public._wheel_drawable(wp)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'label', p.label, 'label_i18n', p.label_i18n, 'kind', p.kind, 'value', p.value,
      'color', p.color, 'min_order_usd', p.min_order_usd, 'quantity', p.quantity,
      'chance', round(100 * p.weight / nullif(p.total, 0), 1),
      'product_name', pr.name,
      'image_url', (select pi.url from public.product_images pi where pi.product_id = p.product_id order by pi.sort_order, pi.created_at limit 1))
    order by p.sort_order, p.created_at, p.id), '[]'::jsonb)
  from p left join public.products pr on pr.id = p.product_id
$$;

-- Visiteur : règles et lots (sans données personnelles).
create or replace function public.get_wheel_public()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'enabled', coalesce((s->>'enabled')::boolean, true),
    'min_order_usd', coalesce((s->>'min_order_usd')::numeric, 50),
    'spins_per_order', coalesce((s->>'spins_per_order')::integer, 1),
    'spin_validity_days', coalesce((s->>'spin_validity_days')::integer, 30),
    'prizes', public._wheel_public_prizes())
  from (select public._wheel_settings() as s) x
$$;

-- Client connecté : tours disponibles, lots, gains et historique.
create or replace function public.get_my_wheel()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  return public.get_wheel_public() || jsonb_build_object(
    'spins_available', (select count(*) from public.wheel_spins
                        where user_id = v_uid and status = 'available' and (expires_at is null or expires_at > now())),
    'next_expiry', (select min(expires_at) from public.wheel_spins
                    where user_id = v_uid and status = 'available' and expires_at > now()),
    'rewards', (select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) from (
        select rw.created_at, jsonb_build_object(
          'id', rw.id, 'kind', rw.kind, 'label', rw.label, 'points', rw.points, 'status', rw.status,
          'quantity', rw.quantity, 'claim_code', rw.claim_code, 'created_at', rw.created_at, 'note', rw.note,
          'coupon_code', c.code, 'coupon_ends_at', c.ends_at, 'coupon_min_order_usd', c.min_order_usd,
          'coupon_used', coalesce(c.used_count, 0) > 0, 'coupon_active', coalesce(c.is_active, false),
          'product_name', pr.name, 'order_number', o.order_number,
          'image_url', (select pi.url from public.product_images pi where pi.product_id = rw.product_id order by pi.sort_order, pi.created_at limit 1)) as j
        from public.wheel_rewards rw
        left join public.coupons c on c.id = rw.coupon_id
        left join public.products pr on pr.id = rw.product_id
        left join public.orders o on o.id = rw.order_id
        where rw.user_id = v_uid order by rw.created_at desc limit 50) x),
    'history', (select coalesce(jsonb_agg(x.j order by x.used_at desc), '[]'::jsonb) from (
        select s.used_at, jsonb_build_object('used_at', s.used_at, 'label', s.result->>'label', 'kind', s.result->>'kind') as j
        from public.wheel_spins s where s.user_id = v_uid and s.status = 'used' order by s.used_at desc limit 20) x));
end $$;

-- Tirage au sort côté serveur (pondéré par l'administrateur), puis attribution du gain.
create or replace function public.spin_wheel()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_s jsonb := public._wheel_settings();
  v_spin public.wheel_spins;
  v_prize public.wheel_prizes;
  v_prize_id uuid;
  v_total numeric;
  v_pick numeric;
  v_try integer;
  v_lang text;
  v_label text;
  v_status text;
  v_reward_id uuid;
  v_coupon_id uuid;
  v_code text;
  v_ends timestamptz;
  v_extra uuid;
  v_rules jsonb := coalesce(public.setting('loyalty'), '{}'::jsonb);
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_s -> 'enabled' = 'false'::jsonb then raise exception 'WHEEL_DISABLED'; end if;

  update public.wheel_spins set status = 'expired'
   where user_id = v_uid and status = 'available' and expires_at is not null and expires_at <= now();
  select * into v_spin from public.wheel_spins
   where user_id = v_uid and status = 'available'
   order by expires_at nulls last, granted_at
   limit 1 for update skip locked;
  if not found then raise exception 'NO_SPIN_AVAILABLE'; end if;

  for v_try in 1..5 loop
    select coalesce(sum(wp.weight), 0) into v_total from public.wheel_prizes wp where public._wheel_drawable(wp);
    if v_total <= 0 then raise exception 'WHEEL_EMPTY'; end if;
    v_pick := random() * v_total;
    select x.id into v_prize_id from (
      select wp.id, sum(wp.weight) over (order by wp.sort_order, wp.created_at, wp.id) as cum
      from public.wheel_prizes wp where public._wheel_drawable(wp)) x
    where x.cum > v_pick order by x.cum limit 1;
    if v_prize_id is not null then
      select * into v_prize from public.wheel_prizes where id = v_prize_id for update;
      exit when public._wheel_drawable(v_prize);
    end if;
    v_prize_id := null;
  end loop;
  if v_prize_id is null then raise exception 'WHEEL_BUSY'; end if;

  update public.wheel_prizes
     set stock = case when stock is null then null else stock - 1 end, won_count = won_count + 1, updated_at = now()
   where id = v_prize.id;

  select language::text into v_lang from public.profiles where id = v_uid;
  v_label := coalesce(nullif(v_prize.label_i18n->>coalesce(v_lang, 'fr'), ''), v_prize.label);

  if v_prize.kind = 'points' then
    insert into public.loyalty_accounts (user_id) values (v_uid) on conflict do nothing;
    insert into public.loyalty_transactions (user_id, type, points, expires_at, note)
    values (v_uid, 'earn', v_prize.value::integer,
            now() + make_interval(days => coalesce((v_rules->>'expiry_days')::integer, 365)), 'Roue de la chance');
    update public.loyalty_accounts
       set points_balance = points_balance + v_prize.value::integer,
           lifetime_points = lifetime_points + v_prize.value::integer, updated_at = now()
     where user_id = v_uid;
    v_status := 'credited';
  elsif v_prize.kind in ('coupon_percent', 'coupon_fixed') then
    v_ends := now() + make_interval(days => greatest(coalesce((v_s->>'coupon_validity_days')::integer, 30), 1));
    loop
      v_code := 'ROUE-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      exit when not exists (select 1 from public.coupons where upper(code) = v_code);
    end loop;
    insert into public.coupons (code, description, discount_type, discount_value, min_order_usd, starts_at, ends_at,
                                usage_limit, per_user_limit, is_public, is_active, assigned_user_id)
    values (v_code, 'Roue de la chance : ' || v_prize.label,
            (case when v_prize.kind = 'coupon_percent' then 'percent' else 'fixed' end)::public.discount_type,
            v_prize.value, v_prize.min_order_usd, now(), v_ends, 1, 1, false, true, v_uid)
    returning id into v_coupon_id;
    v_status := 'issued';
  elsif v_prize.kind = 'product' then
    v_status := 'pending';
  elsif v_prize.kind = 'extra_spin' then
    insert into public.wheel_spins (user_id, order_id, source, expires_at, note)
    values (v_uid, v_spin.order_id, 'extra',
            now() + make_interval(days => greatest(coalesce((v_s->>'spin_validity_days')::integer, 30), 1)),
            'Tour gagné à la roue')
    returning id into v_extra;
    v_status := 'credited';
  end if;

  update public.wheel_spins set status = 'used', used_at = now(), prize_id = v_prize.id,
         result = jsonb_build_object('label', v_label, 'kind', v_prize.kind, 'value', v_prize.value)
   where id = v_spin.id;

  if v_prize.kind <> 'nothing' then
    insert into public.wheel_rewards (user_id, spin_id, prize_id, kind, label, points, coupon_id, product_id, quantity, extra_spin_id, status)
    values (v_uid, v_spin.id, v_prize.id, v_prize.kind, v_label,
            case when v_prize.kind = 'points' then v_prize.value::integer end,
            v_coupon_id, case when v_prize.kind = 'product' then v_prize.product_id end,
            v_prize.quantity, v_extra, v_status)
    returning id into v_reward_id;

    if v_prize.kind = 'points' then
      perform public._notify(v_uid, 'wheel', 'wheel.won_points', jsonb_build_object('points', v_prize.value::integer),
        jsonb_build_object('screen', 'wheel', 'push', false));
    elsif v_prize.kind in ('coupon_percent', 'coupon_fixed') then
      perform public._notify(v_uid, 'wheel', 'wheel.won_coupon',
        jsonb_build_object('label', v_label, 'code', v_code, 'date', to_char(v_ends at time zone 'Africa/Kinshasa', 'DD/MM/YYYY')),
        jsonb_build_object('screen', 'wheel', 'push', false));
    elsif v_prize.kind = 'product' then
      perform public._notify(v_uid, 'wheel', 'wheel.won_product', jsonb_build_object('label', v_label),
        jsonb_build_object('screen', 'wheel', 'push', false));
    elsif v_prize.kind = 'extra_spin' then
      perform public._notify(v_uid, 'wheel', 'wheel.won_extra', '{}'::jsonb,
        jsonb_build_object('screen', 'wheel', 'push', false));
    end if;
  end if;

  return jsonb_build_object(
    'prize_id', v_prize.id, 'kind', v_prize.kind, 'label', v_label, 'value', v_prize.value,
    'reward_id', v_reward_id, 'coupon_code', v_code, 'coupon_ends_at', v_ends, 'min_order_usd', v_prize.min_order_usd,
    'spins_left', (select count(*) from public.wheel_spins
                   where user_id = v_uid and status = 'available' and (expires_at is null or expires_at > now())));
end $$;

-- ---------------------------------------------------------------------
-- 7. Administration (administrateur général) et supermarchés
-- ---------------------------------------------------------------------

create or replace function public.admin_wheel_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'settings', public._wheel_settings(),
    'prizes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', wp.id, 'label', wp.label, 'label_i18n', wp.label_i18n, 'kind', wp.kind, 'value', wp.value,
        'product_id', wp.product_id, 'product_name', pr.name, 'quantity', wp.quantity, 'min_order_usd', wp.min_order_usd,
        'weight', wp.weight, 'stock', wp.stock, 'won_count', wp.won_count, 'color', wp.color,
        'is_active', wp.is_active, 'sort_order', wp.sort_order, 'drawable', public._wheel_drawable(wp),
        'chance', case when public._wheel_drawable(wp) then round(100 * wp.weight / nullif(t.total, 0), 1) end)
        order by wp.sort_order, wp.created_at, wp.id), '[]'::jsonb)
      from public.wheel_prizes wp
      left join public.products pr on pr.id = wp.product_id
      cross join (select sum(x.weight) as total from public.wheel_prizes x where public._wheel_drawable(x)) t),
    'stats', jsonb_build_object(
      'spins_granted', (select count(*) from public.wheel_spins),
      'spins_used', (select count(*) from public.wheel_spins where status = 'used'),
      'spins_available', (select count(*) from public.wheel_spins where status = 'available' and (expires_at is null or expires_at > now())),
      'spins_expired', (select count(*) from public.wheel_spins where status = 'expired' or (status = 'available' and expires_at <= now())),
      'spins_revoked', (select count(*) from public.wheel_spins where status = 'revoked'),
      'spins_30d', (select count(*) from public.wheel_spins where status = 'used' and used_at > now() - interval '30 days'),
      'players', (select count(distinct user_id) from public.wheel_spins where status = 'used'),
      'points_awarded', (select coalesce(sum(points), 0) from public.wheel_rewards where kind = 'points' and status = 'credited'),
      'coupons_issued', (select count(*) from public.wheel_rewards where kind in ('coupon_percent', 'coupon_fixed') and status = 'issued'),
      'coupons_used', (select count(*) from public.wheel_rewards rw join public.coupons c on c.id = rw.coupon_id where c.used_count > 0),
      'gifts_pending', (select count(*) from public.wheel_rewards where kind = 'product' and status = 'pending'),
      'gifts_attached', (select count(*) from public.wheel_rewards where kind = 'product' and status = 'attached'),
      'gifts_delivered', (select count(*) from public.wheel_rewards where kind = 'product' and status = 'delivered')));
end $$;

create or replace function public.admin_update_wheel_settings(p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb;
  v_min numeric;
  v_spins integer;
  v_days integer;
  v_cdays integer;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  begin
    v_min := (p_settings->>'min_order_usd')::numeric;
    v_spins := (p_settings->>'spins_per_order')::integer;
    v_days := (p_settings->>'spin_validity_days')::integer;
    v_cdays := (p_settings->>'coupon_validity_days')::integer;
  exception when others then
    raise exception 'INVALID_SETTINGS';
  end;
  if v_min is null or v_min < 0 or v_min > 100000 or v_spins is null or v_spins not between 1 and 10
     or v_days is null or v_days not between 1 and 365 or v_cdays is null or v_cdays not between 1 and 365 then
    raise exception 'INVALID_SETTINGS';
  end if;
  v_new := public._wheel_settings() || jsonb_build_object(
    'enabled', coalesce((p_settings->>'enabled')::boolean, true),
    'min_order_usd', trim_scale(round(v_min, 2)), 'spins_per_order', v_spins,
    'spin_validity_days', v_days, 'coupon_validity_days', v_cdays);
  insert into public.app_settings (key, value, updated_at, updated_by) values ('wheel', v_new, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform public.write_audit('wheel_settings', 'app_settings', 'wheel', v_new);
  return v_new;
end $$;

-- Création (p_id null) ou modification d'un lot.
create or replace function public.admin_save_wheel_prize(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_kind text := p->>'kind';
  v_label text := trim(coalesce(p->>'label', ''));
  v_i18n jsonb := '{}'::jsonb;
  v_lang text;
  v_value numeric;
  v_weight numeric;
  v_stock integer;
  v_qty integer;
  v_min numeric;
  v_sort integer;
  v_product uuid;
  v_color text := coalesce(nullif(p->>'color', ''), '#DE3530');
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_kind not in ('points', 'coupon_percent', 'coupon_fixed', 'product', 'extra_spin', 'nothing') then raise exception 'INVALID_PRIZE_KIND'; end if;
  if length(v_label) not between 1 and 40 then raise exception 'INVALID_PRIZE_LABEL'; end if;
  begin
    v_value := coalesce(nullif(p->>'value', '')::numeric, 0);
    v_weight := coalesce(nullif(p->>'weight', '')::numeric, 1);
    v_stock := nullif(p->>'stock', '')::integer;
    v_qty := coalesce(nullif(p->>'quantity', '')::integer, 1);
    v_min := coalesce(nullif(p->>'min_order_usd', '')::numeric, 0);
    v_sort := coalesce(nullif(p->>'sort_order', '')::integer, 0);
    v_product := nullif(p->>'product_id', '')::uuid;
  exception when others then
    raise exception 'INVALID_PRIZE';
  end;
  if v_weight < 0 or v_weight > 100000 or (v_stock is not null and v_stock < 0) or v_min < 0 then raise exception 'INVALID_PRIZE'; end if;
  if v_kind = 'points' and (v_value < 1 or v_value <> trunc(v_value) or v_value > 1000000) then raise exception 'INVALID_PRIZE_VALUE'; end if;
  if v_kind = 'coupon_percent' and (v_value <= 0 or v_value > 100) then raise exception 'INVALID_PRIZE_VALUE'; end if;
  if v_kind = 'coupon_fixed' and (v_value <= 0 or v_value > 10000) then raise exception 'INVALID_PRIZE_VALUE'; end if;
  if v_kind = 'product' and not exists (select 1 from public.products where id = v_product) then raise exception 'INVALID_PRIZE_PRODUCT'; end if;
  if v_kind <> 'product' then v_product := null; end if;
  if v_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'INVALID_PRIZE_COLOR'; end if;
  foreach v_lang in array array['en', 'ln', 'sw'] loop
    if length(trim(coalesce(p->'label_i18n'->>v_lang, ''))) between 1 and 40 then
      v_i18n := v_i18n || jsonb_build_object(v_lang, trim(p->'label_i18n'->>v_lang));
    end if;
  end loop;

  if p_id is null then
    insert into public.wheel_prizes (label, label_i18n, kind, value, product_id, quantity, min_order_usd, weight, stock, color, is_active, sort_order)
    values (v_label, v_i18n, v_kind, v_value, v_product, greatest(least(v_qty, 100), 1), v_min, v_weight, v_stock, v_color,
            coalesce((p->>'is_active')::boolean, true), v_sort)
    returning id into v_id;
  else
    update public.wheel_prizes set label = v_label, label_i18n = v_i18n, kind = v_kind, value = v_value, product_id = v_product,
           quantity = greatest(least(v_qty, 100), 1), min_order_usd = v_min, weight = v_weight, stock = v_stock, color = v_color,
           is_active = coalesce((p->>'is_active')::boolean, is_active), sort_order = v_sort, updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'PRIZE_NOT_FOUND'; end if;
  end if;
  perform public.write_audit('wheel_prize_saved', 'wheel_prizes', v_id::text, p);
  return v_id;
end $$;

-- Un lot déjà gagné est seulement désactivé (l'historique des gains est conservé).
create or replace function public.admin_delete_wheel_prize(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if exists (select 1 from public.wheel_spins where prize_id = p_id) or exists (select 1 from public.wheel_rewards where prize_id = p_id) then
    update public.wheel_prizes set is_active = false, updated_at = now() where id = p_id;
    perform public.write_audit('wheel_prize_disabled', 'wheel_prizes', p_id::text, null);
    return 'disabled';
  end if;
  delete from public.wheel_prizes where id = p_id;
  perform public.write_audit('wheel_prize_deleted', 'wheel_prizes', p_id::text, null);
  return 'deleted';
end $$;

create or replace function public.admin_wheel_rewards(p_status text default null, p_kind text default null,
  p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return (
    with f as (
      select rw.*, pr.full_name, pr.phone, pr.email, o.order_number, st.name as store_name, c.code as coupon_code,
             c.used_count as coupon_used, p.name as product_name
      from public.wheel_rewards rw
      join public.profiles pr on pr.id = rw.user_id
      left join public.orders o on o.id = rw.order_id
      left join public.stores st on st.id = o.store_id
      left join public.coupons c on c.id = rw.coupon_id
      left join public.products p on p.id = rw.product_id
      where (p_status is null or p_status = '' or rw.status = p_status)
        and (p_kind is null or p_kind = '' or (p_kind = 'coupon' and rw.kind in ('coupon_percent', 'coupon_fixed')) or rw.kind = p_kind)
        and (v_q is null or pr.full_name ilike '%' || v_q || '%' or pr.email ilike '%' || v_q || '%'
             or pr.phone ilike '%' || v_q || '%' or rw.claim_code ilike '%' || v_q || '%' or c.code ilike '%' || v_q || '%'
             or o.order_number ilike '%' || v_q || '%')
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'id', f.id, 'user_id', f.user_id, 'full_name', f.full_name, 'phone', f.phone, 'email', f.email,
          'kind', f.kind, 'label', f.label, 'points', f.points, 'status', f.status, 'claim_code', f.claim_code,
          'coupon_code', f.coupon_code, 'coupon_used', coalesce(f.coupon_used, 0) > 0, 'product_name', f.product_name,
          'quantity', f.quantity, 'order_number', f.order_number, 'store_name', f.store_name, 'note', f.note,
          'created_at', f.created_at, 'handled_at', f.handled_at) order by f.created_at desc)
        from (select * from f order by f.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)
              offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb)));
end $$;

-- deliver : cadeau remis (en magasin ou livré) · cancel : gain annulé · reset : cadeau remis en attente
create or replace function public.admin_set_wheel_reward(p_id uuid, p_action text, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_r public.wheel_rewards;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_r from public.wheel_rewards where id = p_id for update;
  if not found then raise exception 'REWARD_NOT_FOUND'; end if;
  if p_action = 'deliver' then
    if v_r.kind <> 'product' or v_r.status not in ('pending', 'attached') then raise exception 'REWARD_STATE'; end if;
    update public.wheel_rewards set status = 'delivered', handled_at = now(), handled_by = auth.uid(), updated_at = now(),
           note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note) where id = p_id;
    perform public._notify(v_r.user_id, 'wheel', 'wheel.gift_delivered', jsonb_build_object('label', v_r.label),
      jsonb_build_object('screen', 'wheel'));
  elsif p_action = 'cancel' then
    if v_r.status not in ('pending', 'attached', 'issued') then raise exception 'REWARD_STATE'; end if;
    if v_r.coupon_id is not null then
      update public.coupons set is_active = false where id = v_r.coupon_id and used_count = 0;
    end if;
    update public.wheel_rewards set status = 'cancelled', order_id = null, handled_at = now(), handled_by = auth.uid(),
           updated_at = now(), note = coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Annulé par l''administration') where id = p_id;
  elsif p_action = 'reset' then
    if v_r.status <> 'attached' then raise exception 'REWARD_STATE'; end if;
    update public.wheel_rewards set status = 'pending', order_id = null, updated_at = now(),
           note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note) where id = p_id;
  else
    raise exception 'INVALID_ACTION';
  end if;
  perform public.write_audit('wheel_reward_' || p_action, 'wheel_rewards', p_id::text, jsonb_build_object('note', p_note));
  return p_action;
end $$;

-- Tours offerts par l'administration à un client (recherché par e-mail ou téléphone).
create or replace function public.admin_grant_wheel_spins(p_query text, p_count integer, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_q text := trim(coalesce(p_query, ''));
  v_user public.profiles;
  v_matches integer;
  v_n integer;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_count is null or p_count not between 1 and 20 then raise exception 'INVALID_COUNT'; end if;
  if length(v_q) < 3 then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  select count(*) into v_matches from public.profiles pr
   where pr.role = 'customer' and (lower(pr.email) = lower(v_q)
         or (public.km_card_number(v_q) is not null and public.km_card_number(pr.phone) = public.km_card_number(v_q)));
  if v_matches = 0 then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  if v_matches > 1 then raise exception 'CUSTOMER_AMBIGUOUS'; end if;
  select * into v_user from public.profiles pr
   where pr.role = 'customer' and (lower(pr.email) = lower(v_q)
         or (public.km_card_number(v_q) is not null and public.km_card_number(pr.phone) = public.km_card_number(v_q)));
  v_n := public._wheel_grant(v_user.id, p_count, 'admin', null, auth.uid(), nullif(trim(coalesce(p_note, '')), ''));
  perform public._notify(v_user.id, 'wheel', case when v_n = 1 then 'wheel.gift_spins_one' else 'wheel.gift_spins_many' end,
    jsonb_build_object('count', v_n), jsonb_build_object('screen', 'wheel'));
  perform public.write_audit('wheel_spins_granted', 'profiles', v_user.id::text, jsonb_build_object('count', v_n, 'note', p_note));
  return jsonb_build_object('user_id', v_user.id, 'full_name', v_user.full_name, 'count', v_n);
end $$;

-- Supermarché : cadeau indisponible pour cette commande → il repart en attente pour la suivante.
create or replace function public.store_defer_wheel_gift(p_reward uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_r public.wheel_rewards;
begin
  select * into v_r from public.wheel_rewards where id = p_reward for update;
  if not found or v_r.order_id is null or v_r.status <> 'attached'
     or not (public.is_super_admin() or public.is_order_store_manager(v_r.order_id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.wheel_rewards set status = 'pending', order_id = null, updated_at = now(),
         note = coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Indisponible au supermarché : reporté à la commande suivante')
   where id = p_reward;
  perform public.write_audit('wheel_gift_deferred', 'wheel_rewards', p_reward::text, jsonb_build_object('order_id', v_r.order_id));
end $$;

-- Tours expirés : rangés chaque nuit (ils ne sont de toute façon plus utilisables).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('km-wheel-expire', '17 3 * * *',
      'update public.wheel_spins set status = ''expired'' where status = ''available'' and expires_at <= now()');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Droits d'exécution
-- ---------------------------------------------------------------------

revoke execute on function public._notification_category(text) from public, anon, authenticated;
revoke execute on function public._notify(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.tg_notification_push() from public, anon, authenticated;
revoke execute on function public.tg_order_status_log() from public, anon, authenticated;
revoke execute on function public.tg_profile_welcome() from public, anon, authenticated;
revoke execute on function public._wheel_settings() from public, anon, authenticated;
revoke execute on function public._wheel_drawable(public.wheel_prizes) from public, anon, authenticated;
revoke execute on function public._wheel_grant(uuid, integer, text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._wheel_order_paid(uuid) from public, anon, authenticated;
revoke execute on function public._wheel_order_delivered(uuid) from public, anon, authenticated;
revoke execute on function public._wheel_order_detach(uuid) from public, anon, authenticated;
revoke execute on function public._wheel_order_revoked(uuid) from public, anon, authenticated;
revoke execute on function public.tg_wheel_order() from public, anon, authenticated;
revoke execute on function public._wheel_public_prizes() from public, anon, authenticated;

grant execute on function public.get_wheel_public() to anon, authenticated;
revoke execute on function public.get_my_wheel() from public, anon;
revoke execute on function public.spin_wheel() from public, anon;
revoke execute on function public.admin_wheel_overview() from public, anon;
revoke execute on function public.admin_update_wheel_settings(jsonb) from public, anon;
revoke execute on function public.admin_save_wheel_prize(uuid, jsonb) from public, anon;
revoke execute on function public.admin_delete_wheel_prize(uuid) from public, anon;
revoke execute on function public.admin_wheel_rewards(text, text, text, integer, integer) from public, anon;
revoke execute on function public.admin_set_wheel_reward(uuid, text, text) from public, anon;
revoke execute on function public.admin_grant_wheel_spins(text, integer, text) from public, anon;
revoke execute on function public.store_defer_wheel_gift(uuid, text) from public, anon;
grant execute on function public.get_my_wheel(), public.spin_wheel(), public.admin_wheel_overview(),
  public.admin_update_wheel_settings(jsonb), public.admin_save_wheel_prize(uuid, jsonb), public.admin_delete_wheel_prize(uuid),
  public.admin_wheel_rewards(text, text, text, integer, integer), public.admin_set_wheel_reward(uuid, text, text),
  public.admin_grant_wheel_spins(text, integer, text), public.store_defer_wheel_gift(uuid, text) to authenticated;
