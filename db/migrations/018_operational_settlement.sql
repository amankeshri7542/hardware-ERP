-- Phase 4: additive operational settlement evidence; no historical backfill.
CREATE TABLE shop_finance_config (
 id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(id), timezone TEXT NOT NULL CHECK(timezone='Asia/Kolkata')
);
INSERT INTO shop_finance_config VALUES(TRUE,'Asia/Kolkata');
CREATE TABLE anonymous_return_liabilities (
 id SERIAL PRIMARY KEY, credit_invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id),
 original_invoice_id INTEGER NOT NULL REFERENCES invoices(id), amount NUMERIC(12,2) NOT NULL CHECK(amount>=0),
 date DATE NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(credit_invoice_id<>original_invoice_id)
);
CREATE TABLE supplier_payables (
 id SERIAL PRIMARY KEY, purchase_id INTEGER NOT NULL UNIQUE REFERENCES purchases(id),
 supplier_id INTEGER NOT NULL REFERENCES suppliers(id), amount NUMERIC(12,2) NOT NULL CHECK(amount>0),
 date DATE NOT NULL, due_date DATE NOT NULL CHECK(due_date>=date), document_reference TEXT NOT NULL CHECK(length(trim(document_reference)) BETWEEN 1 AND 200),
 party_snapshot JSONB NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE settlement_events (
 id SERIAL PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('customer_allocation','customer_refund','anonymous_refund','supplier_payment','supplier_debit_application','supplier_refund','payment_reversal','reversal','payable_reversal')),
 source_type TEXT NOT NULL CHECK(source_type IN ('advance','return_credit','anonymous_liability','payable','debit','payment','event')),
 source_id INTEGER NOT NULL CHECK(source_id>0), customer_id INTEGER REFERENCES customers(id), supplier_id INTEGER REFERENCES suppliers(id),
 amount NUMERIC(12,2) NOT NULL CHECK(amount>0), date DATE NOT NULL, reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 operator_confirmed BOOLEAN NOT NULL CHECK(operator_confirmed), reference_no TEXT, party_snapshot JSONB NOT NULL,
 created_by INTEGER NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 reverses_event_id INTEGER UNIQUE REFERENCES settlement_events(id),
 CHECK(customer_id IS NULL OR supplier_id IS NULL),
 CHECK((kind='reversal')=(reverses_event_id IS NOT NULL)), CHECK(reverses_event_id IS NULL OR reverses_event_id<>id)
);
CREATE UNIQUE INDEX one_payment_reversal ON settlement_events(source_id) WHERE kind='payment_reversal';
CREATE UNIQUE INDEX one_payable_reversal ON settlement_events(source_id) WHERE kind='payable_reversal';
CREATE INDEX settlement_source ON settlement_events(source_type,source_id,id);
CREATE INDEX settlement_customer ON settlement_events(customer_id,date,id);
CREATE INDEX settlement_supplier ON settlement_events(supplier_id,date,id);
CREATE TABLE settlement_lines (
 id SERIAL PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES settlement_events(id),
 target_type TEXT NOT NULL CHECK(target_type IN ('invoice','payable')), target_id INTEGER NOT NULL CHECK(target_id>0),
 amount NUMERIC(12,2) NOT NULL CHECK(amount>0), UNIQUE(event_id,target_type,target_id)
);
CREATE INDEX settlement_target ON settlement_lines(target_type,target_id,event_id);
CREATE TABLE settlement_tenders (
 id SERIAL PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES settlement_events(id),
 mode VARCHAR(10) NOT NULL CHECK(mode IN ('cash','upi','bank','cheque')), amount NUMERIC(12,2) NOT NULL CHECK(amount>0), reference_no VARCHAR(100)
);
CREATE INDEX settlement_tender_event ON settlement_tenders(event_id);
CREATE TABLE financial_day_openings (
 id SERIAL PRIMARY KEY, date DATE NOT NULL UNIQUE, opening_float NUMERIC(12,2) NOT NULL CHECK(opening_float>=0),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500), created_by INTEGER NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE financial_day_closes (
 id SERIAL PRIMARY KEY, date DATE NOT NULL UNIQUE REFERENCES financial_day_openings(date),
 expected_cash NUMERIC(12,2) NOT NULL, counted_cash NUMERIC(12,2) NOT NULL CHECK(counted_cash>=0),
 discrepancy NUMERIC(12,2) NOT NULL, movements JSONB NOT NULL, reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 created_by INTEGER NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), cutoff TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK(discrepancy=counted_cash-expected_cash)
);
-- The shared lock is acquired before business row locks by every API posting.
-- Triggers also protect direct inserts made using the restricted application role.
CREATE FUNCTION fn_require_open_financial_date(business_date DATE) RETURNS VOID AS $$
DECLARE closed_through DATE;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(172904,4);
 SELECT MAX(date) INTO closed_through FROM financial_day_closes;
 IF business_date IS NULL THEN RAISE EXCEPTION 'FINANCIAL_DATE_REQUIRED'; END IF;
 IF business_date<=closed_through THEN RAISE EXCEPTION 'FINANCIAL_PERIOD_CLOSED'; END IF;
