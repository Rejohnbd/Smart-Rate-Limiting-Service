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
}

module.exports = MockRedis;
