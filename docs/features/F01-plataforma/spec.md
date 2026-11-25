# F01 — Plataforma e contas · Spec

PRD: `docs/PRD.md` §F01. Critérios: F01-AC1..AC5, H1..H5. Wave 1.

## Escopo
Contas (participante via cadastro, organizador via seed), sessão por cookie, guardas de papel, layout HTML e seed.
Stubs temporários de `/` e `/organizer` (substituídos por F02).

## Decisões técnicas

### Dados — `db/migrations/010_users.sql`
```sql
users(id text PK,              -- 'usr_' + 10 chars base36
      name text NOT NULL,
      email text NOT NULL UNIQUE,   -- sempre gravado em minúsculas
      password_hash text NOT NULL,  -- 'scrypt$<salt hex>$<hash hex>'
      role text NOT NULL CHECK (role IN ('organizer','participant')),
      created_at timestamptz NOT NULL DEFAULT now())
sessions(token text PK,        -- 32 bytes aleatórios em hex
         user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         created_at timestamptz NOT NULL DEFAULT now(),
         expires_at timestamptz NOT NULL)   -- now() + 7 dias
```

### Utilitários — `src/lib/`
- `ids.ts`: `newId(prefix: string): string` (`prefix_` + 10 chars `[0-9a-z]`, `crypto.randomBytes`); `newTicketCode(): string`
  (8 chars do alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
- `html.ts`: `escapeHtml(s)`; tagged template `html\`...\`` que escapa interpolações, exceto valores `SafeHtml`
  (criados por `raw(s)` ou pelo próprio `html`), e aceita arrays (concatena). `SafeHtml` tem `toString()`.
- `password.ts`: `hashPassword(plain)`, `verifyPassword(plain, hash)` com `crypto.scrypt` + `timingSafeEqual`.
- `layout.ts`: `layout({ title, user, body, status? }): string` — documento HTML completo, `<nav>` com:
  `Vitrine` (`/`) sempre; participante: `Meus ingressos` (`/my-tickets`); organizador: `Área do organizador` (`/organizer`);
  logado: nome + botão `Sair` (form POST `/logout`); visitante: `Entrar` (`/login`) e `Criar conta` (`/signup`).

### Auth — `src/features/auth/`
- `plugin.ts` (Fastify plugin, registrado em `src/app.ts` com `fastify-plugin`-like encapsulation desligada — use
  `app.addHook` no nível raiz, ou exporte uma função `registerAuth(app)`): hook `onRequest` lê cookie `sid`, carrega
  `request.user: SessionUser | null` (`{ id, name, email, role }`) de sessão não expirada. Declare o tipo via
  `declare module 'fastify' { interface FastifyRequest { user: SessionUser | null } }` + `app.decorateRequest('user', null)`.
- Rotas:
  - `GET /signup` form (name, email, password); `POST /signup`: valida nome não vazio, e-mail `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`,
    senha ≥ 6 chars, e-mail não usado → cria `participant`, cria sessão, `303 → /`. Erro → 422 com o form e a mensagem
    (`E-mail já cadastrado`, `Informe nome, e-mail válido e senha com pelo menos 6 caracteres`).
  - `GET /login`; `POST /login` (email, password) → sessão, `303 →` `/organizer` (organizador) ou `/` (participante).
    Inválido → 401 com form e `E-mail ou senha inválidos`.
  - `POST /logout` → apaga sessão + cookie, `303 → /`.
  - Cookie `sid`: `httpOnly`, `sameSite: 'lax'`, `path: '/'`.
- `guards.ts`: `requireOrganizer` e `requireParticipant` (preHandlers). Sem usuário → `302 /login`.
  Papel errado → `403` com página `Acesso restrito` **sem** nenhum dado do recurso.
- Cadastro **sempre** cria `participant` (ignora qualquer campo `role` enviado).

### Seed — `src/seed.ts`
Exporta `SEED_ACCOUNTS` e `runSeed()`. Upsert por e-mail (`ON CONFLICT (email) DO UPDATE SET name, role, password_hash`):

| Conta | Nome | E-mail | Senha | Papel |
|---|---|---|---|---|
| Organizador A | Organizador A | `org.a@catraca.dev` | `catraca123` | organizer |
| Organizador B | Organizador B | `org.b@catraca.dev` | `catraca123` | organizer |
| Participante | Participante Seed | `participante@catraca.dev` | `catraca123` | participant |

### Stubs (removidos por F02)
- `GET /` → `layout` com `<h1>Vitrine</h1>`.
- `GET /organizer` (requireOrganizer) → `<h1>Área do organizador</h1>`.
Coloque-os em `src/features/stubs.ts` para F02 apagar o arquivo inteiro.

### Testes — helpers em `test/helpers.ts`
Adicione `loginAs(app, email, password): Promise<string>` (retorna o header `cookie`) e `SEED` (re-export de `SEED_ACCOUNTS`).

## Fora do escopo de F01
Eventos, compras, API de parceiros.
