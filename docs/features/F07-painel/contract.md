# F07 — Contrato de avaliação

`$WEB=$API=http://localhost:3000`, `$KEY=catraca-partner-key-dev`. Ler o painel: `curl -s -b jarA $WEB/organizer/events/$E`
e extrair `<dd data-metric=…>`.

## Pré-requisitos
- `bash scripts/down.sh --purge && bash scripts/up.sh` no commit avaliado (F01–F06 na main).

## Itens

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C07-01 | Rótulos exatos (R12) | jarA `GET /organizer/events/$E1` | `Confirmados`, `Pendentes`, `Check-ins`, `Vagas disponíveis`, `Receita`, `Estornados` |
| C07-02 | Cenário do passo 9 (R03, R12, X13) | E1 lotação 2, R$100: participante web 0001 (confirma); API 0004 (pendente) → painel; aguardar 45 s (declined); API 0001 (T3); jarA preço `150,00` lotação 3; API 0001 (T4); aguardar confirmações | durante 0004: Pendentes 1, Vagas 0; final: Confirmados 3, Pendentes 0, Check-ins 0, Vagas disponíveis 0, Receita `R$ 350,00`, Estornados 0 |
| C07-03 | Check-in conta (X14) | check-in do código web (F05) → `Entrada liberada` | Check-ins 1, Confirmados 3 |
| C07-04 | Cancelamento (X15) | E3 lotação 5 R$50: API 0003 (T5) e 0001 (T6), T6 confirmado; cancelar E3; painel | Confirmados 0, Pendentes 0, Check-ins 0, Vagas disponíveis 0, Receita `R$ 0,00`, Estornados 1 |
| C07-05 | Após resposta tardia | 45 s após T5 | painel de E3 inalterado |
| C07-06 | Carga (R07, X12) | E4 lotação 5 R$10: 30 compras simultâneas (passo 15); aguardar 10 s | `5 202`/`25 409`; painel: Confirmados 5, Vagas disponíveis 0, Receita `R$ 50,00` |
| C07-07 | Isolamento (R13, X12) | jarB `GET /organizer/events/$E1` | 404, sem `Confirmados` nem números de E1 |
| C07-08 | Gates | `bash scripts/gates.sh` | `GATES OK`; inclui testes do painel |

## Mapeamento critério → itens

| Critério | Itens |
|---|---|
| F07-AC1 | C07-01 |
| F07-AC2 | C07-02, C07-03, C07-04 |
| X12 | C07-06, C07-07 |
| X13 | C07-02 |
| X14 | C07-03 |
| X15 | C07-04, C07-05 |
