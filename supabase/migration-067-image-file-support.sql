-- migration-067: allow common image files in the shared project-documents bucket

update storage.buckets
set allowed_mime_types = array(
  select distinct mime_type
  from unnest(coalesce(allowed_mime_types, '{}'::text[]) || array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif'
  ]) as mime_type
)
where id = 'project-documents';
