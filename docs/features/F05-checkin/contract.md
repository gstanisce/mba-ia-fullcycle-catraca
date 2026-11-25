# F05 — Contrato de avaliação

`$WEB=$API=http://localhost:3000`, `$KEY=catraca-partner-key-dev` (se F04 ainda não estiver na main, crie ingressos pela
vitrine com um participante). Check-in: `curl -s -b jarA -d "code=<C>" $WEB/organizer/events/$E/checkin` e procurar
`id="checkin-result"`.

## Pré-requisitos
- `bash scripts/down.sh --purge && bash scripts/up.sh`. Org A cria e publica E1 (lotação 3).
- Participante compra E1 com 0001 (C1, aguardar `confirmado`) e com 0003 (C2, fica `pendente` por 30 s).
- Org B cria e publica E2 e um participante compra E2 (C3).

## Itens

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C05-01 | Seção na página de gestão (R04, X08) | jarA `GET /organizer/events/$E1` | seção `Check-in` com campo `code` |
| C05-02 | Entrada liberada (R10) | check-in C1 | `Entrada liberada` |
| C05-03 | Já utilizado | C1 de novo | `Ingresso já utilizado` |
| C05-04 | Não confirmado (X09) | C2 (pendente) | `Ingresso não confirmado` |
| C05-05 | Inválido | `ZZZZZZZZ`; C3 (de E2) no check-in de E1 | `Ingresso inválido para este evento` nos dois |
| C05-06 | Evento cancelado (precedência) | `psql: update events set status='cancelled' where id='$E1'`; check-in C2 e C1 | `Evento cancelado` nos dois; `ZZZZZZZZ` continua `Ingresso inválido para este evento` |
| C05-07 | Check-in refletido na API (F05-AC2) | `GET /api/partner/tickets/<id de C1>` (se F04 presente) ou `select checked_in_at` | `checkedIn: true` / não nulo |
| C05-08 | Isolamento (R13, X08) | jarB `POST /organizer/events/$E1/checkin code=C1`; visitante; participante | 404 sem `E1`; 302 `/login`; 403 |
| C05-09 | Normalização | C de um ingresso confirmado digitado em minúsculas com espaços | `Entrada liberada` |
| C05-10 | Gates | `bash scripts/gates.sh` | `GATES OK`; inclui teste de precedência e de check-in simultâneo (1 liberado) |

## Mapeamento critério → itens

| Critério | Itens |
|---|---|
| F05-AC1 | C05-02, C05-03, C05-04, C05-05, C05-06 |
| F05-AC2 | C05-03, C05-07, C05-10 |
| X08 | C05-01, C05-08 |
| X09 | C05-02, C05-04, C05-05 |
