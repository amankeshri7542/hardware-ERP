-- Expand only: no historical financial rows, seller facts or idempotency results are rewritten.
CREATE TABLE document_sources (
 id UUID PRIMARY KEY,
 source_type TEXT NOT NULL CHECK(source_type IN ('invoice','payment','customer_statement')),
 source_id INTEGER NOT NULL CHECK(source_id>0),
 basis TEXT NOT NULL CHECK(length(basis) BETWEEN 1 AND 256),
 content_hash TEXT NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 dto JSONB, error_code TEXT,
 captured_by INTEGER NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(source_type,source_id,basis),
 CHECK ((dto IS NOT NULL AND error_code IS NULL) OR (dto IS NULL AND error_code IS NOT NULL)),
 CHECK(dto IS NULL OR (jsonb_typeof(dto)='object' AND octet_length(dto::text)<=2097152))
);
CREATE TABLE document_jobs (
 id UUID PRIMARY KEY,
 source_snapshot_id UUID NOT NULL REFERENCES document_sources(id),
 layout TEXT NOT NULL CHECK(layout IN ('a4','thermal80')),
 template_version TEXT NOT NULL DEFAULT 'phase5b-v1' CHECK(template_version='phase5b-v1'),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','ready','retryable_failure','permanent_failure')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 lease_token BIGINT NOT NULL DEFAULT 0 CHECK(lease_token>=0),
 lease_until TIMESTAMPTZ,
 artifact_key TEXT CHECK(artifact_key IS NULL OR artifact_key ~ '^[a-f0-9-]{36}$'),
 artifact_sha256 TEXT CHECK(artifact_sha256 IS NULL OR artifact_sha256 ~ '^[a-f0-9]{64}$'),
 artifact_bytes INTEGER CHECK(artifact_bytes IS NULL OR artifact_bytes BETWEEN 1 AND 8388608),
 error_code TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 published_at TIMESTAMPTZ,
 UNIQUE(source_snapshot_id,layout,template_version),
 CHECK(status<>'running' OR lease_until IS NOT NULL),
 CHECK(status<>'ready' OR (artifact_key IS NOT NULL AND artifact_sha256 IS NOT NULL AND artifact_bytes IS NOT NULL AND published_at IS NOT NULL))
);
CREATE INDEX document_claimable ON document_jobs(status,created_at,id);
CREATE TABLE document_requests (
 actor_id INTEGER NOT NULL REFERENCES users(id),
 operation TEXT NOT NULL CHECK(operation IN ('request','retry')),
 key TEXT NOT NULL CHECK(length(key) BETWEEN 8 AND 128),
 request_hash TEXT NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 job_id UUID NOT NULL REFERENCES document_jobs(id),
 response_body JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,operation,key)
);
CREATE FUNCTION reject_document_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Document evidence is immutable'; END $$;
CREATE TRIGGER document_source_immutable BEFORE UPDATE OR DELETE ON document_sources FOR EACH ROW EXECUTE FUNCTION reject_document_mutation();
CREATE TRIGGER document_request_immutable BEFORE UPDATE OR DELETE ON document_requests FOR EACH ROW EXECUTE FUNCTION reject_document_mutation();
CREATE FUNCTION preserve_document_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.source_snapshot_id,NEW.layout,NEW.template_version,NEW.created_at) IS DISTINCT FROM
    (OLD.id,OLD.source_snapshot_id,OLD.layout,OLD.template_version,OLD.created_at) THEN
   RAISE EXCEPTION 'Document identity is immutable';
 END IF;
 IF OLD.artifact_sha256 IS NOT NULL AND (NEW.artifact_sha256,NEW.artifact_bytes) IS DISTINCT FROM (OLD.artifact_sha256,OLD.artifact_bytes) THEN
   RAISE EXCEPTION 'Published document content is immutable';
 END IF;
 IF OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN RAISE EXCEPTION 'Publication date is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_job_identity BEFORE UPDATE ON document_jobs FOR EACH ROW EXECUTE FUNCTION preserve_document_identity();
CREATE TRIGGER document_job_no_delete BEFORE DELETE ON document_jobs FOR EACH ROW EXECUTE FUNCTION reject_document_mutation();
CREATE FUNCTION request_document_retry(target UUID) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE changed INTEGER;
BEGIN
 UPDATE document_jobs SET status='pending',error_code=NULL,updated_at=clock_timestamp(),lease_until=NULL
 WHERE id=target AND status='retryable_failure' AND attempts<3;
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END $$;
CREATE FUNCTION invalidate_document_artifact(target UUID, expected_hash TEXT) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE changed INTEGER;
BEGIN
 UPDATE document_jobs SET status='retryable_failure',error_code='DOCUMENT_ARTIFACT_MISSING',lease_until=NULL,updated_at=clock_timestamp()
 WHERE id=target AND status='ready' AND artifact_sha256=expected_hash;
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END $$;
-- Pin SECURITY DEFINER lookup to the migration's actual schema, including upgrade rehearsals.
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION %I.request_document_retry(uuid) SET search_path=pg_catalog,%I',current_schema(),current_schema());
 EXECUTE format('ALTER FUNCTION %I.invalidate_document_artifact(uuid,text) SET search_path=pg_catalog,%I',current_schema(),current_schema());
END $$;
REVOKE ALL ON FUNCTION request_document_retry(UUID),invalidate_document_artifact(UUID,TEXT) FROM PUBLIC;
