export class InvalidIdempotencyKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidIdempotencyKeyError";
  }
}

export function validateIdempotencyKey(
  value: string | undefined,
): string {
  if (typeof value !== "string") {
    throw new InvalidIdempotencyKeyError(
      "Idempotency-Key header is required",
    );
  }

  if (value.trim().length === 0) {
    throw new InvalidIdempotencyKeyError(
      "Idempotency-Key header cannot be empty",
    );
  }

  if (value.length > 255) {
    throw new InvalidIdempotencyKeyError(
      "Idempotency-Key header exceeds 255 characters",
    );
  }

  return value;
}