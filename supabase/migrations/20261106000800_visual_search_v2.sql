-- =====================================================================
-- Recherche par photo, version 2 : empreinte Blurhash 9 × 9 (le maximum : 166 caractères, commence
-- par « | »). Plus de détails sur le produit : l'application ne montre que les articles qui
-- ressemblent vraiment à la photo. Les visiteurs non connectés complètent aussi, une seule fois,
-- les empreintes des anciennes photos ; une empreinte 4 × 4 (version 1) est remplacée par une 9 × 9.
-- =====================================================================

alter table public.product_images drop constraint if exists product_images_blurhash_format;
alter table public.product_images add constraint product_images_blurhash_format
  check (blurhash is null
    or blurhash ~ '^\|[]0-9A-Za-z#$%*+,.:;=?@[^_{|}~-]{165}$'
    or blurhash ~ '^U[]0-9A-Za-z#$%*+,.:;=?@[^_{|}~-]{35}$');

create or replace function public.set_image_blurhash(p_image uuid, p_hash text)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if p_hash is null or p_hash !~ '^\|[]0-9A-Za-z#$%*+,.:;=?@[^_{|}~-]{165}$' then
    raise exception 'INVALID_HASH' using errcode = '22023';
  end if;
  -- Une seule fois par photo : une empreinte 9 × 9 déjà enregistrée n'est jamais remplacée.
  update public.product_images set blurhash = p_hash
   where id = p_image and (blurhash is null or left(blurhash, 1) <> '|');
end $fn$;
revoke execute on function public.set_image_blurhash(uuid, text) from public;
grant execute on function public.set_image_blurhash(uuid, text) to anon, authenticated;
