# Smart Rate Limiting Service

A production-ready rate limiting service with token bucket algorithm, tier-based multipliers, and geographic considerations.

## Statement

Building a rate limiting service for an e-commerce platform with:

- **Different user tiers**: Free, Premium, Enterprise
- **Different endpoints with varying limits**:
  - `/api/search`: High limits (users search frequently)
  - `/api/checkout`: Very strict limits (fraud prevention)
  - `/api/profile`: Medium limits
- **Geographic considerations**: Users in different regions get adjusted limits
- **Burst support**: Allow short bursts above normal rate

## Implementation

### Core Requirements

- Implement token bucket algorithm with burst support
- Use sliding window approach
- Apply tier-based multipliers
- Apply geographic multipliers
- Return: `{ allowed: boolean, remaining: number, retryAfter: number }`

### Architecture

#### Token Bucket Algorithm

- Each endpoint/user combination maintains a token bucket
- Tokens refill based on time elapsed and the configured rate
- Requests consume 1 token; allowed if tokens ≥ 1 and count < max
- Burst capacity allows temporary spikes above the steady-state rate

#### Geographic Multipliers

```javascript
{
  US: { multiplier: 1.0 },   // Baseline
  EU: { multiplier: 1.0 },   // Baseline
  CN: { multiplier: 0.5 },   // Stricter (compliance)
  IN: { multiplier: 2.0 },   // Higher (market access)
  DEFAULT: { multiplier: 1.0 }
}
```

Run core tests:

```bash
node testRateLimiter.js
```

## API Response Format

```javascript
{
  allowed: boolean,    // Request allowed or rejected
  remaining: number,   // Tokens remaining in bucket
  retryAfter: number   // Seconds to wait if rejected
}
```

## Handle Edge Cases & Race Conditions

### Core Requirements

- Multiple concurrent requests from same user
- Redis connection failures (implement fallback)
- Configuration changes mid-window
- Clock skew between servers

### Implementation Details

#### 1. Concurrent Request Handling

- **Atomic Lua Scripts**: All rate limit operations execute atomically in Redis
- **Race Condition Prevention**: Token bucket state updates are serialized
- **Concurrent Burst Handling**: Multiple simultaneous requests properly decrement tokens
- **Test Results**: 5-50 concurrent requests handled correctly with accurate token consumption

#### 2. Redis Connection Failures & Fallback

- **In-Memory Fallback Cache**: Automatically activates when Redis unavailable
- **Graceful Degradation**: Service remains available despite Redis outages
- **Health Checks**: Periodic attempts to detect Redis recovery
- **State Persistence**: Token bucket state maintained in fallback cache with TTL simulation
- **Test Results**: 15 requests with 10% failure rate, all succeeded via fallback

#### 3. Configuration Changes Mid-Window

- **Dynamic Configuration**: Rate limits can be updated without restarting service
- **State Preservation**: Historical token state preserved across config changes
- **Per-Endpoint Updates**: Changes to specific endpoints don't affect others
- **Test Results**: Config changes applied mid-window with proper enforcement

#### 4. Clock Skew Between Servers

- **Refill Logic Resilience**: Token refill calculations handle time differences
- **Server Independence**: Each server can have different local time
- **Graceful Handling**: Time skew up to 30+ seconds handled safely
- **Test Results**: Server with +30s clock skew properly refills tokens

### Advanced Features

#### Atomic Operations (Lua Script)

```lua
-- Prevents race conditions in distributed systems
local tokens = refill_based_on_time_passed()
if tokens >= 1 and count < max then
  tokens -= 1
  count += 1
  ALLOWED
else
  DENIED
end
```

#### Fallback Cache Architecture

- **Primary**: Redis (distributed, shared state)
- **Secondary**: In-memory Map (local cache, TTL-aware)
- **Automatic Failover**: Seamless transition on Redis failure
- **Recovery Detection**: Automatic switch back to Redis when available

