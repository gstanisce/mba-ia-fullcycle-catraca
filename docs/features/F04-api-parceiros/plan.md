# F04 — Plano

1. `src/features/partner-api/plugin.ts`: hook de chave, error handler 422, três rotas.
2. Registrar em `src/app.ts` com prefixo `/api/partner`.
3. `test/partner-api.test.ts`: auth, listagem, campos exatos, ordem de erros, consulta, gateway, X05–X07.
4. `test/partner-api-concurrency.test.ts`: 30 requisições HTTP simultâneas × 3 eventos.
5. Gates verdes. Subir e rodar o passo 15 do fluxo do avaliador (`seq 30 | xargs -P 30 …`) pelo menos 3 vezes.
6. Documentar a chave no README (seção Credenciais) se ainda não estiver.
