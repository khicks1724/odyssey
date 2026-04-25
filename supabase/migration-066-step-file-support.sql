-- migration-066: allow STEP CAD files in the shared project-documents bucket

update storage.buckets
set allowed_mime_types = array(
  select distinct mime_type
  from unnest(coalesce(allowed_mime_types, '{}'::text[]) || array[
    'application/step',
    'application/x-step',
    'model/step'
  ]) as mime_type
)
where id = 'project-documents';
