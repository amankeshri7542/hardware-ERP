-- Existing admins retain access. No cashier accounts are created by this migration.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'cashier'));

CREATE TABLE auth_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_fingerprint CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE FUNCTION revoke_changed_user_sessions() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.password_hash IS DISTINCT FROM NEW.password_hash
    OR OLD.is_active IS DISTINCT FROM NEW.is_active
    OR OLD.role IS DISTINCT FROM NEW.role THEN
    PERFORM pg_advisory_xact_lock(73421, NEW.id);
    DELETE FROM auth_sessions WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_revoke_sessions AFTER UPDATE OF password_hash, is_active, role ON users
FOR EACH ROW EXECUTE FUNCTION revoke_changed_user_sessions();
