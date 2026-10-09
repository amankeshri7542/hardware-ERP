-- Existing issued units cannot be inferred safely from today's product catalog.
ALTER TABLE invoice_items ADD COLUMN base_unit_snapshot VARCHAR(20);
