const MockRedis = require('./redisMock');
const RateLimiter = require('./rateLimiter');

async function testRateLimiter() {
  const redis = new MockRedis();
  const limiter = new RateLimiter(redis);

  console.log('Testing rate limiter...\n');

  // Test 1: Free tier, search endpoint, US region
  console.log('Test 1: Free tier, /api/search, US region');
  const result1 = await limiter.checkLimit(
    'user1',
    '/api/search',
    'free',
    'US'
  );
  console.log('Before request:', result1);

  const record1 = await limiter.recordRequest(
    'user1',
    '/api/search',
    'free',
    'US'
  );
  console.log('After request:', record1);

  // Test 2: Premium tier, checkout endpoint, CN region (stricter)
  console.log('\nTest 2: Premium tier, /api/checkout, CN region');
  const result2 = await limiter.checkLimit(
    'user2',
    '/api/checkout',
    'premium',
    'CN'
  );
  console.log('Before request:', result2);

  const record2 = await limiter.recordRequest(
    'user2',
    '/api/checkout',
    'premium',
    'CN'
  );
  console.log('After request:', record2);

  // Test 3: Enterprise tier, profile endpoint, IN region (higher limits)
  console.log('\nTest 3: Enterprise tier, /api/profile, IN region');
  const result3 = await limiter.checkLimit(
    'user3',
    '/api/profile',
    'enterprise',
    'IN'
  );
  console.log('Before request:', result3);

  const record3 = await limiter.recordRequest(
    'user3',
    '/api/profile',
    'enterprise',
    'IN'
  );
  console.log('After request:', record3);

  // Test 4: Burst test - make multiple requests
  console.log('\nTest 4: Burst test - 150 requests to search endpoint');
  const burstUser = 'burstUser';
  for (let i = 0; i < 150; i++) {
    await limiter.recordRequest(burstUser, '/api/search', 'free', 'US');
  }
  const burstResult = await limiter.checkLimit(
    burstUser,
    '/api/search',
    'free',
    'US'
  );
  console.log('After 150 requests:', burstResult);

  console.log('\nAll tests completed!');
}

testRateLimiter().catch(console.error);
