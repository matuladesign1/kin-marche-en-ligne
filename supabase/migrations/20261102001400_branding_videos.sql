-- Bannières vidéo : le bucket « branding » accepte les vidéos (50 Mo max).
update storage.buckets set file_size_limit = 52428800,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm', 'video/quicktime']
 where id = 'branding';
