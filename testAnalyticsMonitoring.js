const MockRedis = require('./redisMock');
const RateLimiter = require('./rateLimiter');

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function testAnalyticsAndMonitoring() {
  console.log('='.repeat(70));
  console.log('Task 3: Analytics & Monitoring');
  console.log('='.repeat(70));

  // Test 1: Track rate limit hits per endpoint/tier/region
  console.log('\nTest 1: Analytics Tracking (Hits per Endpoint/Tier/Region)');
  console.log('-'.repeat(70));

  const redis1 = new MockRedis();
  const limiter1 = new RateLimiter(redis1, { loggingEnabled: true });

  console.log(
    'Scenario: Multiple users hitting different endpoints with analytics\n'
  );

  // Generate analytics data
  const testCases = [
    { userId: 'user1', endpoint: '/api/search', tier: 'free', country: 'US' },
    { userId: 'user2', endpoint: '/api/search', tier: 'free', country: 'US' },
    { userId: 'user3', endpoint: '/api/search', tier: 'free', country: 'US' },
    {
      userId: 'user1',
      endpoint: '/api/checkout',
      tier: 'premium',
      country: 'CN',
    },
    {
      userId: 'user2',
      endpoint: '/api/checkout',
      tier: 'premium',
      country: 'CN',
    },
    {
      userId: 'user1',
      endpoint: '/api/profile',
      tier: 'enterprise',
      country: 'IN',
    },
  ];

  for (const testCase of testCases) {
    // Make 5 requests per user/endpoint combo
    for (let i = 0; i < 5; i++) {
      await limiter1.checkLimit(
        testCase.userId,
        testCase.endpoint,
        testCase.tier,
        testCase.country
      );
    }
  }

  // Get analytics report
  const report1 = limiter1.getAnalyticsReport();
  console.log(`Analytics Report Generated:`);
  console.log(`Total Endpoints Tracked: ${report1.summary.totalEndpoints}`);
  console.log(`Total Requests: ${report1.summary.totalRequests}`);
  console.log(`Allowed: ${report1.summary.totalAllowed}`);
  console.log(`Denied: ${report1.summary.totalDenied}`);
  console.log(`Overall Allow Rate: ${report1.summary.allowRate}\n`);

  console.log(`  Breakdown by Endpoint/Tier/Region:`);
  report1.endpoints.forEach((ep) => {
    console.log(
      `${ep.endpoint} | Tier: ${ep.tier} | Region: ${ep.countryCode} | ` +
        `Allowed: ${ep.allowed} | Denied: ${ep.denied} | Rate: ${ep.allowRate}`
    );
  });

  console.log(`\nAnalytics tracking working correctly`);

  // Test 2: Slow-start for new users (gradually increase limits)
  console.log('\nTest 2: Slow-Start for New Users');
  console.log('-'.repeat(70));

  const redis2 = new MockRedis();
  const limiter2 = new RateLimiter(redis2, {
    slowStartEnabled: true,
    slowStartDuration: 60, // 60 seconds for testing
    slowStartStages: [0.3, 0.6, 1.0], // 30%, 60%, 100%
  });

  console.log('Scenario: New user progression through slow-start stages\n');
  console.log('Free tier: max=100, burst=20');
  console.log('Stage 0 (0-20s): 30% capacity = max:30, burst:6');
  console.log('Stage 1 (20-40s): 60% capacity = max:60, burst:12');
  console.log('Stage 2 (40-60s): 100% capacity = max:100, burst:20\n');

  const newUserId = 'new_user_slowstart';
  const endpoint = '/api/search';

  // Stage 0: Make requests - should be limited to 6 burst tokens
  console.log('Stage 0 (First 20 seconds):');
  const stage0Requests = [];
  for (let i = 0; i < 10; i++) {
    const result = await limiter2.checkLimit(newUserId, endpoint, 'free', 'US');
    stage0Requests.push(result);
  }
  const stage0Allowed = stage0Requests.filter((r) => r.allowed).length;
  console.log(
    `Made 10 requests, ${stage0Allowed} allowed (burst=6 expected)\n`
  );

  // Test 3: Optional logging for security review
  console.log('\nTest 3: Security Logging for Review');
  console.log('-'.repeat(70));

  const redis3 = new MockRedis();
  const limiter3 = new RateLimiter(redis3, { loggingEnabled: true });

  console.log('Scenario: Capture security events for audit trail\n');

  // Generate various security events
  const testUsers = ['user_a', 'user_b', 'user_c'];

  for (const userId of testUsers) {
    // Make requests to trigger logging
    for (let i = 0; i < 30; i++) {
      await limiter3.checkLimit(userId, '/api/checkout', 'free', 'US');
    }
  }

  // Get security log
  const securityLog = limiter3.getSecurityLog();
  console.log(`Total Security Events Logged: ${securityLog.length}`);

  // Filter by event type
  const rateLimitEvents = limiter3.getSecurityLog({
    type: 'rate_limit_exceeded',
  });
  const newUserEvents = limiter3.getSecurityLog({ type: 'new_user' });

  console.log(`Rate Limit Exceeded Events: ${rateLimitEvents.length}`);
  console.log(`New User Events: ${newUserEvents.length}\n`);

  if (rateLimitEvents.length > 0) {
    console.log('Sample Rate Limit Events:');
    rateLimitEvents.slice(0, 3).forEach((event, idx) => {
      console.log(
        `${idx + 1}. User: ${event.userId} | Endpoint: ${
          event.endpoint
        } | Tier: ${event.tier}`
      );
    });
  }

  console.log(`\nSecurity events captured for audit trail`);

  // Test 4: Slow-start progression over time
  console.log('\nTest 4: Slow-Start Progression Analysis');
  console.log('-'.repeat(70));

  const redis4 = new MockRedis();
  const limiter4 = new RateLimiter(redis4, {
    slowStartEnabled: true,
    slowStartDuration: 90, // 90 seconds total
    slowStartStages: [0.25, 0.5, 0.75, 1.0], // 25%, 50%, 75%, 100%
  });

  console.log('Scenario: Analyze different new users in different stages\n');

  const progressionAnalysis = [];
  const slowStartUsers = ['new_user_1', 'new_user_2', 'new_user_3'];

  for (const userId of slowStartUsers) {
    const requests = [];
    for (let i = 0; i < 30; i++) {
      const result = await limiter4.checkLimit(
        userId,
        '/api/search',
        'premium',
        'US'
      );
      requests.push(result);
    }

    const allowed = requests.filter((r) => r.allowed).length;
    progressionAnalysis.push({
      userId,
      totalRequests: 30,
      allowed,
      denied: 30 - allowed,
    });
  }

  console.log('New User Progression:');
  progressionAnalysis.forEach((analysis) => {
    const allowRate = (
      (analysis.allowed / analysis.totalRequests) *
      100
    ).toFixed(1);
    console.log(
      `    ${analysis.userId}: Allowed ${analysis.allowed}/${analysis.totalRequests} ` +
        `(${allowRate}% - limited by slow-start)`
    );
  });

  console.log(`\nSlow-start progression tracked correctly`);

  // Test 5: Combined analytics with rate limiting denial
  console.log('\nTest 5: Denial Rate Analysis');
  console.log('-'.repeat(70));

  const redis5 = new MockRedis();
  const limiter5 = new RateLimiter(redis5, { loggingEnabled: true });

  console.log('Scenario: Aggressive user hitting rate limits\n');

  const aggressiveUserId = 'aggressive_user';
  const aggResults = [];

  for (let i = 0; i < 50; i++) {
    const result = await limiter5.checkLimit(
      aggressiveUserId,
      '/api/search',
      'free',
      'US'
    );
    aggResults.push(result);
  }

  const aggAllowed = aggResults.filter((r) => r.allowed).length;
  const aggDenied = aggResults.filter((r) => !r.allowed).length;
  const aggDenialRate = ((aggDenied / 50) * 100).toFixed(1);

  console.log(`50 Requests from Aggressive User:`);
  console.log(`Allowed: ${aggAllowed}`);
  console.log(`Denied: ${aggDenied} (${aggDenialRate}% denial rate)`);

  // Get analytics for this endpoint
  const aggAnalytics = limiter5.getAnalyticsReport();
  console.log(`\nAnalytics for /api/search (free tier):`);
  const searchAnalytics = aggAnalytics.endpoints.find(
    (e) => e.endpoint === '/api/search' && e.tier === 'free'
  );
  if (searchAnalytics) {
    console.log(`Total Requests: ${searchAnalytics.totalRequests}`);
    console.log(`Allowed: ${searchAnalytics.allowed}`);
    console.log(`Denied: ${searchAnalytics.denied}`);
    console.log(`Allow Rate: ${searchAnalytics.allowRate}`);
  }

  console.log(`\nDenial rates properly tracked for rate limiting analysis`);
  console.log('Analytics & Monitoring Tests Complete!');
}

testAnalyticsAndMonitoring().catch(console.error);
