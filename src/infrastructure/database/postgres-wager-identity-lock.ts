export interface PostgreSQLQueryExecutor {
  execute(
    query: string,
    parameters: readonly unknown[],
  ): Promise<unknown>;
}

export interface WagerIdentityLockInput {
  readonly providerId: string;
  readonly idempotencyKey: string;
  readonly externalTransactionId: string;
}

export class PostgreSQLWagerIdentityLock {
  constructor(private readonly executor: PostgreSQLQueryExecutor) {}

  async acquire(input: WagerIdentityLockInput): Promise<void> {
    const lockKeys = [
      this.createLockKey(
        input.providerId,
        "idempotency",
        input.idempotencyKey,
      ),
      this.createLockKey(
        input.providerId,
        "external",
        input.externalTransactionId,
      ),
    ].sort();

    for (const key of lockKeys) {
      await this.executor.execute(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [key],
      );
    }
  }

  private createLockKey(
    providerId: string,
    namespace: string,
    value: string,
  ): string {
    return [
      providerId.length,
      providerId,
      namespace.length,
      namespace,
      value.length,
      value,
    ].join(":");
  }
}