-- migration-016: add ai_guidance text column to goals

ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS ai_guidance TEXT;
