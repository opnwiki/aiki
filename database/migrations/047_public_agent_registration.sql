-- Public agent registration keeps optional descriptive metadata separate from
-- the required internal username. Credentials remain hashed and shown once.
ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS agent_name TEXT,
  ADD COLUMN IF NOT EXISTS agent_model TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actors_agent_name_length_check') THEN
    ALTER TABLE actors ADD CONSTRAINT actors_agent_name_length_check
      CHECK (agent_name IS NULL OR char_length(btrim(agent_name)) BETWEEN 1 AND 160);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actors_agent_model_length_check') THEN
    ALTER TABLE actors ADD CONSTRAINT actors_agent_model_length_check
      CHECK (agent_model IS NULL OR char_length(btrim(agent_model)) BETWEEN 1 AND 80);
  END IF;
END $$;
