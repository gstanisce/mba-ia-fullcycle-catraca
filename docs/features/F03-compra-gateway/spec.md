# F03 — Compra e gateway · Spec

PRD: `docs/PRD.md` §F03. Critérios: F03-AC1..AC9, X02, X03, X04. Wave 3. Consome F01 (sessão/guardas) e F02
(tabelas, `seats`, `getOnSaleEvent`, slot de compra).

## Decisões técnicas

### Serviço de compra — `src/features/purchases/service.ts` (único caminho de criação de ingresso; F04 reusa)
```ts
type PurchaseInput = { eventId: string; buyerEmail: unknown; cardNumber: unknown; userId: string | null; channel: 'web' | 'api' };
type PurchaseResult =
  | { ok: true; ticket: TicketRow }
  | { ok: false; error: 'invalid_request' | 'event_not_available' | 'sold_out' };
export async function purchaseTicket(input: PurchaseInput): Promise<PurchaseResult>
```
Ordem (igual ao contrato da API):
1. **invalid_request** — `buyerEmail` string e-mail válido (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`); `cardNumber` string `/^\d{16}$/`.
   Nada é gravado.
2. `withTransaction`: `SELECT * FROM events WHERE id = $1 FOR UPDATE` — **a trava da linha do evento serializa todas as
   compras do mesmo evento** (e também edição de lotação de F02 e cancelamento de F06, que travam a mesma linha).
   Inexistente ou `status <> 'published'` → **event_not_available**.
3. `occupiedSeats(client, eventId)` (de F02, **dentro** da transação, depois da trava; em READ COMMITTED cada comando vê
   os commits anteriores) → `computeAvailable(event, occupied) <= 0` → **sold_out**.
4. `INSERT tickets` (`status 'pending'`, `price_cents = event.price_cents` — snapshot R03, `code = newTicketCode()` com
   retry em violação de unicidade usando SAVEPOINT, `card_last4`), e `gateway.requestAuthorization(client, ticket, cardNumber)`
   na mesma transação. COMMIT. Retorna sem esperar o gateway (R06).

Garantia extra de banco (defesa em profundidade, opcional): nenhuma — a trava é a garantia; o teste de carga prova.

### Gateway simulado — `src/features/purchases/gateway.ts`
- `decideSimulated(cardNumber, rng = Math.random)` → `{ approved: boolean; delayMs: number }` pelo final:
  `0001` aprovado 2000–4500 ms; `0002` recusado 2000–4500; `0003` aprovado 30000–38000; `0004` recusado 30000–38000;
  outro → recusado 2000–4500. `delayMs` sorteado uniforme no intervalo e multiplicado por `config.gatewayDelayScale`.
  As faixas ficam dentro das janelas do brief (2–5 s e 30–40 s) mas deixam margem para as verificações ponta a ponta
  (intervalo do poller + latência HTTP/recarga): o avaliador confere "confirmado em até 5 s" e os fluxos de 45 s.
- Migration `030_gateway_requests.sql`:
  `gateway_requests(ticket_id text PK REFERENCES tickets(id), approved boolean NOT NULL, respond_at timestamptz NOT NULL, delivered_at timestamptz)`.
  O "gateway externo" simulado guarda o pedido e sua resposta futura; isso sobrevive a restart do app.
- Entrega assíncrona: `startGatewayPoller(app)` — `setInterval` de 100 ms (registrado em `onReady`, parado em `onClose`):
  em transação, `SELECT … FROM gateway_requests WHERE delivered_at IS NULL AND respond_at <= now() ORDER BY respond_at
  LIMIT 50 FOR UPDATE SKIP LOCKED`; para cada um chama `applyGatewayResult(client, ticketId, approved)` e marca `delivered_at`.
  Evite reentrância (flag `running`).
- `applyGatewayResult(db, ticketId, approved)`:
  `UPDATE tickets SET status = CASE WHEN $2 THEN 'confirmed' ELSE 'declined' END WHERE id = $1 AND status = 'pending'`.
  **Só altera `pending`** — é isso que garante R11 ("resposta que chegue depois não muda o status"). F06 depende disso.
- Exporte `processDueGatewayResponses()` (um ciclo do poller) para testes.

### Tickets — `src/features/purchases/tickets.ts`
`TicketRow` (camelCase), `getTicketById(db, id)`, `findTicketByCode(db, code)`, `listTicketsByUser(db, userId)` (com nome e
data do evento), `TICKET_STATUS_LABELS = { pending: 'pendente', confirmed: 'confirmado', declined: 'recusado',
cancelled: 'cancelado', refunded: 'estornado' }`.

### Vitrine — `src/features/purchases/routes.ts`
- Registra o slot de compra de F02 (`setPurchaseSlot`):
  - `available <= 0` → `<p class="sold-out">Ingressos esgotados</p>` (sem form);
  - visitante → link `Entre para comprar` (`/login`);
  - organizador → `Somente participantes compram ingressos`;
  - participante → form `POST /events/:id/purchase` com campo `cardNumber` (texto, 16 dígitos) e botão `Comprar`;
  - `message` (se houver) aparece acima.
- `POST /events/:id/purchase` (`requireParticipant`): `purchaseTicket({ buyerEmail: user.email, userId: user.id, channel: 'web' })`.
  - ok → `303 → /my-tickets`;
  - `sold_out` → 409, re-renderiza `/events/:id` com mensagem `Ingressos esgotados`;
  - `invalid_request` → 422, re-renderiza com `O número do cartão deve ter 16 dígitos`;
  - `event_not_available` → 404 `Evento não disponível`.
- `GET /my-tickets` (`requireParticipant`): `<h1>Meus ingressos</h1>` e tabela com **Evento**, **Data**, **Status** (rótulo) e
  **Código** dos ingressos de `user_id = request.user.id`, mais recentes primeiro. Cada linha `data-ticket-id`.

### Testes (`GATEWAY_DELAY_SCALE=0.01` nos gates)
- `decideSimulated` por final (aprovação e faixas de atraso com rng fixo).
- Compra web: pendente → confirmado após ~50 ms (aguarde com polling até 2 s), 0002 recusado libera vaga, cartão inválido não cria linha.
- `applyGatewayResult` ignora ticket não pendente.
- **Concorrência**: evento lotação 5, `Promise.all` de 30 `purchaseTicket` → exatamente 5 ok e 25 `sold_out`; repetir em 5 eventos novos.
- Preço: compra a R$100, muda preço para R$150 (F02 update), compra de novo → `price_cents` 10000 e 15000.
- X04: 1 pending + 1 confirmed via compras → `updateEvent` com capacity 1 rejeitado.
