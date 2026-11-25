# F01 — Plano

1. Migration `010_users.sql` (users, sessions).
2. `src/lib/ids.ts`, `html.ts`, `password.ts`, `layout.ts` + testes unitários (`test/lib.test.ts`: escape, ids, senha).
3. `src/features/auth/` (hook de sessão, rotas signup/login/logout, guardas) e registro em `src/app.ts`.
4. Stubs `/` e `/organizer` em `src/features/stubs.ts`.
5. `src/seed.ts` com as três contas (upsert) e `SEED_ACCOUNTS`.
6. `test/helpers.ts`: `loginAs`, `SEED`. `test/auth.test.ts`: cadastro, duplicado, login ok/erro, logout, guardas
   (visitante 302, participante 403, organizador 200), seed duas vezes sem duplicar, cadastro ignora `role=organizer`.
7. `bash scripts/gates.sh` verde; `bash scripts/up.sh` e conferir login das contas da seed; `bash scripts/down.sh`.
