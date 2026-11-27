/** The error every VULCAN package throws: an `Error` with the message and, when there is one, its cause. */
export class VulcanError extends Error {
  /** A new error to throw: `throw VulcanError.of({ message, cause })`. */
  static of(opts: { message: string; cause?: unknown }): VulcanError {
    const { message, cause } = opts;

    const error = new VulcanError(message, cause === undefined ? undefined : { cause });

    // The trace starts where the error is thrown, not in this builder.
    Error.captureStackTrace(error, VulcanError.of);

    return error;
  }
}
