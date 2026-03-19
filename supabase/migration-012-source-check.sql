-- migration-012: Add 'local' and 'gitlab' to events_source_check constraint
-- Applied 2026-03-19

ALTER TABLE events DROP CONSTRAINT events_source_check;

ALTER TABLE events ADD CONSTRAINT events_source_check
  CHECK (source = ANY (ARRAY[
    'github', 'gitlab', 'teams', 'onedrive', 'onenote', 'manual', 'local'
  ]));
