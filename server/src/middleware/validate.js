import { ApiError } from '../utils/ApiError.js';

/**
 * Validates req[source] against a zod schema and replaces it with the parsed
 * (trimmed, coerced, defaulted) value. Failures become a 422 listing each bad field.
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message,
      }));
      return next(ApiError.validation(details));
    }
    // Express 4 allows reassigning req.query; keep validated values in one place either way.
    req.valid = { ...req.valid, [source]: result.data };
    next();
  };
}
