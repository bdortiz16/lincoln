-- Atomic HD wallet counter increment to prevent race conditions
-- when two users request their wallet address simultaneously.
CREATE OR REPLACE FUNCTION increment_hd_counter()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_val integer;
BEGIN
  UPDATE system_config
    SET value = (CAST(value AS integer) + 1)::text
    WHERE key = 'tatum_hd_counter'
    RETURNING CAST(value AS integer) INTO next_val;

  IF next_val IS NULL THEN
    INSERT INTO system_config (key, value) VALUES ('tatum_hd_counter', '1')
    ON CONFLICT (key) DO UPDATE
      SET value = (CAST(system_config.value AS integer) + 1)::text
    RETURNING CAST(system_config.value AS integer) INTO next_val;
  END IF;

  RETURN next_val;
END;
$$;
