// 404 for unknown API routes and a final error handler that logs the real
// error server-side but only sends a safe, structured JSON message to clients.
function notFound(req, res) {
  res.status(404).json({ success: false, error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Malformed JSON bodies from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Request body is not valid JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'Request body is too large' });
  }
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error('[error]', err);
  }
  const body = { success: false, error: status >= 500 ? 'Internal server error' : err.message };
  if (status < 500 && err.details) body.details = err.details;
  return res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
