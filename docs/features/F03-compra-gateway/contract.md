# F03 — Contrato de avaliação

`$WEB=http://localhost:3000`. Modo padrão (escala do gateway 1). Jars: `jarA` (org A), `jarU` (participante novo criado via
`POST /signup`). Eventos criados e publicados por jarA via F02 (`POST /organizer/events`, `/publish`), data +30 dias.

## Pré-requisitos
- `bash scripts/down.sh --purge && bash scripts/up.sh` no commit avaliado.

## Itens

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C03-01 | Compra nasce pendente e responde sem esperar (R06) | E1 (lotação 2, R$100). jarU `POST /events/$E1/purchase` `cardNumber=4000000000000001` medindo tempo (`-w %{time_total}`); `GET /my-tickets` | 303 → `/my-tickets` em < 1 s; linha com `E1`, `pendente` e código de 8 caracteres |
| C03-02 | 0001 confirma em ≤ 5 s (R08) | recarregar `/my-tickets` a cada 1 s | `confirmado` em até 5 s |
| C03-03 | 0002 recusa e libera vaga (R05, R08) | E2 (lotação 1). jarU compra com `4000000000000002`; logo após, `GET /events/$E2` | logo após: `Ingressos esgotados`; após ≤ 5 s: `/my-tickets` `recusado` e `/events/$E2` mostra `Vagas disponíveis: 1` e form |
| C03-04 | Cartão inválido rejeitado sem criar ingresso | `cardNumber=123`; contar tickets no banco antes/depois | 422 com mensagem de 16 dígitos; contagem igual |
| C03-05 | Esgotado na vitrine (R07) | E3 lotação 1; jarU compra 0001; `GET /events/$E3`; novo POST de compra | página com `Ingressos esgotados` e sem form; POST → 409 com `Ingressos esgotados` |
| C03-06 | Pendente ocupa vaga (R05/R06) | E4 lotação 1; compra 0003; `GET /events/$E4` em < 30 s; banco `status` | `Ingressos esgotados`; ticket `pending` até ~30–40 s, então `confirmed` |
| C03-07 | Concorrência (R07) | `bash scripts/gates.sh` e localizar o teste de concorrência | teste com 30 compras simultâneas em lotação 5 → 5 ok / 25 sold_out, em ≥ 5 rodadas, passando |
| C03-08 | Concorrência no app real (R07) | E5 lotação 5; rodar em paralelo 30 `purchaseTicket` via script `docker compose exec -T app npx tsx -e '…'` (ou 30 sessões web) e contar tickets `pending+confirmed` | exatamente 5 |
| C03-09 | Código único e Meus ingressos só do dono (R09) | outro participante (jarP seed) `GET /my-tickets`; `select count(distinct code)=count(*) from tickets` | jarP não vê ingressos de jarU; códigos únicos |
| C03-10 | Snapshot de preço (R03) | E6 R$100: compra; jarA muda preço para `150,00`; compra; `select price_cents from tickets where event_id='$E6'` | 10000 e 15000 |
| C03-11 | Gateway só altera pendente (R08/R11) | gates: teste de `applyGatewayResult` em ticket `refunded`/`cancelled` | status não muda |
| C03-12 | Compra exige participante (X02) | visitante `POST /events/$E1/purchase`; org A `POST` | visitante 302 `/login`; organizador 403 |
| C03-13 | Só evento à venda aceita compra (X03) | jarA cria E7 rascunho; jarU `POST /events/$E7/purchase` | 404 `Evento não disponível`; nenhum ticket |
| C03-14 | Compras entram nas vagas de F02 (X04) | E8 lotação 2: compra 0003 (pendente) + 0001 (confirmado); jarA edita lotação para 1 | 422 mensagem de lotação; lotação para 3 aceita |

## Mapeamento critério → itens

| Critério | Itens |
|---|---|
| F03-AC1 | C03-01 |
| F03-AC2 | C03-02, C03-03, C03-06 |
| F03-AC3 | C03-04 |
| F03-AC4 | C03-03, C03-06 |
| F03-AC5 | C03-05 |
| F03-AC6 | C03-07, C03-08 |
| F03-AC7 | C03-01, C03-09 |
| F03-AC8 | C03-10 |
| F03-AC9 | C03-11 |
| X02 | C03-12 |
| X03 | C03-13, C03-01 |
| X04 | C03-14 |
