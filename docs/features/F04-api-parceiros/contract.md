# F04 — Contrato de avaliação

`$API=http://localhost:3000`, `$KEY=catraca-partner-key-dev`. Eventos criados/publicados por org A via web (F02).

## Pré-requisitos
- `bash scripts/down.sh --purge && bash scripts/up.sh` no commit avaliado. `jq` opcional.

## Itens

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C04-01 | 401 sem chave | `curl -s -w ' %{http_code}' $API/api/partner/events`; idem `POST …/events/x/purchases` e `GET …/tickets/x` | `{"error":"unauthorized"} 401` nas três |
| C04-02 | 401 chave errada | mesmo com `-H "X-Api-Key: errada"` | idem |
| C04-03 | Listagem só à venda (R02, X05) | criar E1 rascunho → listar; publicar → listar | rascunho ausente; publicado presente |
| C04-04 | Campos exatos | `curl -s -H "X-Api-Key: $KEY" $API/api/partner/events` | cada item com exatamente `id,name,startsAt,priceCents,availableSeats`; `startsAt` ISO com offset; E1 (lotação 2, R$100) → `priceCents 10000`, `availableSeats 2` |
| C04-05 | Compra 202 (R06) | `POST /api/partner/events/$E1/purchases` `{"buyerEmail":"t@x.com","cardNumber":"4000000000000001"}` | `202` `{"ticketId":"…","code":"<8>","status":"pending"}` |
| C04-06 | Consulta e confirmação (X06) | `GET /api/partner/tickets/$T` imediatamente e após 5 s | `pending` → `confirmed`; campos `ticketId,code,eventId,status,checkedIn:false` |
| C04-07 | Recusa lenta libera vaga (X06, R05, R08) | evento lotação 1: compra 0004 → listar → após 45 s consultar e listar | `availableSeats 0` → ticket `declined` e `availableSeats 1` |
| C04-08 | 422 invalid_request | `cardNumber":"123"`; sem `buyerEmail`; e-mail `abc`; corpo `not json` | 422 `{"error":"invalid_request"}` em todos |
| C04-09 | 404 event_not_available | evento inexistente; rascunho; cancelado (via `psql update events set status='cancelled'`) | 404 `{"error":"event_not_available"}` |
| C04-10 | 409 sold_out | evento esgotado | 409 `{"error":"sold_out"}` |
| C04-11 | Ordem dos erros | corpo inválido em evento inexistente; corpo válido em rascunho esgotado | 422; 404 |
| C04-12 | 404 ticket_not_found | `GET /api/partner/tickets/tkt_nao_existe` | 404 `{"error":"ticket_not_found"}` |
| C04-13 | Concorrência (R07) | evento novo lotação 5: `seq 30 \| xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/partner/events/$E/purchases" -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' \| sort \| uniq -c` — **3 rodadas em eventos novos** | cada rodada: `5 202` e `25 409` |
| C04-14 | Ticket da vitrine na API (X07) | participante compra pela vitrine; pegar id no banco ou `data-ticket-id` em `/my-tickets`; consultar na API | mesmo `code` exibido em "Meus ingressos" |
| C04-15 | Gates | `bash scripts/gates.sh` | `GATES OK`, incluindo testes da API e de concorrência HTTP |

## Mapeamento critério → itens

| Critério | Itens |
|---|---|
| F04-AC1 | C04-01, C04-02 |
| F04-AC2 | C04-03, C04-04 |
| F04-AC3 | C04-05 |
| F04-AC4 | C04-08, C04-09, C04-10, C04-11 |
| F04-AC5 | C04-13, C04-15 |
| F04-AC6 | C04-06, C04-12 |
| X05 | C04-03, C04-04 |
| X06 | C04-06, C04-07 |
| X07 | C04-14 |
