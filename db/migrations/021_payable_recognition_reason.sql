-- Existing synthetic/unknown recognition reasons are not reconstructed.
ALTER TABLE supplier_payables ADD COLUMN reason TEXT CHECK(reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 500);
CREATE FUNCTION fn_require_payable_reason() RETURNS TRIGGER AS $$
BEGIN
 IF NEW.reason IS NULL OR length(trim(NEW.reason))=0 THEN RAISE EXCEPTION 'PAYABLE_REASON_REQUIRED'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payable_reason_required BEFORE INSERT ON supplier_payables FOR EACH ROW EXECUTE FUNCTION fn_require_payable_reason();
