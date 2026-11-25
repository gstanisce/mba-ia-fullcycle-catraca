# F03 — Plano

1. Migration `030_gateway_requests.sql`.
2. `gateway.ts`: `decideSimulated`, `requestAuthorization`, `applyGatewayResult`, `processDueGatewayResponses`, poller
   (registrado no plugin com `onReady`/`onClose`). Testes unitários.
3. `tickets.ts` (consultas e rótulos).
4. `service.ts` `purchaseTicket` com ordem de validação e trava `FOR UPDATE`. Testes: ordem dos erros, snapshot de preço,
   concorrência 30×5 em 5 rodadas.
5. `routes.ts`: slot de compra, `POST /events/:id/purchase`, `GET /my-tickets`; registrar em `src/app.ts`.
6. Testes HTTP: visitante → `/login`; participante compra → `/my-tickets` com `pendente` e código; depois `confirmado`;
   esgotado mostra `Ingressos esgotados`; rascunho não compra (X03); X04.
7. Gates verdes. Subir com escala padrão e conferir 0001 confirmando em ≤ 5 s.
