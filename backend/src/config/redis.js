const Redis = require('ioredis');
const { securityLog } = require('../utils/securityLog');

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
});

redis.on('connect', () => {
  securityLog('redis.connected');
});

redis.on('error', () => {
  securityLog('redis.connection_failed');
});

module.exports = redis;
