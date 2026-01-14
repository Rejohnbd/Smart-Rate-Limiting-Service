const RATE_LIMITS = {
  free: {
    '/api/search': { window: 3600, max: 100, burst: 20 },
    '/api/checkout': { window: 3600, max: 10, burst: 2 },
    '/api/profile': { window: 3600, max: 50, burst: 10 },
  },
  premium: {
    '/api/search': { window: 3600, max: 1000, burst: 100 },
    '/api/checkout': { window: 3600, max: 100, burst: 20 },
    '/api/profile': { window: 3600, max: 200, burst: 40 },
  },
  enterprise: {
    '/api/search': { window: 3600, max: 10000, burst: 1000 },
    '/api/checkout': { window: 3600, max: 1000, burst: 200 },
    '/api/profile': { window: 3600, max: 1000, burst: 200 },
  },
};

const GEO_LIMITS = {
  US: { multiplier: 1.0 },
  EU: { multiplier: 1.0 },
  CN: { multiplier: 0.5 }, // Stricter limits
  IN: { multiplier: 2.0 }, // Higher limits
  DEFAULT: { multiplier: 1.0 },
};

module.exports = { RATE_LIMITS, GEO_LIMITS };
