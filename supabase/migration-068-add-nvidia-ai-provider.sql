-- Migration 068: Add 'nvidia' as a supported provider slot in user_ai_keys

ALTER TABLE user_ai_keys
  DROP CONSTRAINT IF EXISTS user_ai_keys_provider_check;

ALTER TABLE user_ai_keys
  ADD CONSTRAINT user_ai_keys_provider_check
  CHECK (provider IN ('anthropic', 'openai', 'google', 'google_ai', 'nvidia'));
