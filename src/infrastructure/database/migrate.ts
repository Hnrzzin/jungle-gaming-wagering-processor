import { createOrm } from "./orm";

async function migrate(): Promise<void> {
  const orm = await createOrm();

  try {
    const migrations = await orm.getMigrator().up();
    console.info(
      migrations.length === 0
        ? "Database schema is already up to date."
        : `Applied ${migrations.length} migration(s).`,
    );
  } finally {
    await orm.close();
  }
}

void migrate().catch((error: unknown) => {
  console.error("Database migration failed", error);
  process.exitCode = 1;
});
