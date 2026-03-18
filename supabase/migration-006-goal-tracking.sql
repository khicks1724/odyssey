-- Migration 006: Enhanced goal tracking
-- Adds completed_at, assigned_to, category for metrics

ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_to  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category     TEXT DEFAULT 'General';

-- Index for metrics queries
CREATE INDEX IF NOT EXISTS idx_goals_assigned_to ON public.goals (assigned_to);
CREATE INDEX IF NOT EXISTS idx_goals_category    ON public.goals (category);
