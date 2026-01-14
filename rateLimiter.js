const { RATE_LIMITS, GEO_LIMITS } = require('./configuration');

class RateLimiter {
  constructor(redisClient, options = {}) {
    this.redis = redisClient;
    this.config = RATE_LIMITS;
    this.geoMultipliers = GEO_LIMITS;

    // Analytics & Monitoring
    this.analytics = {
      hits: new Map(), // Track rate limit hits per endpoint/tier/region
      slowStart: new Map(), // Track new user progression
    };

    // Logging
    this.logging = {
      enabled: options.loggingEnabled || false,
      events: [], // Store security events
      maxEvents: options.maxLogEvents || 1000,
    };

    // Slow-start configuration
    this.slowStart = {
      enabled: options.slowStartEnabled !== false,
      duration: options.slowStartDuration || 86400, // 24 hours in seconds
      stages: options.slowStartStages || [0.3, 0.6, 1.0], // 30%, 60%, 100% of normal limits
    };

    // Optimization: local cache to reduce Redis calls
    this.localCache = new Map(); // Cache: key -> { value, ttl }
    this.cacheEnabled = options.cacheEnabled !== false;
    this.cacheTTL = options.cacheTTL || 1000; // 1 second cache TTL

    // Request cost tracking
    this.costEnabled = options.costEnabled !== false;
  }

  // Optimization: Local cache management
  getFromCache(key) {
    if (!this.cacheEnabled) return null;
    const cached = this.localCache.get(key);
    if (!cached) return null;
    if (cached.ttl < Date.now()) {
      this.localCache.delete(key);
      return null;
    }
    return cached.value;
  }

  setInCache(key, value) {
    if (!this.cacheEnabled) return;
    this.localCache.set(key, {
      value,
      ttl: Date.now() + this.cacheTTL,
    });
  }

  // Clear cache for a user (when tier changes)
  clearUserCache(userId) {
    for (const key of this.localCache.keys()) {
      if (key.includes(userId)) {
        this.localCache.delete(key);
      }
    }
  }

  // Log security event
  logSecurityEvent(event) {
    if (!this.logging.enabled) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      ...event,
    };

    this.logging.events.push(logEntry);

