// Wraps async route handlers so rejected promises reach the error middleware
// instead of becoming unhandled rejections.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncHandler };
