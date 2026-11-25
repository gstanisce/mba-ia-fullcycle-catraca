# F02 — Contrato de avaliação

`$WEB=http://localhost:3000`. Login com `curl -s -c jarA -b jarA -d 'email=org.a@catraca.dev&password=catraca123' $WEB/login`
(idem `jarB` para `org.b@catraca.dev`, `jarP` para `participante@catraca.dev`). Datas no formato `AAAA-MM-DDTHH:MM`.

## Pré-requisitos
- `bash scripts/up.sh` no commit avaliado (banco limpo: `bash scripts/down.sh --purge` antes).
- F01 na main.

## Itens

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C02-01 | Criar evento válido (R01) | jarA: `POST /organizer/events` `name=E1&startsAt=<+30 dias>T21:00&venue=Bar&capacity=2&price=100,00` | 303 para `/organizer/events/evt_…`; página mostra `E1`, `Rascunho`, `R$ 100,00` |
| C02-02 | Campos inválidos (R01) | `capacity=0`; `price=0`; `name=` vazio | 422 com mensagem; nenhum evento criado |
| C02-03 | Data passada na criação (R01) | `startsAt=<ontem>T10:00` | 422 `A data de início precisa estar no futuro` |
| C02-04 | Data passada na edição (R01) | `POST /organizer/events/$E1` com data de ontem | 422 com a mesma mensagem; evento inalterado |
| C02-05 | Rascunho fora da vitrine (R02) | visitante `GET /`; `GET /events/$E1` | `E1` ausente; 404 |
| C02-06 | Publicar mostra na vitrine (R02) | jarA `POST /organizer/events/$E1/publish`; visitante `GET /` e `/events/$E1` | E1 listado; página com `Vagas disponíveis: 2` |
| C02-07 | Lotação vs ocupadas (R03, R05) | inserir 1 ticket `pending` e 1 `confirmed` em E1 via `psql` (ver nota); editar `capacity=1`; depois `capacity=3` | 1 → 422 com mensagem de lotação; 3 → 303 e página mostra lotação 3 |
| C02-08 | Página de gestão com URL própria (R04) | jarA `GET /organizer`; seguir o link | lista E1 com link `/organizer/events/$E1`; página tem form de edição |
| C02-09 | Isolamento entre organizadores (R13) | jarB `GET /organizer`; `GET /organizer/events/$E1`; `POST /organizer/events/$E1` (editar nome) e `/publish` | lista sem E1; 404 sem `E1`/números; POST 404; E1 inalterado (conferir com jarA) |
| C02-10 | Guardas nas rotas de F02 (X01) | visitante e jarP: `GET /organizer/events/new` e `GET /organizer/events/$E1` | visitante 302 `/login`; participante 403 sem dados |
| C02-11 | Evento cancelado não edita | `psql`: `update events set status='cancelled' where id='$E1'`; editar e publicar via POST; `GET` página | POST 422; página mostra `Evento cancelado` e nenhum form de edição |
| C02-12 | Testes unitários de R05 e gates | `bash scripts/gates.sh` | `GATES OK`; existe teste de `seats` cobrindo pendente+confirmado contam, recusado/estornado não, cancelado → 0 |

Nota C02-07 (inserção direta, pois a compra é de F03):
```
docker compose exec -T db psql -U catraca -c "insert into tickets(id,event_id,code,status,price_cents,channel,buyer_email,card_last4) values ('tkt_t1','$E1','TESTAAA1','pending',10000,'api','a@x.com','0001'),('tkt_t2','$E1','TESTAAA2','confirmed',10000,'api','b@x.com','0001')"
```

## Mapeamento critério → itens

| Critério | Itens |
|---|---|
| F02-AC1 | C02-01, C02-02 |
| F02-AC2 | C02-03, C02-04 |
| F02-AC3 | C02-05, C02-06 |
| F02-AC4 | C02-07 |
| F02-AC5 | C02-08 |
| F02-AC6 | C02-09 |
| F02-AC7 | C02-12, C02-06 |
| X01 | C02-10 |
| (F06-AC4 base) | C02-11 |
