-- Bannières publicitaires (accueil et page Messages) : le format GIF (animé) est accepté.
-- Ré-exécutable sans risque.
update storage.buckets
   set allowed_mime_types = array_append(allowed_mime_types, 'image/gif')
 where id = 'branding' and not ('image/gif' = any (coalesce(allowed_mime_types, array[]::text[])));
