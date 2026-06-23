/** Application error carrying an HTTP status + machine-readable code. */
export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(msg: string, details?: unknown) {
    return new HttpError(400, msg, 'bad_request', details);
  }
  static unauthorized(msg = 'Authentication required') {
    return new HttpError(401, msg, 'unauthorized');
  }
  static forbidden(msg = 'Permission denied') {
    return new HttpError(403, msg, 'forbidden');
  }
  static notFound(msg = 'Not found') {
    return new HttpError(404, msg, 'not_found');
  }
  static conflict(msg: string) {
    return new HttpError(409, msg, 'conflict');
  }
}
