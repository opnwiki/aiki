-- Public display names are separate from the login/technical username.
ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS display_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actors_display_name_length_check') THEN
    ALTER TABLE actors ADD CONSTRAINT actors_display_name_length_check
      CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 80);
  END IF;
END $$;

