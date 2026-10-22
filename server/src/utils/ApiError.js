/**
 * An error that maps cleanly to an HTTP response.
 * Every error response has the shape: { error: { code, message, details? } }
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static validation(details) {
    return new ApiError(422, 'VALIDATION_ERROR', 'The request contains invalid fields.', details);
  }

  static unauthorized(message = 'Authentication required.') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'You do not have access to this resource.') {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(resource = 'Resource') {
    return new ApiError(404, 'NOT_FOUND', `${resource} not found.`);
  }

  static conflict(message) {
    return new ApiError(409, 'CONFLICT', message);
  }
}
