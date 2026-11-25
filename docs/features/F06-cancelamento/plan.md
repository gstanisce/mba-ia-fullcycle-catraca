# F06 — Plano

1. `service.ts` `cancelEvent` (transação com trava) + testes de serviço, incluindo resposta tardia do gateway e corrida com compras.
2. `plugin.ts`: seção `cancel` e rota POST; registrar em `src/app.ts`.
3. Testes HTTP: botão, cancelamento, página de gestão sem edição, vitrine e página pública, isolamento A/B.
4. Gates verdes; subir e conferir o passo 12–14 do fluxo do avaliador (via API se F04 estiver na main, senão pela vitrine).
