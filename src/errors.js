// An error with an HTTP status that is safe to show to the client.
// The error handler sends `message` (and `details`) for 4xx statuses only.
class AppError extends Error {
  constructor(message, status = 400, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    if (details) this.details = details;
  }
}

module.exports = { AppError };
