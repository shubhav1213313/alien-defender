// 404 for unknown API routes and a final error handler that logs the real
// error server-side but only sends a safe, structured JSON message to clients.
function notFound(req, res) {
  res.status(404).json({ success: false, error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error('[error]', err);
  }
  res.status(status).json({
    success: false,
    error: status >= 500 ? 'Internal server error' : err.message,
  });
}

module.exports = { notFound, errorHandler };