    // Keep only recent events
    if (this.logging.events.length > this.logging.maxEvents) {
      this.logging.events.shift();
    }
  }

  // Track analytics hit
  recordAnalyticsHit(userId, endpoint, tier, countryCode, allowed) {
    const key = `${endpoint}:${tier}:${countryCode}`;

    if (!this.analytics.hits.has(key)) {
      this.analytics.hits.set(key, {
        endpoint,
        tier,
        countryCode,
        allowed: 0,
        denied: 0,
        totalRequests: 0,
      });
    }

    const stat = this.analytics.hits.get(key);
    stat.totalRequests++;
    if (allowed) {
      stat.allowed++;
    } else {
      stat.denied++;
    }
  }

  // Get slow-start multiplier for new users
  async getSlowStartMultiplier(userId, endpoint) {
    if (!this.slowStart.enabled) return 1.0;

    const userKey = `slowstart:${userId}:${endpoint}`;

    try {
      const createdAt = await this.redis.get(userKey);

      // New user - set creation time
      if (!createdAt) {
        await this.redis.setex(
          userKey,
          this.slowStart.duration,
          Math.floor(Date.now() / 1000)
        );
        // Log new user
        this.logSecurityEvent({
          type: 'new_user',
          userId,
          endpoint,
          action: 'slow_start_initialized',
        });
        return this.slowStart.stages[0]; // Start at first stage
      }

      // Calculate user age
      const now = Math.floor(Date.now() / 1000);
      const userAge = now - parseInt(createdAt);
      const stageDuration =
        this.slowStart.duration / this.slowStart.stages.length;

      // Determine which stage
      let stage = 0;
      for (let i = 0; i < this.slowStart.stages.length; i++) {
        if (userAge >= stageDuration * (i + 1)) {
          stage = i + 1;
        } else {
          break;
        }
      }

      stage = Math.min(stage, this.slowStart.stages.length - 1);
      return this.slowStart.stages[stage];
    } catch (error) {
      console.error('Slow-start calculation error:', error);
      return 1.0; // Fail open
    }
  }

  // Get analytics report
  getAnalyticsReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalEndpoints: 0,
        totalRequests: 0,
        totalAllowed: 0,
        totalDenied: 0,
        allowRate: 0,
      },
      endpoints: [],
    };

    for (const [key, stat] of this.analytics.hits.entries()) {
      report.endpoints.push({
        ...stat,
        allowRate:
          stat.totalRequests > 0
            ? ((stat.allowed / stat.totalRequests) * 100).toFixed(2) + '%'
            : 'N/A',
      });

      report.summary.totalRequests += stat.totalRequests;
      report.summary.totalAllowed += stat.allowed;
      report.summary.totalDenied += stat.denied;
    }

    report.summary.totalEndpoints = this.analytics.hits.size;
    report.summary.allowRate =
      report.summary.totalRequests > 0
        ? (
            (report.summary.totalAllowed / report.summary.totalRequests) *
            100
          ).toFixed(2) + '%'
        : 'N/A';

    return report;
  }

  // Get security log
  getSecurityLog(filter = {}) {
    let logs = [...this.logging.events];

    if (filter.userId) {
      logs = logs.filter((e) => e.userId === filter.userId);
    }

    if (filter.type) {
      logs = logs.filter((e) => e.type === filter.type);
    }

    if (filter.startTime) {
      logs = logs.filter(
        (e) => new Date(e.timestamp) >= new Date(filter.startTime)
      );
    }

    return logs;
  }

  async checkLimit(userId, endpoint, tier, countryCode, requestCost = 1) {
    try {
      // Optimization: Check cache first (except for unlimited tier)
      const cacheKey = `check:${userId}:${endpoint}:${tier}`;
      if (tier !== 'unlimited') {
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          return cached;
        }
      }

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

      // OPTIMIZATION: Unlimited tier bypass - no Redis call needed
      if (tier === 'unlimited') {
        this.recordAnalyticsHit(userId, endpoint, tier, countryCode, true);
        return { allowed: true, remaining: Infinity, retryAfter: 0 };
      }

      // Apply geographic multiplier
      const geoConfig =
        this.geoMultipliers[countryCode] || this.geoMultipliers.DEFAULT;
      const geoMultiplier = geoConfig.multiplier;
      let adjustedMax = Math.floor(endpointConfig.max * geoMultiplier);
      let adjustedBurst = Math.floor(endpointConfig.burst * geoMultiplier);

      // Apply slow-start multiplier for new users
      const slowStartMultiplier = await this.getSlowStartMultiplier(
        userId,
        endpoint
      );
      adjustedMax = Math.floor(adjustedMax * slowStartMultiplier);
      adjustedBurst = Math.floor(adjustedBurst * slowStartMultiplier);

      const now = Math.floor(Date.now() / 1000);
      const window = endpointConfig.window;

      // Keys for Redis
      const tokenKey = `rate:tokens:${userId}:${endpoint}`;
      const lastRefillKey = `rate:last_refill:${userId}:${endpoint}`;
      const countKey = `rate:count:${userId}:${endpoint}`;

      // OPTIMIZATION: Lua script updated to handle request cost
      // This is executed atomically in Redis - single call reduces overhead
      const luaScript = `
        local tokenKey = KEYS[1]
        local lastRefillKey = KEYS[2]
        local countKey = KEYS[3]
        local now = tonumber(ARGV[1])
        local adjustedMax = tonumber(ARGV[2])
        local adjustedBurst = tonumber(ARGV[3])
        local window = tonumber(ARGV[4])
        local cost = tonumber(ARGV[5])
        
        local tokens = tonumber(redis.call('GET', tokenKey)) or adjustedBurst
        local lastRefill = tonumber(redis.call('GET', lastRefillKey)) or now
        local count = tonumber(redis.call('GET', countKey)) or 0
        
        local timePassed = now - lastRefill
        local refillAmount = (timePassed * adjustedMax) / window
        tokens = math.min(adjustedBurst, tokens + refillAmount)
        
        local allowed = tokens >= cost and count < adjustedMax
        
        if allowed then
          tokens = tokens - cost
          count = count + cost
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
          window,
          requestCost
        );

        if (result) {
          const [allowedFlag, remaining, count] = result;
          const allowed = allowedFlag === 1;

          // Record analytics
          this.recordAnalyticsHit(userId, endpoint, tier, countryCode, allowed);

          // Cache the result for optimization (except denials)
          if (allowed) {
            const response = {
              allowed: true,
              remaining: remaining,
              retryAfter: 0,
              cost: requestCost,
            };
            this.setInCache(cacheKey, response);
            return response;
          } else {
            // Log rate limit denial for security review
            this.logSecurityEvent({
              type: 'rate_limit_exceeded',
              userId,
              endpoint,
              tier,
              countryCode,
              slowStartMultiplier,
              requestCost,
            });

            // Calculate retry time
            let retryAfter = 0;
            const tokens = parseFloat(await this.redis.get(tokenKey)) || 0;
            if (tokens < requestCost) {
              const tokensNeeded = requestCost - tokens;
              const secondsPerToken = window / adjustedMax;
              retryAfter = Math.ceil(tokensNeeded * secondsPerToken);
            }

            return {
              allowed: false,
              allowed: false,
              remaining: 0,
              retryAfter: Math.max(retryAfter, 1),
              cost: requestCost,
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
          adjustedBurst,
          requestCost
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
    adjustedBurst,
    requestCost = 1
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

      // Check if request is allowed (with cost)
      if (tokens >= requestCost && count < adjustedMax) {
        // Consume tokens based on request cost
        tokens -= requestCost;
        count += requestCost;

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
