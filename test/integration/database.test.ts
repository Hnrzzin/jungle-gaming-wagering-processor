import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createOrm } from "../../../src/domain/database/orm";

describe("conexão com o PostgreSQL", () => {
  let orm: Awaited<ReturnType<typeof createOrm>>;

  beforeAll(async () => {
    orm = await createOrm();
  });

  afterAll(async () => {
    await orm.close();
  });

  it("executa SELECT 1 pelo ORM e recebe o valor 1", async () => {
    const connection = orm.em.getConnection();
    const rows = await connection.execute("select 1 as value");

    expect(rows[0]?.value).toBe(1);
  });
});