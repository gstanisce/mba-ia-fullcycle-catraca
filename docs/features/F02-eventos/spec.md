# F02 — Eventos e vitrine · Spec

PRD: `docs/PRD.md` §F02. Critérios: F02-AC1..AC7, X01. Wave 2. Consome F01 (sessão, guardas, layout).

## Decisões técnicas

### Dados — `db/migrations/020_events_tickets.sql`
```sql
events(id text PK,                         -- 'evt_' + 10 chars
       organizer_id text NOT NULL REFERENCES users(id),
       name text NOT NULL, venue text NOT NULL,
       starts_at timestamptz NOT NULL,
       capacity int NOT NULL CHECK (capacity >= 1),
       price_cents int NOT NULL CHECK (price_cents > 0),
       status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled')),
       created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
       published_at timestamptz, cancelled_at timestamptz)
tickets(id text PK,                        -- 'tkt_' + 10 chars (linhas criadas por F03)
        event_id text NOT NULL REFERENCES events(id),
        code text NOT NULL UNIQUE,         -- 8 chars (R09)
        status text NOT NULL CHECK (status IN ('pending','confirmed','declined','cancelled','refunded')),
        price_cents int NOT NULL,          -- preço vigente na compra (R03/R12)
        channel text NOT NULL CHECK (channel IN ('web','api')),
        user_id text REFERENCES users(id), -- nulo para compras da API
        buyer_email text NOT NULL,
        card_last4 text NOT NULL,
        checked_in_at timestamptz,         -- preenchido por F05
        created_at timestamptz NOT NULL DEFAULT now())
INDEX tickets(event_id, status); INDEX events(organizer_id); INDEX tickets(user_id)
```

### Módulo de vagas — `src/features/events/seats.ts` (fonte única de R05)
```ts
export async function occupiedSeats(db: Db, eventId: string): Promise<number> // count status IN ('pending','confirmed')
export function computeAvailable(event: { capacity: number; status: string }, occupied: number): number
  // status 'cancelled' → 0; senão max(0, capacity - occupied)
export async function availableSeats(db: Db, event: EventRow): Promise<number>
```

### Repositório — `src/features/events/repo.ts`
`EventRow` (camelCase: `id, organizerId, name, venue, startsAt: Date, capacity, priceCents, status, ...`).
`getEventById(db, id)`, `listEventsByOrganizer(db, organizerId)`, `listOnSaleEvents(db)` (status `published`, ordem por
`starts_at`), `getOnSaleEvent(db, id)`, `createEvent(input)`, `updateEvent(id, organizerId, input)`, `publishEvent(id, organizerId)`.
- `updateEvent`: `withTransaction` + `SELECT … FOR UPDATE` no evento; se `cancelled` → erro `Evento cancelado não pode ser editado`;
  se `capacity < occupiedSeats` → erro `A lotação não pode ser menor que as vagas ocupadas (N)`; data no passado → erro.
- `publishEvent`: só `draft → published` (`published_at = now()`); `cancelled` → erro `Evento cancelado não pode ser publicado`.
- Erros de domínio: classe `DomainError(message)`; rotas renderizam a mensagem com 422.

### Validação de formulário — `src/features/events/validation.ts`
Campos: `name`, `startsAt` (`datetime-local`, ex. `2026-12-05T21:00`, interpretado em `-03:00`), `venue`, `capacity`, `price`.
- `price` aceita `100`, `100,00`, `100.00`, `1.234,56` → centavos inteiros; precisa ser > 0.
- `capacity` inteiro ≥ 1. `startsAt` precisa ser > agora (criar **e** editar). Mensagem: `A data de início precisa estar no futuro`.
- Retorna `{ ok: true, value } | { ok: false, errors: string[] }`.

### Formatação — `src/lib/format.ts`
`formatBRL(cents)` → `R$ 1.234,56`; `formatDateTime(date)` → `05/12/2026 21:00` (em -03:00);
`toIsoWithOffset(date)` → `2026-12-05T21:00:00-03:00`; `toDateTimeLocal(date)` → `2026-12-05T21:00` (para o form).

### Área do organizador — `src/features/events/organizer-routes.ts` (todas com `requireOrganizer` de F01)
- `GET /organizer` — `<h1>Área do organizador</h1>`, link `Novo evento`, tabela **só dos eventos do usuário** com nome,
  data, status (`Rascunho`/`Publicado`/`Cancelado`) e link para `/organizer/events/:id`.
- `GET /organizer/events/new`, `POST /organizer/events` → cria `draft`, `303 → /organizer/events/:id`; erro → 422 + form.
- `GET /organizer/events/:id` — página de gestão (R04).
- `POST /organizer/events/:id` (editar), `POST /organizer/events/:id/publish`.

### Posse — `loadOwnedEvent(request, reply, id): Promise<EventRow | null>` em `src/features/events/ownership.ts`
Se o evento não existe **ou** `organizer_id ≠ request.user.id`: responde `404` com página `Evento não encontrado`
(sem nome/números/ingressos) e retorna `null`. Toda rota `/organizer/events/:id*` — de qualquer feature — usa esta função.

### Página de gestão e seções — `src/features/events/management.ts`
```ts
export interface ManagementContext { event: EventRow; user: SessionUser; state: Record<string, unknown>; db: Db }
export interface ManagementSection { id: string; title: string; order: number;
  render(ctx: ManagementContext): string | SafeHtml | Promise<string | SafeHtml> }
export function registerManagementSection(section: ManagementSection): void  // substitui se o id já existe
export async function renderManagementPage(reply, ctx, statusCode = 200): Promise<void>
```
Página: `<h1>{nome}</h1>`, status, data, local, lotação, preço, e as seções ordenadas por `order`, cada uma em
`<section id="section-{id}"><h2>{title}</h2>…</section>`. F02 registra a seção `edit` (order 50: form de edição +
botão `Publicar` se rascunho; se `cancelled`, só o texto `Evento cancelado` e nenhum form).
Ordem reservada: `panel` 10 (F07), `checkin` 20 (F05), `edit` 50 (F02), `cancel` 90 (F06).
Rotas POST de outras features re-renderizam a página com `state[sectionId] = <resultado>`.

### Vitrine — `src/features/events/public-routes.ts`
- `GET /` — `<h1>Vitrine</h1>`, eventos `listOnSaleEvents` com nome (link `/events/:id`), data, local, preço.
- `GET /events/:id` — só evento à venda (`getOnSaleEvent`), senão 404. Mostra nome, data, local, preço,
  `Vagas disponíveis: N` e o **slot de compra**.
- Slot: `src/features/events/purchase-slot.ts`: `setPurchaseSlot(fn: (ctx: { event, user, available, message? }) => string | SafeHtml)`
  e `renderPurchaseSlot(ctx)`. Sem slot registrado → vazio. F03 registra.
- Remover `src/features/stubs.ts` de F01.

## Fora do escopo de F02
Criação de ingressos (F03), check-in (F05), cancelamento (F06 — mas F02 já recusa editar/publicar `cancelled`), painel (F07).