END; $$ LANGUAGE plpgsql;
CREATE FUNCTION fn_guard_financial_date() RETURNS TRIGGER AS $$
BEGIN
 PERFORM fn_require_open_financial_date((to_jsonb(NEW)->>TG_ARGV[0])::date);
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER period_invoice BEFORE INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_date('date');
CREATE TRIGGER period_payment BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_date('payment_date');
CREATE TRIGGER period_purchase BEFORE INSERT ON purchases FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_date('date');
CREATE TRIGGER period_purchase_return BEFORE INSERT ON purchase_returns FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_date('return_date');
CREATE TRIGGER period_stock BEFORE INSERT ON stock_ledger FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_date('date');
CREATE TRIGGER period_customer_ledger BEFORE INSERT ON customer_ledger FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_date('date');
CREATE TRIGGER period_settlement BEFORE INSERT ON settlement_events FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_date('date');
CREATE TRIGGER period_payable BEFORE INSERT ON supplier_payables FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_date('date');
CREATE TRIGGER period_anonymous BEFORE INSERT ON anonymous_return_liabilities FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_date('date');
CREATE TRIGGER period_day_open BEFORE INSERT ON financial_day_openings FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_date('date');
CREATE TRIGGER settlement_event_immutable BEFORE UPDATE OR DELETE ON settlement_events FOR EACH ROW EXECUTE FUNCTION fn_ledger_append_only();
CREATE TRIGGER settlement_line_immutable BEFORE UPDATE OR DELETE ON settlement_lines FOR EACH ROW EXECUTE FUNCTION fn_ledger_append_only();
CREATE TRIGGER settlement_tender_immutable BEFORE UPDATE OR DELETE ON settlement_tenders FOR EACH ROW EXECUTE FUNCTION fn_ledger_append_only();
CREATE TRIGGER supplier_payable_immutable BEFORE UPDATE OR DELETE ON supplier_payables FOR EACH ROW EXECUTE FUNCTION fn_ledger_append_only();
CREATE TRIGGER anonymous_liability_immutable BEFORE UPDATE OR DELETE ON anonymous_return_liabilities FOR EACH ROW EXECUTE FUNCTION fn_ledger_append_only();
CREATE TRIGGER day_open_immutable BEFORE UPDATE OR DELETE ON financial_day_openings FOR EACH ROW EXECUTE FUNCTION fn_ledger_append_only();
CREATE TRIGGER day_close_immutable BEFORE UPDATE OR DELETE ON financial_day_closes FOR EACH ROW EXECUTE FUNCTION fn_ledger_append_only();
CREATE TRIGGER shop_finance_config_immutable BEFORE UPDATE OR DELETE ON shop_finance_config FOR EACH ROW EXECUTE FUNCTION fn_ledger_append_only();
ALTER TABLE invoices ADD COLUMN customer_snapshot JSONB;
ALTER TABLE purchases ADD COLUMN supplier_snapshot JSONB;
CREATE FUNCTION fn_snapshot_issued_party() RETURNS TRIGGER AS $$
BEGIN
 IF TG_TABLE_NAME='invoices' THEN
  IF NEW.customer_id IS NOT NULL THEN
   SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'address',address,'gstin',gstin) INTO NEW.customer_snapshot FROM customers WHERE id=NEW.customer_id;
  ELSE NEW.customer_snapshot:=jsonb_build_object('name',NEW.walk_in_name,'registered',false); END IF;
 ELSE
  SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'address',address,'gstin',gstin) INTO NEW.supplier_snapshot FROM suppliers WHERE id=NEW.supplier_id;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER invoice_party_snapshot BEFORE INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION fn_snapshot_issued_party();
CREATE TRIGGER purchase_party_snapshot BEFORE INSERT ON purchases FOR EACH ROW EXECUTE FUNCTION fn_snapshot_issued_party();
CREATE FUNCTION fn_preserve_issued_party() RETURNS TRIGGER AS $$
BEGIN
 IF (to_jsonb(OLD)->TG_ARGV[0]) IS DISTINCT FROM (to_jsonb(NEW)->TG_ARGV[0]) THEN RAISE EXCEPTION 'Issued party snapshot immutable'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER invoice_party_immutable BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION fn_preserve_issued_party('customer_snapshot');
CREATE TRIGGER purchase_party_immutable BEFORE UPDATE ON purchases FOR EACH ROW EXECUTE FUNCTION fn_preserve_issued_party('supplier_snapshot');
