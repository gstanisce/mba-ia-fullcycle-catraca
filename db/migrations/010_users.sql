-- F01: accounts and cookie sessions.
CREATE TABLE users (
  id            text PRIMARY KEY,                 -- 'usr_' + 10 chars base36
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,             -- always stored lower-case
  password_hash text NOT NULL,                    -- 'scrypt$<salt hex>$<hash hex>'
  role          text NOT NULL CHECK (role IN ('organizer', 'participant')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email))
);

CREATE TABLE sessions (
  token      text PRIMARY KEY,                    -- 32 random bytes, hex
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL                 -- now() + 7 days
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
