class MockRedis {
  constructor(failures = {}) {
    this.data = new Map();
    this.failures = failures;
    this.callCount = 0;
  }

  async get(key) {
    this.callCount++;
    if (this.failures.get && Math.random() < 0.1) {
      throw new Error('Redis connection failed');
    }
    // Simulate network delay
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    return this.data.get(key);
  }

  async set(key, value) {
    this.callCount++;
    if (this.failures.set && Math.random() < 0.1) {
      throw new Error('Redis connection failed');
    }
    // Simulate network delay
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    this.data.set(key, value);
  }

  async setex(key, ttl, value) {
    this.callCount++;
    if (this.failures.set && Math.random() < 0.1) {
      throw new Error('Redis connection failed');
    }
    // Simulate network delay
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    this.data.set(key, value);
  }

  async incr(key) {
    this.callCount++;
    if (this.failures.incr && Math.random() < 0.1) {
      throw new Error('Redis connection failed');
    }
    // Simulate network delay
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    // Race condition simulation
    const current = this.data.get(key) || 0;
    this.data.set(key, current + 1);
    return current + 1;
  }

  // Lua script execution for atomic operations
  async eval(script, numKeys, ...args) {
    this.callCount++;
    if (this.failures.eval && Math.random() < 0.1) {
      throw new Error('Redis connection failed');
    }
    // Simulate network delay
    await new Promise((r) => setTimeout(r, Math.random() * 5));

    // Extract keys and argv
    const keys = args.slice(0, numKeys);
    const argv = args.slice(numKeys);

    // Simple Lua script interpreter for rate limiting
    // Check if this is a rate limiting script by looking for tokens/count operations
    if (
      script.includes('adjustedBurst') ||
      script.includes('tokenKey') ||
      (numKeys === 3 && argv.length === 4)
    ) {
      return this.executeRateLimitScript(keys, argv);
    }

    return null;
  }

  // Atomic rate limiting script (simulates Lua)
  executeRateLimitScript(keys, argv) {
    const [tokenKey, lastRefillKey, countKey] = keys;
    const [now, adjustedMax, adjustedBurst, window] = argv.map(
      (v) => parseFloat(v) || parseInt(v)
    );

    // Get current values
    let tokens = parseFloat(this.data.get(tokenKey)) || adjustedBurst;
    let lastRefill = parseInt(this.data.get(lastRefillKey)) || now;
    let count = parseInt(this.data.get(countKey)) || 0;

    // Refill tokens
    const timePassed = now - lastRefill;
    const refillAmount = (timePassed * adjustedMax) / window;
    tokens = Math.min(adjustedBurst, tokens + refillAmount);

    // Check if allowed
    const allowed = tokens >= 1 && count < adjustedMax;

    if (allowed) {
      tokens -= 1;
      count += 1;
    }

    // Atomically update state
    this.data.set(tokenKey, tokens.toString());
    this.data.set(lastRefillKey, now.toString());
    this.data.set(countKey, count.toString());

    return [allowed ? 1 : 0, Math.max(0, Math.floor(tokens)), count];
  }
}

module.exports = MockRedis;
