# F07 — Painel do evento · Spec

PRD: `docs/PRD.md` §F07. Critérios: F07-AC1, F07-AC2, X12–X15. Wave 5. Consome F02 (seções, `availableSeats`,
`loadOwnedEvent`), F03 (`tickets.price_cents`), F05 (`checked_in_at`), F06 (status `refunded`).

## Definições (R12) — vendas da vitrine e da API contam igual
| Rótulo (exato) | Valor |
|---|---|
| Confirmados | `count(status='confirmed')` (inclui os com check-in) |
| Pendentes | `count(status='pending')` |
| Check-ins | `count(status='confirmed' AND checked_in_at IS NOT NULL)` |
| Vagas disponíveis | `availableSeats(event)` de F02 (R05; 0 se cancelado) |
| Receita | `sum(price_cents) WHERE status='confirmed'`, formatado `formatBRL` → `R$ 350,00` |
| Estornados | `count(status='refunded')` |

Receita **nunca** soma `refunded`/`cancelled`/`declined`/`pending`. Usa o preço gravado no ingresso, não o preço atual.

## Decisões técnicas
- `src/features/dashboard/service.ts`: `getDashboard(db, event): Promise<Dashboard>` com uma query agregada
  (`count(*) FILTER (WHERE …)`) + `availableSeats` de F02.
- `src/features/dashboard/plugin.ts`: `registerManagementSection({ id: 'panel', title: 'Painel', order: 10, render })` —
  `<dl id="panel">` com `<dt>Rótulo</dt><dd data-metric="confirmed|pending|checkins|available|revenue|refunded">valor</dd>`.
  Registrar em `src/app.ts`. A posse já é garantida pela página de gestão (`loadOwnedEvent`).

## Testes
- Cenário do passo 9 do fluxo: lotação 2 → 1 confirmado (R$100, web) + 1 declined (api) + 1 confirmado (R$100, api);
  muda preço para 150 e lotação 3; 1 confirmado (R$150) → Confirmados 3, Pendentes 0, Check-ins 0, Vagas 0, Receita `R$ 350,00`, Estornados 0.
- Após check-in (`checkIn` de F05) → Check-ins 1, Confirmados 3.
- Cancelamento (`cancelEvent` de F06) com 1 confirmado + 1 pendente → 0, 0, 0, 0, `R$ 0,00`, 1.
- Página HTML do dono contém os seis rótulos; org B → 404 sem números.
