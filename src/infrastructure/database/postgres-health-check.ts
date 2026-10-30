import type { HealthCheck } from "../../presentation/http/health.controller";

export interface PostgreSQLHealthQuery {
  query(sql: string): Promise<unknown>;
}

export class PostgreSQLHealthCheck implements HealthCheck {
  readonly name = "postgresql";

  constructor(private readonly database: PostgreSQLHealthQuery) {}

  async check(): Promise<void> {
    await this.database.query("SELECT 1");
  }
}