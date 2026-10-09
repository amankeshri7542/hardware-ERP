-- Child rows cannot silently change a closed day's recorded financial facts.
CREATE FUNCTION fn_guard_financial_child() RETURNS TRIGGER AS $$
DECLARE effective_date DATE;
BEGIN
 EXECUTE format('SELECT %I FROM %I WHERE id=$1',TG_ARGV[2],TG_ARGV[1])
  INTO effective_date USING (to_jsonb(NEW)->>TG_ARGV[0])::integer;
 PERFORM fn_require_open_financial_date(effective_date);
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER period_payment_tender BEFORE INSERT ON payment_modes_detail FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_child('payment_id','payments','payment_date');
CREATE TRIGGER period_settlement_line BEFORE INSERT ON settlement_lines FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_child('event_id','settlement_events','date');
CREATE TRIGGER period_settlement_tender BEFORE INSERT ON settlement_tenders FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_child('event_id','settlement_events','date');
CREATE TRIGGER period_invoice_item BEFORE INSERT ON invoice_items FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_child('invoice_id','invoices','date');
CREATE TRIGGER period_purchase_item BEFORE INSERT ON purchase_items FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_child('purchase_id','purchases','date');
CREATE TRIGGER period_purchase_return_item BEFORE INSERT ON purchase_return_items FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_child('purchase_return_id','purchase_returns','return_date');
CREATE TRIGGER period_supplier_debit BEFORE INSERT ON supplier_debit_notes FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_child('purchase_return_id','purchase_returns','return_date');
CREATE TRIGGER period_original_credit_application BEFORE INSERT ON sales_return_applications FOR EACH ROW EXECUTE FUNCTION fn_guard_financial_child('credit_invoice_id','invoices','date');
