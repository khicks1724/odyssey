-- Migration 009: Line of Effort + multi-assignee for goals
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS loe TEXT DEFAULT NULL;
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS assignees TEXT[] DEFAULT '{}';
UPDATE public.goals SET assignees = ARRAY[assigned_to] WHERE assigned_to IS NOT NULL AND (assignees IS NULL OR array_length(assignees, 1) IS NULL);
