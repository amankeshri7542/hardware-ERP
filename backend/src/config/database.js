const fs = require('node:fs');
const { X509Certificate } = require('node:crypto');

function databaseOptions(env = process.env, { migration = false } = {}) {
  if (!['development', 'test', 'production'].includes(env.NODE_ENV)) throw new Error('Invalid NODE_ENV');
  const production = env.NODE_ENV === 'production';
  const required = (name) => {
    if (!env[name] || /^(change[-_]?me|replace|example|placeholder)/i.test(env[name])) throw new Error(`Invalid or missing ${name}`);
    return env[name];
  };
  const port = Number(env.DB_PORT || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid DB_PORT');
  let ssl = false;
  if (production || env.DB_SSL === 'true') {
    const caPath = required('DB_SSL_CA_PATH');
    let ca;
    try {
      ca = fs.readFileSync(caPath, 'utf8');
      const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
      if (!certificates?.length) throw new Error('Missing certificate');
      certificates.forEach((certificate) => new X509Certificate(certificate));
    } catch { throw new Error('Invalid or unreadable DB_SSL_CA_PATH'); }
    ssl = { ca, rejectUnauthorized: true };
  } else if (env.DB_SSL && env.DB_SSL !== 'false') throw new Error('Invalid DB_SSL');
  if (production && env.DB_SSL !== 'true') throw new Error('Production requires DB_SSL=true');
  const userKey = migration && (production || env.MIGRATION_DB_USER) ? 'MIGRATION_DB_USER' : 'DB_USER';
  const passwordKey = migration && (production || env.MIGRATION_DB_USER) ? 'MIGRATION_DB_PASSWORD' : 'DB_PASSWORD';
  return {
    host: required('DB_HOST'), port, database: required('DB_NAME'), user: required(userKey),
    password: required(passwordKey), ssl, connectionTimeoutMillis: 5000,
    application_name: migration ? 'hardware-erp-migrations' : 'hardware-erp-api',
  };
}
module.exports = { databaseOptions };
