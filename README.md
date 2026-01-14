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
