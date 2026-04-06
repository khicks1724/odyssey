-- migration-024a: qualify pgcrypto helper for Supabase's extensions schema

CREATE OR REPLACE FUNCTION public.generate_project_invite_code()
RETURNS text
LANGUAGE sql
AS $$
  SELECT upper(substr(translate(encode(extensions.gen_random_bytes(18), 'base64'), '/+=', 'XYZ'), 1, 24));
$$;
