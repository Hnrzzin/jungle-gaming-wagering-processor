import { defineConfig, MikroORM } from '@mikro-orm/postgresql';


const port = Number(process.env.POSTGRES_PORT ?? 5432);
const user = process.env.POSTGRES_USER;
const password = process.env.POSTGRES_PASSWORD;
const host = process.env.POSTGRES_HOST;
const dbName = process.env.DB_NAME;

if (!user || !password || !host || !dbName) {
  throw new Error('Configure POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST e DB_NAME no .env');
}


export async function createOrm(): Promise<MikroORM> {
    const config = defineConfig({
        dbName,
        user,
        password,
        host,
        port,
        discovery: { warnWhenNoEntities: false },
        migrations: {
          path: "./migrations",
          pathTs: "./migrations",
          glob: "!(*.d).{js,ts}",
        },
        //entities: ['./dist/entities/**/*.js'],
        //entitiesTs: ['./src/entities/**/*.ts'],
    });
    // Inicializa o ORM carregando as configurações
  const orm = await MikroORM.init(config).catch((error) => {
  console.error("ERRO REAL DO BANCO:", error);
  throw error;
});
  // Para gerenciar o banco de dados, você usará o EntityManager (em)
  const em = orm.em;
  if (!em) {
    closeOrm(orm); // Fecha a conexão se não conseguir conectar
    throw new Error('Falha ao obter o EntityManager do ORM');
  }
  return orm;
}

async function closeOrm(orm: MikroORM) {
  await orm.close();
}



