-- =====================================================================
-- Recherche par photo similaire, sans service extérieur.
-- Chaque photo de produit reçoit une empreinte visuelle compacte (Blurhash 4 × 4 : couleur moyenne
-- et répartition des couleurs). Le téléphone calcule l'empreinte de la photo du client et classe
-- les produits du plus ressemblant au moins ressemblant.
-- L'empreinte est calculée à l'envoi de la photo (administration) ou, pour les anciennes photos,
-- par le téléphone lors d'une recherche (une seule fois : elle est ensuite enregistrée ici).
-- =====================================================================

alter table public.product_images add column if not exists blurhash text;

alter table public.product_images drop constraint if exists product_images_blurhash_format;
alter table public.product_images add constraint product_images_blurhash_format
  check (blurhash is null or blurhash ~ '^U[]0-9A-Za-z#$%*+,.:;=?@[^_{|}~-]{35}$');

-- Nouvelle photo à la même ligne : l'ancienne empreinte ne vaut plus.
create or replace function public._product_image_reset_blurhash()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  if new.url is distinct from old.url and new.blurhash is not distinct from old.blurhash then
    new.blurhash := null;
  end if;
  return new;
end $fn$;
drop trigger if exists product_images_reset_blurhash on public.product_images;
create trigger product_images_reset_blurhash before update on public.product_images
  for each row execute function public._product_image_reset_blurhash();

-- Empreintes du catalogue actif : jusqu'à 3 photos par produit (les vidéos sont ignorées).
create or replace function public.visual_catalog()
returns table (image_id uuid, product_id uuid, url text, blurhash text)
language sql stable set search_path = '' as $fn$
  select x.id, x.product_id, x.url, x.blurhash
  from (
    select i.id, i.product_id, i.url, i.blurhash,
           row_number() over (partition by i.product_id order by i.sort_order, i.created_at) as rn
    from public.product_images i
    join public.products p on p.id = i.product_id and p.is_active
    where i.url !~* '\.(mp4|mov|webm)(\?|$)'
  ) x
  where x.rn <= 3
$fn$;
grant execute on function public.visual_catalog() to anon, authenticated;

-- Enregistre l'empreinte calculée par un téléphone pour une ancienne photo (seulement si elle manque).
create or replace function public.set_image_blurhash(p_image uuid, p_hash text)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_hash is null or p_hash !~ '^U[]0-9A-Za-z#$%*+,.:;=?@[^_{|}~-]{35}$' then
    raise exception 'INVALID_HASH' using errcode = '22023';
  end if;
  update public.product_images set blurhash = p_hash where id = p_image and blurhash is null;
end $fn$;
revoke execute on function public.set_image_blurhash(uuid, text) from public, anon;
grant execute on function public.set_image_blurhash(uuid, text) to authenticated;
