# F04 — API de parceiros · Spec

PRD: `docs/PRD.md` §F04. Critérios: F04-AC1..AC6, X05, X06, X07. Wave 4 (paralela). Consome F02 (`listOnSaleEvents`,
`availableSeats`) e F03 (`purchaseTicket`, `getTicketById`).

## Contrato fixo (do brief — não alterar)

Toda rota exige `X-Api-Key` = `config.partnerApiKey` (padrão `catraca-partner-key-dev`). Ausente/inválida →
`401 {"error":"unauthorized"}` (antes de qualquer outra verificação, inclusive 404 de rota existente).

`GET /api/partner/events` → `200` array de
`{ "id": string, "name": string, "startsAt": "2026-12-05T21:00:00-03:00", "priceCents": int, "availableSeats": int }`
— só eventos publicados e não cancelados; `availableSeats` = R05 (`availableSeats` de F02). Exatamente esses campos.

`POST /api/partner/events/{eventId}/purchases` body `{ "buyerEmail": string, "cardNumber": string }` →
`202 { "ticketId", "code", "status": "pending" }`. Erros, nesta ordem:
1. corpo inválido (não-JSON, campo faltando, e-mail mal formado, cartão ≠ 16 dígitos) → `422 {"error":"invalid_request"}`
2. evento inexistente, rascunho ou cancelado → `404 {"error":"event_not_available"}`
3. sem vaga → `409 {"error":"sold_out"}`

`GET /api/partner/tickets/{ticketId}` → `200 { "ticketId", "code", "eventId", "status", "checkedIn": boolean }`
(qualquer canal); inexistente → `404 {"error":"ticket_not_found"}`.

## Decisões técnicas
- `src/features/partner-api/plugin.ts`, registrado com `prefix: '/api/partner'` em `src/app.ts`.
- Auth: hook `onRequest` no escopo do plugin; comparação com `crypto.timingSafeEqual` (tamanhos diferentes → inválida).
- **Não** usar JSON schema do Fastify para o body (geraria 400). Validação manual via `purchaseTicket` (F03), que já
  segue a ordem 422 → 404 → 409. Corpo não-JSON/vazio/malformado: `setErrorHandler` no escopo do plugin mapeia erros de
  parse (`FST_ERR_CTP_*`, `statusCode 400/415`) para `422 invalid_request`. Body que não é objeto → 422.
- `channel: 'api'`, `userId: null`.
- `startsAt` via `toIsoWithOffset` (F02 `src/lib/format.ts`). IDs são os de banco (`evt_…`, `tkt_…`).
- `checkedIn` = `checked_in_at IS NOT NULL`.
- Status HTTP 202 para compra criada.

## Testes
- 401 nas três rotas, sem header e com chave errada.
- Listagem: rascunho fora, publicado dentro, cancelado fora (update direto no banco), campos exatos (`Object.keys` ordenado).
- Ordem de erros: corpo inválido em evento inexistente → 422; corpo válido em rascunho → 404; esgotado → 409.
- **Concorrência HTTP real**: `app.listen({ port: 0 })` e 30 `fetch` simultâneos em evento de lotação 5 → 5×202, 25×409;
  repetir em 3 eventos novos.
- Gateway: compra 0001 → `confirmed` (polling até 2 s com escala 0.01); 0004 → `declined` e `availableSeats` volta.
- Ticket comprado pela vitrine (F03) consultável pela API com o mesmo `code` (X07).
