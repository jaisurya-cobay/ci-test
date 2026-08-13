export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError'; // otherwise stacks and logs read as a bare "Error"
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (message = 'Resource not found') =>
  new ApiError(404, 'not_found', message);

export const badRequest = (message, details) =>
  new ApiError(400, 'bad_request', message, details);
