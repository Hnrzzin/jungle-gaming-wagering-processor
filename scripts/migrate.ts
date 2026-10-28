import { MikroORM } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";

const direction = process.argv[2];

const orm = await MikroORM.init({
    
  dbName: process.env.DB_NAME,
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  entities: [],
  discovery: { warnWhenNoEntities: false },
  extensions: [Migrator],
  migrations: { path: "./migrations", pathTs: "./migrations" },
  
});


if (direction === "up") await orm.migrator.up();
else if (direction === "down") await orm.migrator.down();
else throw new Error("Use: bun run scripts/migrate.ts up|down");

await orm.close(true);
