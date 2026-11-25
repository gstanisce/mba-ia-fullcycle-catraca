# Catraca

Venda de ingressos para eventos pequenos (shows em bar, workshops, meetups), construída **em modo agente**:
brief → PRD com features conectadas → spec, plano e contrato por feature → implementação por agentes em waves
(uma delas em paralelo, integrada por PRs) → avaliação de cada feature por um agente separado do implementador.

## Como rodar

**Pré-requisitos:** Docker com Compose v2, bash e Git. Node.js só é necessário para `scripts/flow.sh`.
O app, o banco e os gates rodam em containers.

| Ação | Comando |
|---|---|
| **Subir** (build, Postgres, migrations e seed, espera ficar saudável) | `bash scripts/up.sh` |
| **Derrubar** (remove containers e rede; o volume fica, e a seed é idempotente) | `bash scripts/down.sh` (`--purge` apaga também o banco) |
| **Gates** (typecheck `tsc` + 285 testes `vitest` num Postgres descartável) | `bash scripts/gates.sh` |
| Seed de novo (idempotente) | `bash scripts/seed.sh` |
| Fluxo do avaliador automatizado (passos 2–16, cerca de 3 min) | `bash scripts/up.sh && bash scripts/flow.sh` |

O modo padrão usa o **gateway simulado**, sem nenhuma chave de pagamento.
Variáveis opcionais: `CATRACA_PORT` (porta publicada, padrão 3000), `COMPOSE_PROJECT_NAME`, `PARTNER_API_KEY`.
`GATEWAY_DELAY_SCALE` existe só para testes; os gates usam `0.01` e o modo padrão fica em `1`.

## Endereços

| | URL |
|---|---|
| Produto (`$WEB`) | http://localhost:3000 |
| API de parceiros (`$API`) | http://localhost:3000 (rotas `/api/partner/events`, `/api/partner/events/{id}/purchases`, `/api/partner/tickets/{id}`) |

Páginas: vitrine `/`, evento `/events/{id}`, `/signup`, `/login`, "Meus ingressos" `/my-tickets`,
área do organizador `/organizer` e página de gestão do evento `/organizer/events/{id}`.

## Credenciais (seed)

| Conta | E-mail | Senha |
|---|---|---|
| Organizador A | `org.a@catraca.dev` | `catraca123` |
| Organizador B | `org.b@catraca.dev` | `catraca123` |
| Participante | `participante@catraca.dev` | `catraca123` |
| **Chave de parceiro** (`X-Api-Key`) | `catraca-partner-key-dev` | — |

## Mapa dos artefatos

| Artefato | Onde |
|---|---|
| Porta de entrada dos agentes | [`AGENTS.md`](AGENTS.md) ([`CLAUDE.md`](CLAUDE.md) aponta para ele) |
| PRD (features, provê/consome, grafo, waves, critérios por feature e cross-feature, rastreio R01–R13, fora de escopo) | [`docs/PRD.md`](docs/PRD.md) |
| Estado do projeto (status e relatório mais recente por feature) | [`project-state.json`](project-state.json) |
| Modelo de relatório de avaliação | [`docs/templates/evaluation-report.md`](docs/templates/evaluation-report.md) |
| Harness | `scripts/` (up, down, gates, seed, flow), `docker-compose.yml`, `docker-compose.test.yml`, `Dockerfile` |

Cada feature tem uma pasta com `spec.md`, `plan.md`, `contract.md` e `reports/`:

| Feature | Wave | Pasta | PR |
|---|---|---|---|
| F01 Plataforma e contas | 1 | [`docs/features/F01-plataforma`](docs/features/F01-plataforma) | [#1](https://github.com/gstanisce/mba-ia-fullcycle-catraca/pull/1) |
| F02 Eventos e vitrine | 2 | [`docs/features/F02-eventos`](docs/features/F02-eventos) | [#2](https://github.com/gstanisce/mba-ia-fullcycle-catraca/pull/2) |
| F03 Compra e gateway | 3 | [`docs/features/F03-compra-gateway`](docs/features/F03-compra-gateway) | [#3](https://github.com/gstanisce/mba-ia-fullcycle-catraca/pull/3) |
| F04 API de parceiros | **4 (paralela)** | [`docs/features/F04-api-parceiros`](docs/features/F04-api-parceiros) | [#6](https://github.com/gstanisce/mba-ia-fullcycle-catraca/pull/6) |
| F05 Check-in | **4 (paralela)** | [`docs/features/F05-checkin`](docs/features/F05-checkin) | [#4](https://github.com/gstanisce/mba-ia-fullcycle-catraca/pull/4) |
| F06 Cancelamento | **4 (paralela)** | [`docs/features/F06-cancelamento`](docs/features/F06-cancelamento) | [#5](https://github.com/gstanisce/mba-ia-fullcycle-catraca/pull/5) |
| F07 Painel do evento | 5 | [`docs/features/F07-painel`](docs/features/F07-painel) | [#7](https://github.com/gstanisce/mba-ia-fullcycle-catraca/pull/7) |

### PRs da wave paralela (wave 4)

F04, F05 e F06 foram implementadas ao mesmo tempo por três agentes, cada um na sua branch e na sua `git worktree`,
e integradas à main por PR. O primeiro commit de cada PR é anterior ao último commit dos outros:

| PR | Feature | Primeiro commit (UTC) | Último commit (UTC) |
|---|---|---|---|
| [#4](https://github.com/gstanisce/mba-ia-fullcycle-catraca/pull/4) | F05 Check-in | 2026-11-25 09:35:23 | 09:50:20 |
| [#5](https://github.com/gstanisce/mba-ia-fullcycle-catraca/pull/5) | F06 Cancelamento | 2026-11-25 09:35:19 | 09:52:34 |
| [#6](https://github.com/gstanisce/mba-ia-fullcycle-catraca/pull/6) | F04 API de parceiros | 2026-11-25 09:35:47 | 09:58:36 |

O merge do #6 deu conflito real em `src/app.ts` com o #4: as duas features registraram o plugin no mesmo ponto.
O conflito foi resolvido mantendo os dois registros, e os gates passaram no resultado integrado antes do merge.

## Decisões

### Stack: Node 24 + TypeScript (tsx), Fastify 5, Postgres 17, HTML renderizado no servidor, Vitest, Docker Compose
- A máquina do avaliador tem Docker e Node. Uma stack só em Node/TS roda inteira em containers e não exige outro runtime.
- **Postgres** dá transações e travas de linha reais, que são o mecanismo de R07. Uso SQL puro com `pg`, sem ORM, para que
  a trava fique explícita no código.
- **HTML no servidor** (template strings com escape automático) evita SPA, build de frontend e estado no cliente:
  nenhum critério avalia design, e "recarregar a página" basta.
- **Vitest com Postgres real** testa o banco de verdade nos testes de concorrência; um banco simulado provaria pouco.

### Como R07 é garantida sob concorrência
- Toda compra, da vitrine ou da API, passa por um único serviço, `purchaseTicket` (`src/features/purchases/service.ts`).
  Ele abre uma transação e trava a linha do evento com `SELECT … FROM events WHERE id = $1 FOR UPDATE`.
- **Só depois da trava** ele conta as vagas ocupadas (pendentes + confirmados, via `src/features/events/seats.ts`, a fonte
  única de R05) e insere o ingresso. Compras simultâneas do mesmo evento ficam em fila. Em READ COMMITTED, cada uma vê os
  commits das anteriores, então a 6ª compra de um evento de lotação 5 sempre vê 5 ocupadas e recebe `sold_out`.
- A mesma trava é usada pela edição de lotação (R03), pelo cancelamento (R11) e pelo check-in (em modo compartilhado).
  Por isso lotação, cancelamento e compra nunca se cruzam.
- **Como provamos:**
  - testes automatizados: 30 compras simultâneas em lotação 5, em 5 rodadas no serviço e 3 rodadas por HTTP real;
  - o avaliador repetiu a rajada do passo 15 (`xargs -P 30`) em várias rodadas e eventos novos;
  - `scripts/flow.sh` repete a rajada em E4 e E5.

  Sempre exatamente `5 202` e `25 409`.

### Resposta assíncrona do gateway
- A compra grava o ingresso `pending` e, **na mesma transação**, o pedido ao gateway simulado em `gateway_requests`
  (resultado e horário da resposta, sorteados pelo final do cartão). Depois responde imediatamente (202 na API, redirect na
  vitrine). Assim a resposta não espera o gateway (R06), e o pedido sobrevive a um restart do app.
- Um *poller* no app (a cada 100 ms, `FOR UPDATE SKIP LOCKED`) entrega as respostas vencidas a `applyGatewayResult`.
  Essa função faz `UPDATE tickets SET status = … WHERE id = $1 AND status = 'pending'`. **Só ingressos pendentes mudam.**
  Por isso uma resposta que chega depois do cancelamento não altera `cancelled`/`refunded` (R11).
- Os atrasos ficam dentro das janelas do brief, com folga para as verificações de ponta a ponta:

  | Final do cartão | Resultado | Atraso |
  |---|---|---|
  | `0001` | aprovado | 2–4,5 s |
  | `0002` e outros finais | recusado | 2–4,5 s |
  | `0003` | aprovado | 30–38 s |
  | `0004` | recusado | 30–38 s |

  `GATEWAY_DELAY_SCALE` acelera os atrasos só nos testes.
- O cancelamento é síncrono: numa única transação, `confirmed → refunded` e `pending → cancelled`. O prazo de 10 s é
  cumprido na hora.

### Como a avaliação foi isolada do implementador
- Um agente orquestrador (Claude Code) escreveu PRD, specs, planos e contratos. Cada feature foi **implementada por um
  subagente** e **avaliada por outro subagente novo, de contexto vazio**. O avaliador recebia apenas o ID da feature, o SHA
  do commit e o caminho do contrato, e nunca via o raciocínio nem o relato do implementador.
- O avaliador clonava o commit numa pasta limpa, rodava gates, subida e cada item do contrato (curl, psql, rajadas) e
  registrava veredito e evidência. Depois commitava **apenas** o relatório (`reports/<data>-<sha>.md`), uma única vez.
- Regras do `AGENTS.md`: o implementador não escreve relatórios nem altera o estado; relatório nunca é editado (correção ⇒
  nova avaliação ⇒ novo arquivo). Cada relatório aparece em um único commit:
  `git log --format="%h %ad" --date=iso -- docs/features/*/reports/*.md`.
- O "Fluxo do avaliador" completo (`scripts/flow.sh`, 61 verificações) foi rodado na main a partir de um clone limpo, depois
  do último merge, junto com gates, derrubar e subir de novo: tudo passou.
