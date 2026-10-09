-- Expand only. Historical document identity and snapshots remain unknown.
ALTER TABLE invoices
  ADD COLUMN document_kind TEXT CHECK (document_kind IN ('sale','sales_return')),
  ADD COLUMN contract_version TEXT,
  ADD COLUMN original_invoice_id INTEGER REFERENCES invoices(id),
  ADD CONSTRAINT invoice_source_kind CHECK (
    (document_kind IS DISTINCT FROM 'sales_return' AND original_invoice_id IS NULL)
    OR (document_kind = 'sales_return' AND original_invoice_id IS NOT NULL AND original_invoice_id <> id));
ALTER TABLE invoice_items
  ADD COLUMN original_invoice_item_id INTEGER REFERENCES invoice_items(id),
  ADD COLUMN allocated_subtotal NUMERIC(12,2),
  ADD COLUMN allocated_discount_total NUMERIC(12,2),
  ADD CONSTRAINT returned_quantity_bounds CHECK
    (qty_returned >= 0 AND qty_returned <= GREATEST(qty,0)) NOT VALID;
CREATE UNIQUE INDEX credit_source_line_unique ON invoice_items(invoice_id, original_invoice_item_id)
  WHERE original_invoice_item_id IS NOT NULL;
CREATE INDEX invoice_source ON invoices(original_invoice_id) WHERE original_invoice_id IS NOT NULL;
CREATE INDEX credit_source_item ON invoice_items(original_invoice_item_id) WHERE original_invoice_item_id IS NOT NULL;

CREATE TABLE sales_return_applications (
  id SERIAL PRIMARY KEY,
  credit_invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id),
  original_invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  total_credit NUMERIC(12,2) NOT NULL CHECK (total_credit >= 0),
  applied_amount NUMERIC(12,2) NOT NULL CHECK (applied_amount >= 0),
  unapplied_amount NUMERIC(12,2) NOT NULL CHECK (unapplied_amount >= 0),
  date DATE NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (credit_invoice_id <> original_invoice_id),
  CHECK (total_credit = applied_amount + unapplied_amount)
);
CREATE INDEX sales_return_source ON sales_return_applications(original_invoice_id);
CREATE TRIGGER sales_return_application_append_only BEFORE UPDATE OR DELETE ON sales_return_applications
  FOR EACH ROW EXECUTE FUNCTION fn_ledger_append_only();

-- Reconciliation can read credits under the source lock because issued credits are immutable.
CREATE FUNCTION fn_preserve_sales_credit() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.document_kind = 'sales_return' THEN
    RAISE EXCEPTION 'Issued sales credits are immutable';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER preserve_sales_credit BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_preserve_sales_credit();
CREATE FUNCTION fn_preserve_sales_credit_update() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.document_kind = 'sales_return' THEN
    RAISE EXCEPTION 'Issued sales credits are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER preserve_sales_credit_update BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_preserve_sales_credit_update();
CREATE FUNCTION fn_preserve_sales_credit_item() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE id=OLD.invoice_id AND document_kind='sales_return') THEN
    RAISE EXCEPTION 'Issued sales credit items are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER preserve_sales_credit_item BEFORE UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION fn_preserve_sales_credit_item();
