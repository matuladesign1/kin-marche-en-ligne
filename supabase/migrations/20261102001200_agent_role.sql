-- =====================================================================
-- KIN MARCHÉ EN LIGNE — Rôle « agent » (agents de travail de la Direction)
-- Séparé : une nouvelle valeur d'enum doit être validée avant d'être utilisée.
-- =====================================================================
alter type public.app_role add value if not exists 'agent';
