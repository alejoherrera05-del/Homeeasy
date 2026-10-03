'use strict';

class SyncError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || 'PENTAGRAMA_SYNC_ERROR';
    this.statusCode = Number(options.statusCode || 502);
    if (options.details !== undefined) this.details = options.details;
  }
}

class ConfigurationError extends SyncError {
  constructor(message) {
    super(message, { code: 'PENTAGRAMA_SYNC_NOT_CONFIGURED', statusCode: 503 });
  }
}

class SessionExpiredError extends SyncError {
  constructor(message = 'Pentagrama session expired') {
    super(message, { code: 'PENTAGRAMA_SESSION_EXPIRED', statusCode: 401 });
  }
}

class UpstreamResponseError extends SyncError {
  constructor(message, details) {
    super(message, { code: 'PENTAGRAMA_UNEXPECTED_RESPONSE', statusCode: 502, details });
  }
}

module.exports = Object.freeze({
  SyncError,
  ConfigurationError,
  SessionExpiredError,
  UpstreamResponseError
});
