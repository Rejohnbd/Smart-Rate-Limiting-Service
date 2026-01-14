/**
 * Middleware: Rate limiting
 * Creates a middleware that enforces rate limits for a specific endpoint
 * Applies user tier, geographic, and request cost multipliers
 */
const rateLimitMiddleware = (limiter) => {
  return (endpoint) => {
    return async (req, res, next) => {
      try {
        const result = await limiter.checkLimit(
          req.userId,
          endpoint,
          req.userTier,
          req.region,
          req.requestCost
        );

        res.set('X-RateLimit-Remaining', result.remaining);
        res.set('X-RateLimit-Allowed', result.allowed);
        res.set('X-RateLimit-RetryAfter', result.retryAfter);

        if (!result.allowed) {
          return res.status(429).json({
            error: 'Rate limit exceeded',
            retryAfter: result.retryAfter,
            remaining: result.remaining,
          });
        }
        next();
      } catch (error) {
        console.error('Rate limiter error:', error);
        res.status(503).json({ error: 'Service unavailable' });
      }
    };
  };
};

module.exports = rateLimitMiddleware;
