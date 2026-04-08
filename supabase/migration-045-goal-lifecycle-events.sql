-- Add created_by to goals
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- Expand events.event_type to include goal lifecycle events
ALTER TABLE public.events DROP CONSTRAINT events_event_type_check;
ALTER TABLE public.events ADD CONSTRAINT events_event_type_check CHECK (
  event_type = ANY (ARRAY[
    'commit', 'message', 'file_edit', 'note', 'meeting', 'file_upload',
    'goal_progress_updated', 'goal_risk_assessed', 'time_logged', 'comment_added',
    'report_template', 'goal_created', 'goal_status_changed'
  ])
);
