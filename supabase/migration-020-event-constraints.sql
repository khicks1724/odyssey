-- Expand events source and event_type constraints for new features
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_source_check;
ALTER TABLE public.events ADD CONSTRAINT events_source_check
  CHECK (source IN ('github','gitlab','teams','onedrive','onenote','local','manual','ai'));

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE public.events ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN (
    'commit','message','file_edit','note','meeting','file_upload',
    'goal_progress_updated','goal_risk_assessed','time_logged','comment_added'
  ));
