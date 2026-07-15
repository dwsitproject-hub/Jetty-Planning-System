-- Jetty ↔ commodity capability (Master - Jetty multi-select from Master - Commodity).
BEGIN;

CREATE TABLE IF NOT EXISTS jetty_commodities (
  jetty_id BIGINT NOT NULL REFERENCES jetties(id) ON DELETE CASCADE,
  commodity_id BIGINT NOT NULL REFERENCES si_commodities(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (jetty_id, commodity_id)
);

COMMENT ON TABLE jetty_commodities IS 'Commodities a jetty can handle; used for jetty suggestions on shipment plans.';

COMMIT;
