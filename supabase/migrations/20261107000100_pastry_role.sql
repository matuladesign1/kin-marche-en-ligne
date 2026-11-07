-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Rôle « pâtissier »
-- (valeur ajoutée seule dans sa migration : Postgres ne permet de l'utiliser qu'après validation)
-- =====================================================================
alter type public.app_role add value if not exists 'pastry_chef';
