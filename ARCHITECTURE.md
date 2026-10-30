# Arquitetura — Distributed Wagering Processor

## 1. Estado da entrega e escopo

Esta branch entrega um **MVP síncrono de BET**, com persistência PostgreSQL, idempotência persistente, ledger e concorrência entre processos independentes da API.

O fluxo HTTP e os invariantes do caminho BET foram executados contra PostgreSQL real e validados por testes unitários, testes de integração e smoke tests HTTP. Isso não equivale à conclusão do desafio completo: o pipeline assíncrono SQS/Inbox/Outbox e os tipos WIN, LOSS, REFUND e ROLLBACK ainda não estão implementados no caso de uso de processamento.

A documentação usa três categorias:

- **Implementado e testado:** comportamento comprovado pelos testes e execuções registrados.
- **Modelado parcialmente:** tipos ou regras presentes no domínio, mas ainda não ligados ao fluxo de processamento.
- **Pendente:** não existe implementação executável nesta branch.

## 2. Stack e organização

- Runtime, package manager e test runner: Bun 1.4.4.
- Linguagem: TypeScript com checagem estrita.
- HTTP: NestJS.
- Banco: PostgreSQL 16.
- ORM / acesso transacional: MikroORM 7, com SQL parametrizado.
- Dinheiro: Decimal.js.
- Ambiente local: Docker Compose; inclui PostgreSQL e MiniStack.

Os limites principais seguem uma separação pragmática:

1. **Presentation:** controllers HTTP e filtro de erros NestJS.
2. **Application:** casos de uso, validação de request, hash canônico, aritmética e portas.
3. **Domain:** Money, Wallet, WagerTransaction, WalletLedgerEntry e erros de domínio.
4. **Infrastructure:** MikroORM, repositórios, transaction provider, SQL PostgreSQL, locks e validadores de schema/índices.

O caso de uso ProcessWager depende de uma abstração de transaction manager/unit of work. A implementação PostgreSQL coordena SQL e transação; o controller não executa diretamente a movimentação financeira.

## 3. Dinheiro e precisão

Money mantém o valor como Decimal.js privado e expõe operações imutáveis. Os valores entram nos contratos HTTP como strings decimais; a entrada rejeita representação numérica JSON, notação científica e formato decimal inválido. toString/toJSON mantêm duas casas decimais.

O PostgreSQL persiste valores em colunas NUMERIC, evitando float/double. A moeda é armazenada separadamente e validada no domínio antes das operações. O modelo admite códigos de moeda de três letras; os testes de fluxo demonstrados usam BRL.

Trade-off: o formato aceito na API atual é deliberadamente plano (amount e currency em campos separados), diferente do objeto MoneyProps { amount, currency } sugerido no contrato do desafio. A adaptação do contrato público permanece pendente.

## 4. Modelo e invariantes persistidos

### 4.1 Wallet

Wallet é o agregado que representa saldo materializado, moeda e versão.

- open inicia version em 1.
- debit/credit criam WalletLedgerEntry balanceado e atualizam estado em memória do agregado.
- rehydrate reconstrói o estado persistido.
- a tabela wallets possui CHECK para saldo não negativo.
- existe unicidade por player_id + currency.
- o fluxo de BET bloqueia a linha antes de calcular e gravar o novo saldo.

A versão é incrementada em uma operação aprovada que altera o saldo. Rejeições não incrementam versão.

### 4.2 WagerTransaction

O domínio define OPENING, BET, WIN, LOSS, REFUND e ROLLBACK, assim como estados PENDING, PENDING_REFERENCE, PROCESSED, REJECTED e FAILED. Também define exigência de referência para REFUND/ROLLBACK, estados terminais e direção de ledger para os tipos modelados.

**Limite importante:** o use case ProcessWager desta branch aceita e persiste somente BET. O mapper PostgreSQL também rejeita tipos diferentes de BET. As regras de domínio de WIN/LOSS/REFUND/ROLLBACK não significam que esses fluxos estejam implementados.

OPENING é criado pelo fluxo de provisionamento da carteira e não pode ser submetido pelo endpoint BET.

### 4.3 WalletLedgerEntry

O ledger é append-only na implementação PostgreSQL:

- CHECK de valor positivo;
- CHECK de direção DEBIT/CREDIT;
- CHECK aritmético entre balance_before, amount e balance_after;
- unicidade de (wallet_id, transaction_id);
- trigger bloqueia UPDATE e DELETE;
- FKs vinculam lançamento à carteira e à transação.

A criação de carteira com saldo positivo grava OPENING e CREDIT no mesmo commit. BET processada grava a transação, atualiza wallet e grava DEBIT na mesma transação SQL. BET rejeitada é auditada como REJECTED, sem lançamento e sem alteração de saldo.

A unicidade por wallet + transaction garante no máximo um lançamento dessa transação nessa carteira; não substitui a implementação de double-entry, que não é requisito do desafio.

## 5. Estratégia transacional e concorrência

