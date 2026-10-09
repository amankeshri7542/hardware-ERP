const { date, fail } = require('./financial');

async function requireOpenDate(client, value, { exclusive = false } = {}) {
  await client.query(`SELECT pg_advisory_xact_lock${exclusive ? '' : '_shared'}(172904,4)`);
  const { rows: [state] } = await client.query(`SELECT timezone,
    (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date::text AS today,
    (SELECT MAX(date)::text FROM financial_day_closes) AS closed_through
    FROM shop_finance_config WHERE id=true`);
  if (!state) fail('FINANCIAL_CONFIGURATION_REQUIRED');
  const businessDate = value === undefined || value === null ? state.today : date(value);
  if (state.closed_through && businessDate <= state.closed_through) fail('FINANCIAL_PERIOD_CLOSED', 409);
  if (businessDate > state.today) fail('FUTURE_FINANCIAL_DATE');
  return { ...state, date: businessDate };
}

module.exports = { requireOpenDate };
