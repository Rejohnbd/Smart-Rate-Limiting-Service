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

#### Tier-Based Configuration

```javascript
{
  free:       { /api/search: 100 req/hr, 20 burst },
  premium:    { /api/search: 1000 req/hr, 100 burst },
  enterprise: { /api/search: 10000 req/hr, 1000 burst }
}
```

#### Geographic Multipliers

- **US/EU**: 1.0x (baseline)
- **CN**: 0.5x (stricter limits for compliance)
- **IN**: 2.0x (higher limits)

### State Management

- **Redis Keys**:
  - `rate:tokens:{userId}:{endpoint}` - Available tokens
  - `rate:last_refill:{userId}:{endpoint}` - Last refill timestamp
  - `rate:count:{userId}:{endpoint}` - Request count in window
- **TTL**: All keys expire after the time window

Run tests:

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
