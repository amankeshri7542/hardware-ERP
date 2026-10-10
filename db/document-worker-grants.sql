\set ON_ERROR_STOP on
-- Dedicated synthetic job coordinator. It cannot read financial tables, credentials or sessions.
BEGIN;
GRANT USAGE ON SCHEMA public TO :"document_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"document_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"document_role";
GRANT SELECT ON document_sources,document_jobs TO :"document_role";
GRANT UPDATE(status,attempts,lease_token,lease_until,artifact_key,artifact_sha256,artifact_bytes,error_code,updated_at,published_at)
 ON document_jobs TO :"document_role";
REVOKE ALL ON FUNCTION request_document_retry(UUID),invalidate_document_artifact(UUID,TEXT) FROM :"document_role";
COMMIT;
