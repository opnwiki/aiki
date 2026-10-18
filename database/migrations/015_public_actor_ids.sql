-- Stable 14-digit public actor IDs with a large random numeric space.
-- A UNIQUE index makes collisions impossible within this database. Cross-node strict
-- uniqueness is not claimed; it requires a shared registry or coordinated namespace.
-- UUIDs remain the internal relational keys.
CREATE OR REPLACE FUNCTION generate_actor_public_id()
RETURNS BIGINT LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  RETURN 10000000000000 + floor(random() * 89999999999999)::BIGINT;
END;
$$;

ALTER TABLE actors ADD COLUMN public_id BIGINT;
CREATE UNIQUE INDEX actors_public_id_unique ON actors (public_id);
DO $$
DECLARE actor_row RECORD;
BEGIN
  FOR actor_row IN SELECT id FROM actors ORDER BY created_at, id LOOP
    LOOP
      BEGIN
        UPDATE actors SET public_id = generate_actor_public_id() WHERE id = actor_row.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- Retry only the practically impossible collision with an earlier seeded ID.
      END;
    END LOOP;
  END LOOP;
END $$;
ALTER TABLE actors ALTER COLUMN public_id SET NOT NULL,
  ADD CONSTRAINT actors_public_id_range CHECK (public_id BETWEEN 10000000000000 AND 99999999999999);

CREATE OR REPLACE FUNCTION assign_actor_public_id()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generated_id BIGINT;
BEGIN
  IF NEW.public_id IS NOT NULL THEN
    RAISE EXCEPTION 'public actor IDs are assigned by the database'
      USING ERRCODE = '23514', CONSTRAINT = 'actors_public_id_managed';
  END IF;
  LOOP
    generated_id := generate_actor_public_id();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM actors WHERE public_id = generated_id);
  END LOOP;
  NEW.public_id := generated_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS actors_assign_public_id ON actors;
CREATE TRIGGER actors_assign_public_id BEFORE INSERT ON actors
  FOR EACH ROW EXECUTE FUNCTION assign_actor_public_id();

CREATE OR REPLACE FUNCTION protect_actor_public_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.public_id IS DISTINCT FROM OLD.public_id THEN
    RAISE EXCEPTION 'actor public IDs are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'actors_public_id_immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS actors_public_id_immutable ON actors;
CREATE TRIGGER actors_public_id_immutable BEFORE UPDATE OF public_id ON actors
  FOR EACH ROW EXECUTE FUNCTION protect_actor_public_id();

COMMENT ON COLUMN actors.public_id IS 'Stable 14-digit public identifier with a database-unique index. Randomized numeric format does not promise strict cross-node uniqueness.';
