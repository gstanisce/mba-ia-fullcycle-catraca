-- F02: events and tickets. Ticket rows are created by F03 (purchase); F02 only counts them (R05).
CREATE TABLE events (
  id           text PRIMARY KEY,                -- 'evt_' + 10 chars base36
  organizer_id text NOT NULL REFERENCES users(id),
  name         text NOT NULL,
  venue        text NOT NULL,
  starts_at    timestamptz NOT NULL,
  capacity     int NOT NULL CHECK (capacity >= 1),
  price_cents  int NOT NULL CHECK (price_cents > 0),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  cancelled_at timestamptz
);

CREATE TABLE tickets (
  id            text PRIMARY KEY,               -- 'tkt_' + 10 chars base36
  event_id      text NOT NULL REFERENCES events(id),
  code          text NOT NULL UNIQUE,           -- 8 chars (R09)
  status        text NOT NULL CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'refunded')),
  price_cents   int NOT NULL,                   -- price at purchase time (R03/R12)
  channel       text NOT NULL CHECK (channel IN ('web', 'api')),
  user_id       text REFERENCES users(id),      -- NULL for partner API purchases
  buyer_email   text NOT NULL,
  card_last4    text NOT NULL,
  checked_in_at timestamptz,                    -- set by F05
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tickets_event_id_status_idx ON tickets (event_id, status);
CREATE INDEX events_organizer_id_idx ON events (organizer_id);
CREATE INDEX tickets_user_id_idx ON tickets (user_id);
