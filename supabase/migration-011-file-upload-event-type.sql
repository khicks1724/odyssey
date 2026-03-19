-- migration-011: Add 'file_upload' to events_event_type_check constraint
-- Applied 2026-03-19

ALTER TABLE events DROP CONSTRAINT events_event_type_check;

ALTER TABLE events ADD CONSTRAINT events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'commit', 'message', 'file_edit', 'note', 'meeting', 'file_upload'
  ]));
