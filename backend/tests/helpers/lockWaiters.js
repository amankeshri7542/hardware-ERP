// Count this fixture's blocking chain, excluding unrelated parallel tests.
async function lockWaiters(pool, blockerPid) {
  const { rows: [row] } = await pool.query(`WITH RECURSIVE blocked(pid) AS (
    SELECT $1::integer UNION
    SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
    WHERE a.datname=current_database() AND a.usename=$2
  ) SELECT COUNT(*)::integer AS count FROM blocked WHERE pid<>$1`,
  [blockerPid, process.env.TEST_APP_DB_USER]);
  return row.count;
}
module.exports = { lockWaiters };
