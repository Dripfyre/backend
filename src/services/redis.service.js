const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

class RedisService {
  constructor() {
    this.client = null;
  }

  async connect() {
    try {
      this.client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      this.client.on('connect', () => {
        logger.info('Redis client connected');
      });

      this.client.on('error', (err) => {
        logger.error('Redis client error:', err);
      });

      return this.client;
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async get(key) {
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error(`Error getting key ${key}:`, error);
      return null;
    }
  }

  async set(key, value, expirySeconds = null) {
    try {
      const serialized = JSON.stringify(value);
      if (expirySeconds) {
        await this.client.setex(key, expirySeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch (error) {
      logger.error(`Error setting key ${key}:`, error);
      return false;
    }
  }

  async delete(key) {
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error(`Error deleting key ${key}:`, error);
      return false;
    }
  }

  async exists(key) {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Error checking existence of key ${key}:`, error);
      return false;
    }
  }

  async expire(key, seconds) {
    try {
      await this.client.expire(key, seconds);
      return true;
    } catch (error) {
      logger.error(`Error setting expiry for key ${key}:`, error);
      return false;
    }
  }

  async keys(pattern) {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error(`Error getting keys with pattern ${pattern}:`, error);
      return [];
    }
  }

  /**
   * Add item to sorted set (for timeline)
   * Score is typically timestamp for chronological ordering
   */
  async zadd(key, score, member) {
    try {
      await this.client.zadd(key, score, member);
      return true;
    } catch (error) {
      logger.error(`Error adding to sorted set ${key}:`, error);
      return false;
    }
  }

  /**
   * Get items from sorted set in reverse order (newest first)
   * with pagination support
   */
  async zrevrange(key, start, stop, withScores = false) {
    try {
      if (withScores) {
        return await this.client.zrevrange(key, start, stop, 'WITHSCORES');
      }
      return await this.client.zrevrange(key, start, stop);
    } catch (error) {
      logger.error(`Error getting range from sorted set ${key}:`, error);
      return [];
    }
  }

  /**
   * Get total count of items in sorted set
   */
  async zcard(key) {
    try {
      return await this.client.zcard(key);
    } catch (error) {
      logger.error(`Error getting count from sorted set ${key}:`, error);
      return 0;
    }
  }

  /**
   * Remove item from sorted set
   */
  async zrem(key, member) {
    try {
      await this.client.zrem(key, member);
      return true;
    } catch (error) {
      logger.error(`Error removing from sorted set ${key}:`, error);
      return false;
    }
  }

  /**
   * Get item score from sorted set
   */
  async zscore(key, member) {
    try {
      return await this.client.zscore(key, member);
    } catch (error) {
      logger.error(`Error getting score from sorted set ${key}:`, error);
      return null;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      logger.info('Redis client disconnected');
    }
  }
}

module.exports = new RedisService();

