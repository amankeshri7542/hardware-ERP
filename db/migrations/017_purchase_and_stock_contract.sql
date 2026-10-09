ALTER TABLE purchases ADD COLUMN contract_version TEXT;
ALTER TABLE purchase_items
  ADD COLUMN base_qty NUMERIC(12,3),
  ADD COLUMN base_unit_snapshot VARCHAR(20),
  ADD COLUMN conversion_value_snapshot NUMERIC(14,4),
  ADD COLUMN product_name_snapshot VARCHAR(255),
  ADD COLUMN qty_returned NUMERIC(12,3) NOT NULL DEFAULT 0,
  ADD CONSTRAINT purchase_returned_bounds CHECK (qty_returned >= 0 AND qty_returned <= qty) NOT VALID;
ALTER TABLE purchase_returns ADD COLUMN contract_version TEXT;
ALTER TABLE purchase_returns DROP CONSTRAINT purchase_returns_status_check;
ALTER TABLE purchase_returns ADD CONSTRAINT purchase_returns_status_check
  CHECK (status IN ('pending','accepted','rejected','posted'));
ALTER TABLE purchase_return_items
  ADD COLUMN purchase_item_id INTEGER REFERENCES purchase_items(id),
  ADD COLUMN base_qty NUMERIC(12,3),
  ADD COLUMN unit VARCHAR(20),
  ADD COLUMN base_unit_snapshot VARCHAR(20);
CREATE UNIQUE INDEX purchase_return_source_unique ON purchase_return_items(purchase_return_id,purchase_item_id)
  WHERE purchase_item_id IS NOT NULL;
CREATE INDEX purchase_return_source_item ON purchase_return_items(purchase_item_id) WHERE purchase_item_id IS NOT NULL;
ALTER TABLE supplier_debit_notes ADD COLUMN contract_version TEXT;
CREATE UNIQUE INDEX modern_supplier_debit_unique ON supplier_debit_notes(purchase_return_id)
  WHERE contract_version='phase3-v1';

-- Preserve issued evidence; historical records are not inferred or repaired.
CREATE FUNCTION fn_preserve_purchase_evidence() RETURNS TRIGGER AS $$
DECLARE modern BOOLEAN; allowed_column TEXT;
BEGIN
  IF TG_TABLE_NAME='purchase_items' THEN
    SELECT contract_version='phase3-v1' INTO modern FROM purchases WHERE id=OLD.purchase_id;
    allowed_column := 'qty_returned';
  ELSIF TG_TABLE_NAME='purchase_return_items' THEN
    SELECT contract_version='phase3-v1' INTO modern FROM purchase_returns WHERE id=OLD.purchase_return_id;
  ELSE
    modern := OLD.contract_version='phase3-v1';
    IF TG_TABLE_NAME='purchases' THEN allowed_column := 'notes'; END IF;
  END IF;
  IF modern THEN
    IF TG_OP='DELETE' OR allowed_column IS NULL THEN RAISE EXCEPTION 'Issued purchase evidence is immutable'; END IF;
    IF (to_jsonb(NEW)-allowed_column) IS DISTINCT FROM (to_jsonb(OLD)-allowed_column) THEN
      RAISE EXCEPTION 'Issued purchase evidence is immutable';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER preserve_purchase BEFORE UPDATE OR DELETE ON purchases
  FOR EACH ROW EXECUTE FUNCTION fn_preserve_purchase_evidence();
CREATE TRIGGER preserve_purchase_item BEFORE UPDATE OR DELETE ON purchase_items
  FOR EACH ROW EXECUTE FUNCTION fn_preserve_purchase_evidence();
CREATE TRIGGER preserve_purchase_return BEFORE UPDATE OR DELETE ON purchase_returns
  FOR EACH ROW EXECUTE FUNCTION fn_preserve_purchase_evidence();
CREATE TRIGGER preserve_purchase_return_item BEFORE UPDATE OR DELETE ON purchase_return_items
  FOR EACH ROW EXECUTE FUNCTION fn_preserve_purchase_evidence();
CREATE TRIGGER preserve_supplier_debit BEFORE UPDATE OR DELETE ON supplier_debit_notes
  FOR EACH ROW EXECUTE FUNCTION fn_preserve_purchase_evidence();

ALTER TABLE products
  ADD COLUMN stock_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN catalog_version BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT nonnegative_product_stock CHECK (current_stock >= 0) NOT VALID;
CREATE FUNCTION fn_product_versions() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.current_stock IS DISTINCT FROM OLD.current_stock THEN NEW.stock_version := OLD.stock_version+1; END IF;
  IF ROW(NEW.name,NEW.category,NEW.brand,NEW.sku,NEW.barcode,NEW.unit,NEW.base_unit,NEW.hsn_code,NEW.gst_rate,
    NEW.mrp,NEW.wholesale_price,NEW.purchase_price,NEW.min_stock,NEW.is_active)
    IS DISTINCT FROM ROW(OLD.name,OLD.category,OLD.brand,OLD.sku,OLD.barcode,OLD.unit,OLD.base_unit,OLD.hsn_code,OLD.gst_rate,
    OLD.mrp,OLD.wholesale_price,OLD.purchase_price,OLD.min_stock,OLD.is_active)
    THEN NEW.catalog_version := OLD.catalog_version+1; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER product_versions BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fn_product_versions();
