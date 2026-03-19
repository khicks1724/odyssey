-- migration-010: Create Supabase Storage bucket for project documents
-- Applied via MCP on 2026-03-19

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-documents',
  'project-documents',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Members can upload project documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-documents'
  AND EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = (string_to_array(name, '/'))[1]::uuid
    AND user_id = auth.uid()
  )
);

CREATE POLICY "Members can read project documents"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'project-documents'
  AND EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = (string_to_array(name, '/'))[1]::uuid
    AND user_id = auth.uid()
  )
);

CREATE POLICY "Members can delete project documents"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'project-documents'
  AND EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = (string_to_array(name, '/'))[1]::uuid
    AND user_id = auth.uid()
  )
);
