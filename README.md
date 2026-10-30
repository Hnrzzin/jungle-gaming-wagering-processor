# Distributed Wagering Processor

## Requisitos

- Bun 1.4+
- Docker e Docker Compose
- PostgreSQL 16

## Configuração local

```bash
bun install
cp .env.example .env
docker compose up -d postgres
bun run db:migrate
bun run dev
```

A API fica disponível em `http://localhost:3000/api`.

## Variáveis de ambiente

| Variável | Padrão/descrição |
|---|---|
| `POSTGRES_HOST` | `localhost` no host; `postgres` dentro do Compose |
| `POSTGRES_PORT` | `5432` |
| `POSTGRES_USER` | usuário do PostgreSQL |
| `POSTGRES_PASSWORD` | senha do PostgreSQL |
| `DB_NAME` | nome do banco |
| `PORT` | `3000` |
| `HOST` | `0.0.0.0` |

## Endpoints

- `GET /api/health/live`: liveness.
- `GET /api/health/ready`: readiness, incluindo conexão PostgreSQL.
- `POST /api/wallets`: provisionamento de carteira com saldo inicial e lançamento de abertura.
- `POST /api/wagers/bets`: processamento síncrono de BET.

### Exemplo de BET

O header `Idempotency-Key` é obrigatório.

```http
POST /api/wagers/bets
Content-Type: application/json
Idempotency-Key: bet-000001

{
  "providerId": "provider-1",
  "playerId": "UUID-DO-JOGADOR",
  "walletId": "UUID-DA-CARTEIRA",
  "externalTransactionId": "external-bet-000001",
  "amount": "10.00",
  "currency": "BRL"
}
```

### Criar carteira\n\n`playerId` deve ser um UUID, pois a coluna persistida usa esse tipo.\n\n```http\nPOST /api/wallets\nContent-Type: application/json\n\n{\n  "playerId": "UUID-DO-JOGADOR",\n  "initialBalance": "100.00",\n  "currency": "BRL"\n}\n```\n\nA criação grava carteira, transação de abertura e crédito inicial no ledger na mesma transação. Use o `walletId` retornado na requisição de BET.

## Comandos

```bash
bun run dev          # servidor com reload
bun run start        # servidor
bun run db:migrate   # aplica migrations pendentes
bun test             # suíte de testes
bun check            # verificação de tipos, conforme configuração Bun do projeto
```

## Estado funcional e limites atuais

O fluxo HTTP síncrono de BET implementa idempotência persistente por provider, detecção de conflito, validação de carteira/jogador/moeda, débito transacional, lock da carteira e ledger. A migration de compatibilidade preserva o contrato existente (`wagering_transactions.kind`), adiciona `currency` ao ledger com preenchimento automático a partir da carteira para manter compatibilidade com o repositório legado e define defaults de timestamp usados pelo processador.

Ainda não declarar como implementados: processamento de WIN/LOSS/REFUND/ROLLBACK, SQS, Inbox/Outbox, retries/DLQ, reconciliação e recuperação de mensagens após crash. O resultado de testes locais precisa ser executado novamente após estas alterações antes de considerar esta branch pronta para deploy.
