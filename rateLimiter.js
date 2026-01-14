const { RATE_LIMITS, GEO_LIMITS } = require('./configuration');

class RateLimiter {
  constructor(redisClient) {
    this.redis = redisClient;
    this.config = RATE_LIMITS;
    this.geoMultipliers = GEO_LIMITS;
  }

  async checkLimit(userId, endpoint, tier, countryCode) {
    try {
      // Get base configuration
      const tierConfig = this.config[tier];
      if (!tierConfig) {
        console.warn(`Invalid tier: ${tier}. Defaulting to free tier.`);
        tier = 'free';
      }

      const endpointConfig = this.config[tier][endpoint];
      if (!endpointConfig) {
        // No rate limit for this endpoint
        return { allowed: true, remaining: Infinity, retryAfter: 0 };
      }

      // Apply geographic multiplier
      const geoConfig =
        this.geoMultipliers[countryCode] || this.geoMultipliers.DEFAULT;
      const geoMultiplier = geoConfig.multiplier;
      const adjustedMax = Math.floor(endpointConfig.max * geoMultiplier);
      const adjustedBurst = Math.floor(endpointConfig.burst * geoMultiplier);

      const now = Math.floor(Date.now() / 1000);
      const window = endpointConfig.window;

      // Keys for Redis
      const tokenKey = `rate:tokens:${userId}:${endpoint}`;
      const lastRefillKey = `rate:last_refill:${userId}:${endpoint}`;
      const countKey = `rate:count:${userId}:${endpoint}`;

      // Atomic Lua script to prevent race conditions
      // This is executed atomically in Redis
      const luaScript = `
        local tokenKey = KEYS[1]
        local lastRefillKey = KEYS[2]
        local countKey = KEYS[3]
        local now = tonumber(ARGV[1])
        local adjustedMax = tonumber(ARGV[2])
        local adjustedBurst = tonumber(ARGV[3])
        local window = tonumber(ARGV[4])
        
        local tokens = tonumber(redis.call('GET', tokenKey)) or adjustedBurst
        local lastRefill = tonumber(redis.call('GET', lastRefillKey)) or now
        local count = tonumber(redis.call('GET', countKey)) or 0
        
        local timePassed = now - lastRefill
        local refillAmount = (timePassed * adjustedMax) / window
        tokens = math.min(adjustedBurst, tokens + refillAmount)
        
        local allowed = tokens >= 1 and count < adjustedMax
        
        if allowed then
          tokens = tokens - 1
          count = count + 1
        end
        
        redis.call('SETEX', tokenKey, window, tostring(tokens))
        redis.call('SETEX', lastRefillKey, window, tostring(now))
        redis.call('SETEX', countKey, window, tostring(count))
        
        return {allowed and 1 or 0, math.floor(math.max(0, tokens)), count}
      `;

      try {
        const result = await this.redis.eval(
          luaScript,
          3,
          tokenKey,
          lastRefillKey,
          countKey,
          now,
          adjustedMax,
          adjustedBurst,
          window
        );

        if (result) {
          const [allowedFlag, remaining, count] = result;
          const allowed = allowedFlag === 1;

          if (allowed) {
            return {
              allowed: true,
              remaining: remaining,
              retryAfter: 0,
            };
          } else {
            // Calculate retry time
            let retryAfter = 0;
            const tokens = parseFloat(await this.redis.get(tokenKey)) || 0;
            if (tokens < 1) {
              const tokensNeeded = 1 - tokens;
              const secondsPerToken = window / adjustedMax;
              retryAfter = Math.ceil(tokensNeeded * secondsPerToken);
            }

            return {
              allowed: false,
              remaining: 0,
              retryAfter: Math.max(retryAfter, 1),
            };
          }
        }
      } catch (error) {
        console.error('Lua script error:', error);
        // Fallback to non-atomic approach if Lua fails
        return await this.checkLimitFallback(
          userId,
          endpoint,
          tier,
          countryCode,
          tokenKey,
          lastRefillKey,
          countKey,
          now,
          window,
          adjustedMax,
          adjustedBurst
        );
      }
    } catch (error) {
      console.error('Rate limiting error:', error);
      // Fail open - allow request if rate limiting fails
      return { allowed: true, remaining: Infinity, retryAfter: 0 };
    }
  }

  // Fallback method for non-atomic approach
  async checkLimitFallback(
    userId,
    endpoint,
    tier,
    countryCode,
    tokenKey,
    lastRefillKey,
    countKey,
    now,
    window,
    adjustedMax,
    adjustedBurst
  ) {
    try {
      // Get current values from Redis
      let tokens, lastRefill, count;

      try {
        const [tokensStr, lastRefillStr, countStr] = await Promise.all([
          this.redis.get(tokenKey),
          this.redis.get(lastRefillKey),
          this.redis.get(countKey),
        ]);

        tokens = parseFloat(tokensStr) || adjustedBurst;
        lastRefill = parseInt(lastRefillStr) || now;
        count = parseInt(countStr) || 0;
      } catch (error) {
        console.error('Redis read error:', error);
        return { allowed: true, remaining: Infinity, retryAfter: 0 };
      }

      // Token Bucket: Refill tokens based on time passed
      const timePassed = now - lastRefill;
      const refillAmount = (timePassed * adjustedMax) / window;
      tokens = Math.min(adjustedBurst, tokens + refillAmount);

      // Check if request is allowed
      if (tokens >= 1 && count < adjustedMax) {
        // Consume one token
        tokens -= 1;
        count += 1;

        try {
          // Update state in Redis
          await Promise.all([
            this.redis.setex(tokenKey, window, tokens),
            this.redis.setex(lastRefillKey, window, now),
            this.redis.setex(countKey, window, count),
          ]);
        } catch (error) {
          console.error('Redis write error:', error);
          // Continue even if write fails
        }

        return {
          allowed: true,
          remaining: Math.max(0, Math.floor(tokens)),
          retryAfter: 0,
        };
      } else {
        // Request denied
        let retryAfter = 0;

        if (tokens < 1) {
          // Calculate when next token will be available
          const tokensNeeded = 1 - tokens;
          const secondsPerToken = window / adjustedMax;
          retryAfter = Math.ceil(tokensNeeded * secondsPerToken);
        }

        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.max(retryAfter, 1),
        };
      }
    } catch (error) {
      console.error('Fallback error:', error);
      return { allowed: true, remaining: Infinity, retryAfter: 0 };
    }
  }

  async recordRequest(userId, endpoint, tier, countryCode) {
    return await this.checkLimit(userId, endpoint, tier, countryCode);
  }
}
module.exports = RateLimiter;
