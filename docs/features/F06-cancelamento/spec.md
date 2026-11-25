# F06 — Cancelamento · Spec

PRD: `docs/PRD.md` §F06. Critérios: F06-AC1..AC4, X10, X11. Wave 4 (paralela). Consome F02 (eventos, `loadOwnedEvent`,
seções, vitrine/`getOnSaleEvent`) e F03 (`applyGatewayResult` só altera `pending`; `purchaseTicket` recusa não publicado).

## Decisões técnicas
- `src/features/cancellation/service.ts`:
  `cancelEvent(eventId, organizerId): Promise<{ ok: true; refunded: number; cancelled: number } | { ok: false; message: string }>`
  numa única transação:
  1. `SELECT … FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE` (a mesma trava de compras de F03 → nenhuma
     compra entra "no meio" do cancelamento).
  2. Só `published` pode ser cancelado. `draft` → `Somente eventos publicados podem ser cancelados`; `cancelled` → `Evento já cancelado`.
  3. `UPDATE events SET status='cancelled', cancelled_at=now(), updated_at=now()`.
  4. `UPDATE tickets SET status='refunded' WHERE event_id=$1 AND status='confirmed'`;
     `UPDATE tickets SET status='cancelled' WHERE event_id=$1 AND status='pending'`.
  Como é síncrono, R11 ("em até 10 segundos") é atendido imediatamente.
- Resposta tardia do gateway: `applyGatewayResult` (F03) só atualiza `status='pending'` → `cancelled`/`refunded` ficam.
  **Não** altere F03; prove com teste.
- `src/features/cancellation/plugin.ts`:
  - Seção `cancel` (order 90, título `Cancelamento`): evento `published` → form `POST /organizer/events/:id/cancel` com
    botão `Cancelar evento` e aviso de irreversível; `cancelled` → `<p class="cancelled">Evento cancelado</p>` sem botão;
    `draft` → texto `Somente eventos publicados podem ser cancelados`.
  - `POST /organizer/events/:id/cancel` (`requireOrganizer` + `loadOwnedEvent`) → `cancelEvent` → `303` para a página
    de gestão (sucesso) ou re-render com `state.cancel = { message }` e 422.
- Consequências já garantidas por F02/F03 e verificadas aqui (X10/X11): sai da vitrine e da listagem (status ≠ published),
  `/events/:id` 404, compra → `event_not_available`, edição/publicação → 422, `availableSeats` → 0.
- Registrar o plugin em `src/app.ts`.

## Testes
- Cancelar evento com 1 confirmado + 1 pendente (0003) → refunded/cancelled; depois `processDueGatewayResponses` após
  o atraso → continuam refunded/cancelled.
- Draft não cancela; segundo cancelamento é recusado; não há rota de "republicar" que funcione (publish → 422).
- Depois de cancelado: `listOnSaleEvents` não contém, `getOnSaleEvent` nulo, `purchaseTicket` → `event_not_available`,
  `updateEvent` → erro, `availableSeats` = 0, página pública 404, página de gestão sem form de edição e com `Evento cancelado`.
- Org B → 404 ao cancelar evento de A (e evento continua publicado).
- Corrida: cancelamento concorrente com 20 compras → ao final nenhum ticket `pending`/`confirmed` no evento.
