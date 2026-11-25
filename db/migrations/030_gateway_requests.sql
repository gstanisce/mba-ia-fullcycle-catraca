-- F03: simulated payment gateway. One authorization request per ticket, with its future answer.
-- Kept in the database so pending answers survive an app restart; the poller delivers them when due.
CREATE TABLE gateway_requests (
  ticket_id    text PRIMARY KEY REFERENCES tickets(id),
  approved     boolean NOT NULL,
  respond_at   timestamptz NOT NULL,              -- when the simulated gateway answers
  delivered_at timestamptz                        -- NULL until applyGatewayResult ran for it
);

CREATE INDEX gateway_requests_due_idx ON gateway_requests (respond_at) WHERE delivered_at IS NULL;