A garantia é do PostgreSQL, não de memória de processo.

### 5.1 Identidade/idempotência

Antes de procurar ou criar uma transação, o use case obtém advisory transaction locks para duas identidades:

- provider + namespace idempotency + Idempotency-Key;
- provider + namespace external + externalTransactionId.

As chaves são normalizadas com comprimentos e valores, ordenadas deterministicamente e adquiridas com pg_advisory_xact_lock(hashtextextended(...)). Isso reduz corrida entre requisições que disputam os mesmos identificadores e evita deadlocks por ordem divergente dos dois locks.

Os índices únicos no banco continuam sendo a última linha de defesa.

### 5.2 Wallet

Depois de bloquear a identidade, o fluxo executa SELECT ... FOR UPDATE na wallet dentro da transação. Assim, operações concorrentes da mesma wallet esperam pela liberação da linha; o saldo usado no cálculo é o estado lido sob lock.

A atualização também condiciona a escrita à versão esperada (id + version). Se não atualizar exatamente uma linha, a operação falha e a transação sofre rollback.

Wallets diferentes usam linhas diferentes; não existe lock global de todas as carteiras.

### 5.3 Atomicidade

Para BET aprovada, a mesma transação PostgreSQL engloba:

1. lock das identidades;
2. classificação de replay/conflito;
3. lock da wallet;
4. validação de ownership, moeda e saldo;
5. insert da transação;
6. update de balance e version;
7. insert do ledger.

Se qualquer etapa falhar, a transação é revertida. Para saldo insuficiente, a transação REJECTED é persistida sem update da wallet e sem ledger.

Para provisionamento positivo, wallet, OPENING e crédito do ledger são gravados no mesmo transaction scope.

## 6. Idempotência e hash do payload

A idempotência é persistente no PostgreSQL e escopada pelo provider.

O hash é SHA-256 sobre JSON canônico do subconjunto de negócio que existe no fluxo BET:

- providerId;
- playerId;
- walletId;
- externalTransactionId;
- type (BET);
- amount;
- currency;
- roundId e gameId quando fornecidos.

A serialização canônica ordena recursivamente as chaves de objetos, preserva ordem de arrays e rejeita valores fora do domínio JSON suportado. Header e metadados de transporte não entram no hash.

O par (provider_id, idempotency_key) e o par (provider_id, external_transaction_id) possuem índices únicos. Uma repetição idêntica devolve o resultado já persistido como DUPLICATE/replayed=true; payload diferente nos mesmos identificadores produz conflito HTTP 409. Rejeições de negócio também são persistidas e podem ser reproduzidas como resultado original.

Trade-off: o contrato atual recebe Idempotency-Key livre no header; não aplica automaticamente o default providerId:externalTransactionId sugerido pelo desafio.

## 7. API e autenticação nesta versão

Rotas implementadas sob prefixo /api:

- GET /health
- GET /health/live
- GET /health/ready
- POST /wallets
- POST /wagers/bets

Não estão implementados nesta branch os endpoints de consulta de wallet/ledger/transação, endpoint genérico POST /wagering/transactions ou endpoint de reconciliação.

### Decisão de autenticação

Não foi integrado Identity Provider externo. O código atual usa dois segredos compartilhados:

- Authorization: Bearer para BET;
- X-Wallet-Provisioning-Token para provisionamento.

Essa proteção é suficiente apenas para a demonstração local controlada; não é OIDC, não identifica credenciais individualmente por provider e não fornece autorização por escopo/rotação gerenciada. A autenticação não é pontuada no desafio, então a decisão é priorizar correção financeira e documentar a limitação.

**Extensão futura:** extrair a verificação inline dos controllers para um NestJS AuthGuard e uma porta ProviderIdentityPort. Um adapter OIDC/Identity Provider (por exemplo Keycloak ou Zitadel) validaria issuer, audience, assinatura e claims, e o guard forneceria providerId verificado ao caso de uso. Essa porta/guard ainda não está criada nesta branch; é um gap conhecido em relação à orientação de manter o ponto de extensão explícito no código.

### Health

- liveness apenas confirma que o processo responde.
- readiness executa SELECT 1 e verifica tabelas, colunas e índices essenciais no PostgreSQL.
- readiness não verifica SQS, porque a integração SQS ainda não existe.

O filtro HTTP mapeia falhas de domínio/negócio para respostas tipadas. Exemplos observados: insuficiência de saldo em HTTP 422 e conflito de idempotência em HTTP 409.

## 8. Mensageria e garantias ainda não entregues

O Docker Compose inclui um container MiniStack, mas a aplicação não publica nem consome mensagens SQS nesta versão.

Ainda não existem:

- filas wager-transactions.fifo e DLQ;
- consumidor com ack após commit;
- Inbox persistente e deduplicação por consumerName/messageId;
- Outbox transacional e publisher concorrente;
- retries/backoff, limite de tentativas ou DLQ;
- reprocessamento de PENDING_REFERENCE;
- recuperação de worker após crash ou tratamento de SIGTERM de mensagens;
- eventos WagerTransactionProcessed, WagerTransactionRejected, WalletBalanceChanged e WagerTransactionPendingReference.

