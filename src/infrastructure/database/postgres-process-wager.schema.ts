import type {
  ProcessWagerDatabaseSchema,
} from "./postgres-process-wager";

export const POSTGRES_PROCESS_WAGER_SCHEMA: ProcessWagerDatabaseSchema = {
  tables: {
    wallets: "wallets",
    wagerTransactions: "wagering_transactions",
    ledgerEntries: "wallet_ledger_entries",
  },
  wallet: {
    id: "id",
    playerId: "player_id",
    currency: "currency",
    balance: "balance",
    version: "version",
  },
  wagerTransaction: {
    id: "id",
    providerId: "provider_id",
    playerId: "player_id",
    walletId: "wallet_id",
    externalTransactionId: "external_transaction_id",
    idempotencyKey: "idempotency_key",
    payloadHash: "payload_hash",
    roundId: "round_id",
    gameId: "game_id",
    type: "kind",
    status: "status",
    amount: "amount",
    currency: "currency",
    failureCode: "failure_code",
  },
  ledgerEntry: {
    id: "id",
    walletId: "wallet_id",
    transactionId: "transaction_id",
    direction: "direction",
    amount: "amount",
    currency: "currency",
    balanceBefore: "balance_before",
    balanceAfter: "balance_after",
  },
};