\set ON_ERROR_STOP on
-- Run as the schema owner after every migration: psql ... -v app_role=erp_app -f db/grants.sql
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO :"app_role";
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM :"app_role";
GRANT DELETE ON auth_sessions, product_unit_conversions, product_suppliers TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
REVOKE ALL ON schema_migrations FROM :"app_role";
REVOKE UPDATE, DELETE ON customer_ledger, stock_ledger FROM :"app_role";
REVOKE UPDATE, DELETE ON sales_return_applications FROM :"app_role";
REVOKE UPDATE, DELETE ON settlement_events, settlement_lines, settlement_tenders,
  supplier_payables, anonymous_return_liabilities, financial_day_openings, financial_day_closes FROM :"app_role";
REVOKE INSERT, UPDATE, DELETE ON shop_finance_config FROM :"app_role";
-- Row locks require an UPDATE privilege; immutable triggers reject actual edits.
GRANT UPDATE (id) ON settlement_events, supplier_payables, anonymous_return_liabilities,
  sales_return_applications TO :"app_role";
REVOKE INSERT, UPDATE, DELETE ON users FROM :"app_role";
REVOKE ALL ON document_sources,document_jobs,document_requests FROM :"app_role";
GRANT SELECT,INSERT ON document_sources,document_requests TO :"app_role";
GRANT SELECT ON document_jobs TO :"app_role";
GRANT INSERT(id,source_snapshot_id,layout,template_version,status,error_code) ON document_jobs TO :"app_role";
GRANT EXECUTE ON FUNCTION request_document_retry(UUID),invalidate_document_artifact(UUID,TEXT) TO :"app_role";
-- New tables receive no automatic grants; review privileges after each migration.
COMMIT;