Consequência: a garantia demonstrada é de consistência do caminho HTTP síncrono. A garantia de não perder eventos confirmados após commit ainda não existe, pois o caminho de eventos não foi implementado. Não se deve descrever MiniStack como integração SQS concluída.

## 9. Observabilidade e reconciliação

O código possui logs de bootstrap e tratamento de exceções HTTP, mas não entrega o conjunto obrigatório de logs JSON correlacionados e métricas de negócio (status, duplicatas, retries, DLQ, conflitos de lock, outbox lag e latência).

A reconciliação wallet.balance contra o ledger não possui endpoint nem job nesta branch. Os testes de integração verificam aritmética, constraints, imutabilidade e estados de saldo para cenários específicos; isso não é substituto de uma rotina operacional de reconciliação.

## 10. Testes e evidências executadas

Resultados informados pelo executor local em 30/10/2026:

| Verificação | Resultado |
|---|---|
| bun test | 234 pass, 0 fail, 462 expect calls, 28 arquivos |
| bun check | Sem erros de tipo em 87 arquivos |
| process-wager.concurrency.test.ts | 6 pass, 0 fail, 32 assertions |
| Health readiness | Ready nas três instâncias |
| Smoke HTTP carteira + BET + replay | Aprovado |
| Saldo/ledger no PostgreSQL | 100.00 inicial, 90.00 final; CREDIT e DEBIT correspondentes |
| Saldo insuficiente | HTTP 422; saldo e ledger inalterados |
| Replay da rejeição | DUPLICATE/replayed=true |
| Payload divergente | HTTP 409 IDEMPOTENCY_CONFLICT |
| Três processos HTTP independentes | 30 requests: 1 PROCESSED, 29 DUPLICATE, 0 erros |

No teste de três processos, três instâncias locais foram iniciadas nas portas 3001, 3002 e 3003 e conectadas ao mesmo PostgreSQL. O banco confirmou uma transação BET, saldo final 90.00 e um único débito. São processos independentes na mesma máquina, não três hosts ou containers separados.

Os resultados acima foram executados manualmente/localmente e reportados no histórico de desenvolvimento; não são uma alegação de execução por CI.

## 11. Matriz de aderência e trabalho restante

| Área do desafio | Estado nesta branch |
|---|---|
| Money decimal sem number para cálculo monetário | Implementado |
| Wallet e versionamento | Implementado para criação e BET |
| Ledger auditável e append-only | Implementado e testado |
| Constraints e índices financeiros no schema | Implementados |
| Idempotência persistente | Implementada para BET |
| Concorrência entre instâncias | Validada para BET via PostgreSQL |
| WIN / LOSS | Modelados parcialmente no domínio; processamento pendente |
| REFUND / ROLLBACK | Regras de domínio parciais; resolução/reversão financeira pendente |
| API de consulta e API genérica | Pendente |
| Inbox / Outbox | Pendente |
| SQS consumer / publisher | Pendente |
| Retry / DLQ / crash recovery | Pendente |
| Referências fora de ordem | Estado de domínio modelado; worker pendente |
| Reconciliação | Pendente |
| OIDC / ProviderIdentityPort explícita | Pendente |
| Logs estruturados e métricas exigidas | Pendente |
| ARCHITECTURE.md e documentação de setup | Documentados neste arquivo e README |

## 12. Próxima sequência recomendada

1. Introduzir um contrato de comando comum para BET/WIN/LOSS/REFUND/ROLLBACK e completar os casos de uso e constraints de referência.
2. Implementar Outbox na mesma transação financeira; criar publisher que reivindica eventos com lock apropriado e backoff.
3. Implementar filas SQS e consumidor com Inbox, ack após commit, classificação de erro, retries e DLQ.
4. Implementar reprocessamento de referências fora de ordem e cenários crash-before-ack / commit-before-publish.
5. Implementar reconciliação e observabilidade mínima exigida.
6. Extrair autenticação para guard/port e registrar o desenho OIDC, sem criar autenticação artesanal de usuários.
7. Executar os testes obrigatórios de integração e concorrência com PostgreSQL e MiniStack reais, incluindo workers/publishers concorrentes e reinício.

## 13. Decisões e trade-offs resumidos

- PostgreSQL é a autoridade de consistência; não há dependência de memória de processo para idempotência ou lock.
- Advisory locks protegem as identidades de operação; row lock protege o saldo específico da wallet.
- Constraints únicas e de integridade permanecem no schema mesmo com as verificações da aplicação.
- O fluxo síncrono entrega o resultado HTTP imediatamente, simplificando o MVP; em contrapartida, ainda não atende ao modelo assíncrono e à garantia de eventos do desafio.
- O escopo foi limitado intencionalmente para validar primeiro dinheiro, concorrência e idempotência antes de introduzir mensageria.
