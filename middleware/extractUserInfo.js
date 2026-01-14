/**
 * Middleware: Extract user info from headers
 * Extracts x-user-id, x-user-tier, x-region, x-cost headers
 * and attaches them to req object for downstream middleware/routes
 */
const extractUserInfo = (req, res, next) => {
  req.userId = req.headers['x-user-id'] || 'anonymous';
  req.userTier = req.headers['x-user-tier'] || 'free';
  req.region = req.headers['x-region'] || 'US';
  req.requestCost = parseInt(req.headers['x-cost'] || '1');
  next();
};

module.exports = extractUserInfo;
