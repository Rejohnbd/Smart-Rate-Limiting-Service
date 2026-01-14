const express = require('express');
const MockRedis = require('./redisMock');
const RateLimiter = require('./rateLimiter');
const extractUserInfo = require('./middleware/extractUserInfo');
const createRateLimitMiddleware = require('./middleware/rateLimitMiddleware');

const app = express();
const port = 3000;

// Initialize Rate Limiter
const redis = new MockRedis();
const limiter = new RateLimiter(redis, {
  loggingEnabled: true,
  slowStartEnabled: true,
  cacheEnabled: true,
  cacheTTL: 1000,
});

app.use(express.json());
app.use(extractUserInfo);

// Create rate limit middleware factory
const rateLimitMiddleware = createRateLimitMiddleware(limiter);

// Search endpoint - High limits
app.get('/api/search', rateLimitMiddleware('/api/search'), (req, res) => {
  res.json({
    endpoint: '/api/search',
    query: req.query.q || 'default',
    results: ['item1', 'item2', 'item3'],
    user: { id: req.userId, tier: req.userTier, region: req.region },
  });
});

// Checkout endpoint - Strict limits (fraud prevention)
app.post('/api/checkout', rateLimitMiddleware('/api/checkout'), (req, res) => {
  res.json({
    endpoint: '/api/checkout',
    orderId: req.body.orderId || 'ORD-000',
    amount: req.body.amount || 0,
    status: 'success',
    user: { id: req.userId, tier: req.userTier, region: req.region },
  });
});

// Profile endpoint - Medium limits
app.get('/api/profile', rateLimitMiddleware('/api/profile'), (req, res) => {
  res.json({
    endpoint: '/api/profile',
    userId: req.userId,
    tier: req.userTier,
    region: req.region,
    email: `user_${req.userId}@example.com`,
  });
});

app.listen(port, () => {
  console.log(`Server running on: ${port}`);
});
