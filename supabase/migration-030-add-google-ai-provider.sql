-- Migration 030: Add 'google_ai' as a separate provider slot in user_ai_keys
-- 'google'    = DoD GenAI.mil STARK keys
-- 'google_ai' = Google AI Studio AIza... keys (new)

ALTER TABLE user_ai_keys
  DROP CONSTRAINT IF EXISTS user_ai_keys_provider_check;

ALTER TABLE user_ai_keys
  ADD CONSTRAINT user_ai_keys_provider_check
  CHECK (provider IN ('anthropic', 'openai', 'google', 'google_ai'));
