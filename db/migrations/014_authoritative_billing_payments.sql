-- New postings only: preserve issued values, ledger history and credit notes.
CREATE TABLE idempotency_keys (
  actor_id INTEGER NOT NULL REFERENCES users(id),
  operation TEXT NOT NULL,
  key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status_code INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (actor_id, operation, key),
  CHECK ((status_code IS NULL AND response_body IS NULL) OR
         (status_code BETWEEN 200 AND 299 AND response_body IS NOT NULL))
);

ALTER TABLE invoices ALTER COLUMN profit_pct TYPE NUMERIC(16,2);
ALTER TABLE invoices ADD COLUMN notes TEXT;
ALTER TABLE invoices DROP CONSTRAINT invoices_pdf_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_pdf_status_check
  CHECK (pdf_status IN ('pending','ready','failed','disabled'));

-- Serialize every future customer posting, including callers from later phases.
DROP TRIGGER trg_sync_customer_outstanding ON customer_ledger;
CREATE OR REPLACE FUNCTION fn_sync_customer_outstanding()
RETURNS TRIGGER AS $$
DECLARE prior_balance NUMERIC;
BEGIN
  PERFORM id FROM customers WHERE id = NEW.customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer does not exist' USING ERRCODE = '23503';
  END IF;
  SELECT COALESCE(SUM(debit - credit), 0) INTO prior_balance
    FROM customer_ledger WHERE customer_id = NEW.customer_id;
  NEW.balance := prior_balance + NEW.debit - NEW.credit;
  UPDATE customers SET outstanding_balance = NEW.balance WHERE id = NEW.customer_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_sync_customer_outstanding
  BEFORE INSERT ON customer_ledger
  FOR EACH ROW EXECUTE FUNCTION fn_sync_customer_outstanding();