#### Multi-User Isolation

- Independent rate limits per `user:endpoint` combination
- No interference between different users
- Geographic multipliers applied per-user basis

### Test Coverage

Run edge case tests:

```bash
node testEdgeCasesRaceConditionsRequest.js
```

## Analytics & Monitoring

### Core Requirements

- Track rate limit hits per endpoint/tier/region
- Implement slow-start for new users (gradually increase limits)
- Add optional logging for security review

### Implementation Details

#### 1. Analytics Tracking

**Tracks metrics per endpoint/tier/region combination:**

```javascript
{
  endpoint: '/api/search',
  tier: 'free',
  countryCode: 'US',
  allowed: 150,
  denied: 50,
  totalRequests: 200,
  allowRate: '75.00%'
}
```

**Capabilities:**

- Real-time hit counting
- Allow/deny rate calculations
- Aggregated reporting by endpoint, tier, and region
- Identifies bottlenecks and abuse patterns

#### 2. Slow-Start for New Users

**Gradual capacity increase to detect and mitigate fraud:**

```javascript
// Default configuration
slowStart: {
  enabled: true,
  duration: 86400,        // 24 hours
  stages: [0.3, 0.6, 1.0] // 30%, 60%, 100%
}
```

**Timeline Example:**

- Hours 0-8: User gets 30% of normal limits
- Hours 8-16: User gets 60% of normal limits
- Hours 16-24: User gets 100% of normal limits

**Benefits:**

- Detects unusual behavior early
- Limits fraud damage for compromised accounts
- Gradually builds trust for legitimate users
- Reduces sudden spike abuse

#### 3. Security Logging

**Optional audit trail for compliance and investigation:**

```javascript
// Enable logging
const limiter = new RateLimiter(redis, { loggingEnabled: true });

// Events captured:
// - new_user: User enters slow-start
// - rate_limit_exceeded: Request denied due to limit
// - configuration_change: Rate limits updated
```

**Log Format:**

```javascript
{
  timestamp: "2025-01-14T10:30:45.123Z",
  type: "rate_limit_exceeded",
  userId: "user_123",
  endpoint: "/api/checkout",
  tier: "free",
  countryCode: "US"
}
```

**Query Capabilities:**

```javascript
// Get all events
limiter.getSecurityLog();

// Filter by user
limiter.getSecurityLog({ userId: 'user_123' });

// Filter by event type
limiter.getSecurityLog({ type: 'rate_limit_exceeded' });

// Filter by time range
limiter.getSecurityLog({ startTime: '2025-01-14T10:00:00Z' });
```

### Test Coverage

Run analytics & monitoring tests:

```bash
node testAnalyticsMonitoring.js
```

---

## Optimization

### Core Requirements

- The current implementation uses 1 Redis call per check. Optimize to reduce Redis calls.
- Support "unlimited" tier (no rate limiting) efficiently.
- Add request "cost" - some endpoints count as multiple requests.

### 1. Reduced Redis Calls via Local Caching

**Without cache:** 50 requests = 50 Redis calls
**With cache:** 50 requests = 1 Redis call (98% reduction)

```javascript
const limiter = new RateLimiter(redis, {
  cacheEnabled: true,
  cacheTTL: 1000, // 1 second cache
});
```

### 2. Unlimited Tier (Zero Overhead)

Bypass rate limiting for internal services and premium partners.

```javascript
await limiter.checkLimit('partner', '/api/search', 'unlimited', 'US');
// Returns immediately: 0 Redis calls, 0ms processing
```

### 3. Request Cost (Multi-token Consumption)

Different operations consume different token amounts.

```javascript
// Standard search (cost=1)
await limiter.checkLimit(userId, '/api/search', 'free', 'US', 1);

// Expensive checkout (cost=5)
await limiter.checkLimit(userId, '/api/checkout', 'free', 'US', 5);
```

### Test Coverage

```bash
node testOptimizationChallenge.js
```
