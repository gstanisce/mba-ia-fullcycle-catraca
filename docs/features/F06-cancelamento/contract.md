# F06 — Contrato de avaliação

`$WEB=http://localhost:3000`. Jars: `jarA`, `jarB`, `jarU` (participante). Ingressos comprados pela vitrine (F03); se F04
estiver presente, pode usar a API.

## Pré-requisitos
- `bash scripts/down.sh --purge && bash scripts/up.sh`. Org A cria e publica E3 (lotação 5, R$50).

## Itens

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C06-01 | Botão de cancelar na gestão | jarA `GET /organizer/events/$E3` | seção `Cancelamento` com `Cancelar evento` |
| C06-02 | Cancelamento com status em ≤ 10 s (R11) | jarU compra com 0003 (T5) e logo com 0001 (T6); aguardar T6 `confirmado`; antes de 30 s de T5, `POST /organizer/events/$E3/cancel`; em ≤ 10 s `select id,status from tickets where event_id='$E3'` e `/my-tickets` | T6 `refunded` / `estornado`; T5 `cancelled` / `cancelado` |
| C06-03 | Resposta tardia não muda (R11) | 45 s após a compra de T5, consultar de novo | T5 continua `cancelled`; T6 `refunded` |
| C06-04 | Sai da vitrine (X10) | visitante `GET /`; `GET /events/$E3` | E3 ausente; 404 |
| C06-05 | Não vende (X11) | jarU `POST /events/$E3/purchase cardNumber=4000000000000001`; (se F04) `POST /api/partner/events/$E3/purchases` | 404 `Evento não disponível` / `{"error":"event_not_available"}`; nenhum ticket novo |
| C06-06 | Não edita nem republica (F06-AC4) | jarA `POST /organizer/events/$E3` (editar) e `/publish`; `GET` página de gestão | 422 nos dois; página mostra `Evento cancelado`, sem form de edição e sem botão de cancelar |
| C06-07 | Irreversível | jarA `POST /organizer/events/$E3/cancel` de novo | recusado (`Evento já cancelado`); status continua `cancelled` |
| C06-08 | Draft não cancela | criar E9 rascunho; POST cancel | 422 `Somente eventos publicados podem ser cancelados`; continua `draft` |
| C06-09 | Isolamento (R13) | jarB `POST /organizer/events/<E de A publicado>/cancel` | 404 sem dados; evento continua publicado |
| C06-10 | Vagas zeradas (R05) | (se F04) listagem não contém E3; ou gates: teste `availableSeats` = 0 para cancelado | ok |
| C06-11 | Gates | `bash scripts/gates.sh` | `GATES OK`; inclui teste de resposta tardia e corrida cancelamento × compras |

## Mapeamento critério → itens

| Critério | Itens |
|---|---|
| F06-AC1 | C06-01, C06-02, C06-07 |
| F06-AC2 | C06-02 |
| F06-AC3 | C06-03, C06-11 |
| F06-AC4 | C06-06 |
| X10 | C06-04, C06-06, C06-10 |
| X11 | C06-05, C06-03 |
