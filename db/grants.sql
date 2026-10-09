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
REVOKE INSERT, UPDATE, DELETE ON users FROM :"app_role";
-- New tables receive no automatic grants; review privileges after each migration.
COMMIT;
