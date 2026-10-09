-- Forward correction/extension after 018; historical rows remain unknown.
ALTER TABLE payments ADD COLUMN customer_snapshot JSONB, ADD COLUMN contract_version TEXT;
CREATE OR REPLACE FUNCTION fn_snapshot_issued_party() RETURNS TRIGGER AS $$
BEGIN
 IF TG_TABLE_NAME='invoices' THEN
  IF NEW.document_kind='sales_return' THEN
   SELECT customer_snapshot INTO NEW.customer_snapshot FROM invoices WHERE id=NEW.original_invoice_id;
  ELSIF NEW.customer_id IS NOT NULL THEN
   SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'address',address,'gstin',gstin) INTO NEW.customer_snapshot FROM customers WHERE id=NEW.customer_id;
  ELSE NEW.customer_snapshot:=jsonb_build_object('name',NEW.customer_name_walkin,'registered',false); END IF;
 ELSE
  SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'address',address,'gstin',gstin) INTO NEW.supplier_snapshot FROM suppliers WHERE id=NEW.supplier_id;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE FUNCTION fn_snapshot_receipt_party() RETURNS TRIGGER AS $$
BEGIN
 IF NEW.invoice_id IS NOT NULL THEN SELECT customer_snapshot INTO NEW.customer_snapshot FROM invoices WHERE id=NEW.invoice_id;
 ELSE SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'address',address,'gstin',gstin) INTO NEW.customer_snapshot FROM customers WHERE id=NEW.customer_id; END IF;
 NEW.contract_version:='phase4-v1'; RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payment_party_snapshot BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION fn_snapshot_receipt_party();
CREATE FUNCTION fn_preserve_receipt() RETURNS TRIGGER AS $$
DECLARE modern BOOLEAN;
BEGIN
 IF TG_TABLE_NAME='payments' THEN modern:=OLD.contract_version='phase4-v1';
 ELSE SELECT contract_version='phase4-v1' INTO modern FROM payments WHERE id=OLD.payment_id; END IF;
 IF modern THEN RAISE EXCEPTION 'Issued receipt evidence immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER preserve_receipt BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION fn_preserve_receipt();
CREATE TRIGGER preserve_receipt_tender BEFORE UPDATE OR DELETE ON payment_modes_detail FOR EACH ROW EXECUTE FUNCTION fn_preserve_receipt();
CREATE FUNCTION fn_guard_day_close() RETURNS TRIGGER AS $$
DECLARE previous_date DATE;
BEGIN
 PERFORM pg_advisory_xact_lock(172904,4);
 SELECT MAX(date) INTO previous_date FROM financial_day_closes;
 IF previous_date IS NOT NULL AND NEW.date<>previous_date+1 THEN RAISE EXCEPTION 'DAY_CLOSE_SEQUENCE_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM financial_day_openings WHERE date<NEW.date AND NOT EXISTS(SELECT 1 FROM financial_day_closes c WHERE c.date=financial_day_openings.date)) THEN RAISE EXCEPTION 'EARLIER_DAY_OPEN'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER day_close_boundary BEFORE INSERT ON financial_day_closes FOR EACH ROW EXECUTE FUNCTION fn_guard_day_close();
