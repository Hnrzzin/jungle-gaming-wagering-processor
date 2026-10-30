# Distributed Wagering Processor

Serviço de processamento financeiro para operações de wagering, construído com Bun, TypeScript, NestJS, PostgreSQL e MikroORM.

> **Status desta entrega: MVP síncrono de BET.** O fluxo de carteira + BET está implementado e validado por testes unitários, integração PostgreSQL e testes HTTP com três processos independentes. Este repositório ainda não implementa o pipeline assíncrono completo exigido pelo desafio (SQS, Inbox/Outbox, retries/DLQ, recovery e os demais tipos de transação). Consulte [ARCHITECTURE.md](./ARCHITECTURE.md) para decisões, evidências e limitações.

## Requisitos

- Bun 1.x (desenvolvido e testado com Bun 1.4.4)
- Docker e Docker Compose
- PostgreSQL 16

## Configuração local

1. Instale as dependências:

~~~powershell
bun install
~~~

2. Crie o arquivo local de ambiente e substitua os dois tokens de exemplo por segredos aleatórios:

~~~powershell
Copy-Item .env.example .env
notepad .env
~~~

3. Inicie os serviços locais:

~~~powershell
docker compose up -d
docker compose ps
docker compose exec -T postgres pg_isready
~~~

O Compose sobe PostgreSQL e MiniStack. **A integração SQS ainda não está implementada**; o container MiniStack está disponível para a próxima etapa, mas nenhuma fila é criada ou consumida pela aplicação atual.

4. Aplique as migrations:

~~~powershell
bun run db:migrate
~~~

5. Inicie a API:

~~~powershell
$env:PORT = "3001" # use 3000 se estiver livre
bun run dev
~~~

A API fica disponível em http://localhost:3001/api. O processo deve permanecer ativo enquanto os testes HTTP são executados.

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| POSTGRES_HOST | Host do PostgreSQL; localhost para execução no host |
| POSTGRES_PORT | Porta PostgreSQL (5432 por padrão) |
| POSTGRES_USER | Usuário do banco |
| POSTGRES_PASSWORD | Senha do banco |
| DB_NAME | Nome do banco |
| PORT | Porta HTTP (3000 por padrão) |
| HOST | Interface de bind (0.0.0.0 por padrão) |
| WAGER_API_TOKEN | Segredo compartilhado exigido no endpoint BET |
| WALLET_PROVISIONING_TOKEN | Segredo compartilhado exigido no provisionamento de carteira |

Não versione o arquivo .env nem compartilhe os tokens. Os valores em .env.example são placeholders e precisam ser substituídos.

## Endpoints implementados

Todas as rotas são prefixadas por /api.

| Método | Rota | Descrição |
|---|---|---|
| GET | /health | Health geral; executa os checks configurados |
| GET | /health/live | Liveness do processo |
| GET | /health/ready | Readiness: conexão PostgreSQL, schema e índices requeridos |
| POST | /wallets | Cria uma carteira com saldo inicial e lançamento OPENING quando positivo |
| POST | /wagers/bets | Processa BET de forma síncrona |

Os endpoints de health não exigem token. Nesta versão, readiness verifica PostgreSQL e estrutura essencial do banco; não verifica SQS.

### Criar carteira

Header obrigatório: X-Wallet-Provisioning-Token.

~~~http
POST /api/wallets
Content-Type: application/json
X-Wallet-Provisioning-Token: <WALLET_PROVISIONING_TOKEN>

{
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "initialBalance": "100.00",
  "currency": "BRL"
}
~~~

O playerId deve ser UUID. A resposta contém walletId, playerId, currency, balance, version e createdAt. A criação da carteira e, quando o saldo inicial é positivo, a transação interna OPENING e o crédito no ledger são gravados na mesma transação SQL. Saldo inicial zero cria somente a carteira.

### Processar BET

Headers obrigatórios: Authorization: Bearer e Idempotency-Key.

~~~http
POST /api/wagers/bets
Content-Type: application/json
Authorization: Bearer <WAGER_API_TOKEN>
Idempotency-Key: provider-a:bet-123

{
  "providerId": "provider-a",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
  "externalTransactionId": "bet-123",
  "amount": "10.00",
  "currency": "BRL",
  "roundId": "round-987",
  "gameId": "fortune-chimp"
}
~~~

amount é uma string decimal com duas casas; valores JSON numéricos não são aceitos. roundId e gameId são opcionais nesta implementação, mas, quando enviados, participam do hash do payload e são persistidos.

