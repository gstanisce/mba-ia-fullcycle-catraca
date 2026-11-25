# F02 — Plano

1. Migration `020_events_tickets.sql`.
2. `src/lib/format.ts` + testes (BRL, datas, ISO com offset).
3. `validation.ts` + testes (preço em reais, lotação, data passada).
4. `seats.ts` + `repo.ts` (com `FOR UPDATE` em update/publish) + testes: R05 com tickets inseridos direto no banco
   (pending, confirmed, declined, refunded…), redução abaixo das ocupadas rejeitada, aumento aceito, cancelado → 0.
5. `ownership.ts`, `management.ts` (registro de seções + seção `edit`), `organizer-routes.ts`.
6. `purchase-slot.ts`, `public-routes.ts`; remover `src/features/stubs.ts`; registrar plugins em `src/app.ts`.
7. Testes HTTP (`app.inject`): criar (válido/ inválido/ passado), rascunho fora da vitrine e 404 público, publicar → aparece,
   editar com data passada rejeitado, isolamento A/B (lista, GET, POST editar/publicar → 404 sem nome), guardas (X01).
8. Gates verdes; subir e conferir fluxo no navegador/curl.
