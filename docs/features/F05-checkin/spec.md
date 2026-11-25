# F05 — Check-in · Spec

PRD: `docs/PRD.md` §F05. Critérios: F05-AC1, F05-AC2, X08, X09. Wave 4 (paralela). Consome F02 (`loadOwnedEvent`,
`registerManagementSection`, `renderManagementPage`) e F03 (tickets, `findTicketByCode`).

## Regra R10 — mensagens exatas, primeira condição verdadeira vence
1. código não existe ou é de outro evento → `Ingresso inválido para este evento`
2. evento `cancelled` → `Evento cancelado`
3. ingresso ≠ `confirmed` → `Ingresso não confirmado`
4. `checked_in_at` preenchido → `Ingresso já utilizado`
5. senão → marca `checked_in_at = now()` → `Entrada liberada`

## Decisões técnicas
- `src/features/checkin/service.ts`:
  `checkIn(eventId: string, rawCode: string): Promise<{ result: CheckinResult; message: string }>` com
  `CheckinResult = 'invalid' | 'event_cancelled' | 'not_confirmed' | 'already_used' | 'admitted'` e `CHECKIN_MESSAGES`.
  - Normaliza o código: `trim().toUpperCase()`.
  - `withTransaction`: `SELECT status FROM events WHERE id = $1` (o evento já foi validado como do organizador);
    `SELECT … FROM tickets WHERE code = $1 AND event_id = $2 FOR UPDATE` (trava o ingresso → dois check-ins simultâneos
    do mesmo código serializam: o segundo vê `checked_in_at` preenchido). Aplica a lista na ordem.
- `src/features/checkin/plugin.ts`:
  - `registerManagementSection({ id: 'checkin', title: 'Check-in', order: 20, render })`: form `POST /organizer/events/:id/checkin`
    com input `code` e botão `Validar`; se `ctx.state.checkin` existir, mostra `<p id="checkin-result" data-result="…">mensagem</p>`.
    (O campo continua disponível em evento cancelado; a lista de R10 trata.)
  - `POST /organizer/events/:id/checkin` (`requireOrganizer` + `loadOwnedEvent` → 404 para não-dono):
    executa `checkIn` e re-renderiza a página de gestão com `state.checkin = { result, message }` (HTTP 200).
- Registrar o plugin em `src/app.ts`.

## Testes
- As cinco mensagens, cada uma isolada, inclusive precedência: código de outro evento em evento cancelado → inválido;
  pendente em evento cancelado → `Evento cancelado`; já utilizado mas evento cancelado → `Evento cancelado`.
- Código em minúsculas/espaços funciona.
- 10 check-ins simultâneos do mesmo código → exatamente 1 `admitted`.
- Org B → 404 sem nome do evento; visitante → 302; participante → 403.
- Ingressos criados via `purchaseTicket` (web e api) + `processDueGatewayResponses` → check-in.
  Para "evento cancelado", use `UPDATE events SET status='cancelled'` direto no teste (F06 é paralela).