Resposta de uma BET processada:

~~~json
{
  "outcome": "PROCESSED",
  "replayed": false,
  "transaction": {
    "id": "<transaction-id>",
    "providerId": "provider-a",
    "type": "BET",
    "status": "PROCESSED",
    "amount": "10.00",
    "currency": "BRL",
    "failureCode": null
  }
}
~~~

Comportamento idempotente observado:

- mesmo provider, Idempotency-Key, externalTransactionId e payload: retorna a transação original como DUPLICATE, sem novo débito;
- reutilização do identificador com payload diferente: HTTP 409, code IDEMPOTENCY_CONFLICT;
- saldo insuficiente: HTTP 422, code INSUFFICIENT_FUNDS; a rejeição é persistida, sem alteração de saldo ou lançamento no ledger;
- replay de uma rejeição idêntica: retorna a rejeição original como DUPLICATE.

## Persistência e invariantes implementadas

- Valores monetários no domínio são representados por Decimal.js e serializados como strings decimais; o PostgreSQL usa NUMERIC.
- Carteira, transação de wagering e ledger são persistidos no PostgreSQL.
- Criação da carteira, OPENING e crédito inicial são atômicos.
- BET aprovada, atualização do saldo, versão e débito no ledger são atômicos.
- O saldo materializado não pode ficar negativo por constraint do banco.
- O ledger possui constraints de valor positivo, direção e aritmética; há trigger que bloqueia UPDATE e DELETE.
- Índices únicos persistentes protegem (provider_id, idempotency_key), (provider_id, external_transaction_id) e (wallet_id, transaction_id).
- A concorrência de identidade usa advisory transaction locks PostgreSQL; o processamento bloqueia a linha da carteira com SELECT FOR UPDATE.

## Testes e comandos

~~~powershell
bun test
bun check
bun test test/integration/process-wager.concurrency.test.ts
~~~

A suíte de integração usa PostgreSQL real quando POSTGRES_USER e DB_NAME estão configurados no ambiente. Para um teste HTTP manual, mantenha a API ativa e use uma segunda janela PowerShell para chamar os endpoints.

### Evidências registradas nesta branch

Execução local informada em 30/10/2026:

- bun test: 234 pass, 0 fail, 462 expect calls, 28 arquivos;
- bun check: sem erros de tipo em 87 arquivos;
- teste de concorrência PostgreSQL: 6 pass, 0 fail;
- smoke test HTTP: readiness OK, criação de carteira, BET aprovada, replay DUPLICATE;
- auditoria PostgreSQL do smoke test: saldo 100.00 → 90.00, OPENING e BET persistidas, um crédito e um débito no ledger;
- testes HTTP de rejeição: saldo insuficiente HTTP 422, replay da rejeição, conflito HTTP 409;
- teste com três processos independentes nas portas 3001, 3002 e 3003: 30 requisições simultâneas, 1 PROCESSED, 29 DUPLICATE, 0 erros; PostgreSQL confirmou uma única BET e um único débito.

Esses resultados comprovam o fluxo síncrono de BET desta versão. Não representam validação de funcionalidades assíncronas ainda ausentes.

## Limitações conhecidas / fora do escopo desta versão

- O caso de uso de processamento e o endpoint HTTP executam somente BET.
- WIN, LOSS, REFUND e ROLLBACK ainda não são processados pelo caso de uso.
- Não há endpoint genérico POST /wagering/transactions nem endpoints de consulta de wallet, ledger ou transações.
- SQS ainda não é integrado; não há filas, consumidor, Inbox, Outbox ou publisher.
- Não há retry/backoff, DLQ, reprocessamento de referências fora de ordem ou recuperação de mensagens após crash.
- Não há endpoint/job de reconciliação.
- Não há métricas de negócio, tracing ou logging estruturado completo conforme a especificação.
- A autenticação externa via Identity Provider não foi implementada. Os tokens compartilhados atuais são uma proteção simples para execução local/demonstração, não substituem OIDC nem autenticação de produção.
- O readiness não testa SQS, pois a aplicação ainda não o utiliza.
- O teste distribuído comprovou três processos da API na mesma máquina, compartilhando PostgreSQL; não foi um teste em três hosts ou containers isolados.

Para as decisões, trade-offs, matriz de aderência e próximos passos, consulte [ARCHITECTURE.md](./ARCHITECTURE.md).
