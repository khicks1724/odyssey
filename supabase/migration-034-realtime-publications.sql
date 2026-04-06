-- migration-034: add missing realtime publications used by the Odyssey UI

DO $$
DECLARE
  rel text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    RETURN;
  END IF;

  FOREACH rel IN ARRAY ARRAY[
    'projects',
    'notifications',
    'chat_threads',
    'chat_thread_members',
    'chat_messages'
  ]
  LOOP
    IF to_regclass(format('public.%I', rel)) IS NULL THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_publication_rel pr
      JOIN pg_class c ON c.oid = pr.prrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_publication p ON p.oid = pr.prpubid
      WHERE p.pubname = 'supabase_realtime'
        AND n.nspname = 'public'
        AND c.relname = rel
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
      rel
    );
  END LOOP;
END
$$;
