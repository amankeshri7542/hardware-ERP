-- Explicitly place pg_temp last: implicit temp relation lookup must never shadow definer tables.
DO $$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.request_document_retry(UUID) SET search_path = pg_catalog, %I, pg_temp', current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.invalidate_document_artifact(UUID,TEXT) SET search_path = pg_catalog, %I, pg_temp', current_schema(), current_schema());
END;
$$;
