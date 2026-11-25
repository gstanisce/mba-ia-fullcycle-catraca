# AGENTS.md — porta de entrada dos agentes

Catraca: venda de ingressos para eventos pequenos. Leia este arquivo inteiro antes de qualquer tarefa.

## Comandos (rode da raiz do repo; precisam de Docker e bash)

| O quê | Comando | Observação |
|---|---|---|
| Subir tudo | `bash scripts/up.sh` | build + Postgres + app; migrations e seed no boot; retorna quando saudável |
| Derrubar tudo | `bash scripts/down.sh` | remove containers e rede; `--purge` também apaga o volume do banco |
| Gates | `bash scripts/gates.sh` | typecheck (`tsc`) + testes (`vitest`) num Postgres descartável, tudo em container |
| Seed de novo | `bash scripts/seed.sh` | idempotente; precisa do produto no ar |

- Produto e API: `http://localhost:3000` (`CATRACA_PORT` muda a porta publicada).
- Worktrees paralelas: use `COMPOSE_PROJECT_NAME=catraca-fXX CATRACA_PORT=30XX bash scripts/up.sh` para não colidir com a main.
  `scripts/gates.sh` já usa um nome de projeto único por execução.
- **No Windows** o Docker só existe no WSL: `wsl -d Ubuntu -- bash -lc 'cd /mnt/c/Work/fullcycle/catraca && bash scripts/gates.sh'`
  (troque o caminho pela worktree, ex.: `/mnt/c/Work/fullcycle/catraca-wt/F04`).
- Gateway: sempre simulado. `GATEWAY_DELAY_SCALE` (padrão `1`) multiplica os atrasos; os gates usam `0.01`.
  O modo padrão (avaliador) **nunca** muda a escala.

## Mapa dos artefatos

| Artefato | Caminho |
|---|---|
| PRD (features, provê/consome, grafo, waves, critérios, fora de escopo) | `docs/PRD.md` |
| Feature `Fxx` — spec, plano, contrato | `docs/features/Fxx-*/spec.md`, `plan.md`, `contract.md` |
| Relatórios de avaliação | `docs/features/Fxx-*/reports/<data>-<commit>.md` |
| Modelo de relatório | `docs/templates/evaluation-report.md` |
| Estado do projeto | `project-state.json` |
| Código | `src/` (harness em `src/*.ts`, features em `src/features/<área>/`, utilitários em `src/lib/`) |
| Migrations | `db/migrations/NNN_*.sql` (prefixo pelo nº da feature: F01→`01x`, F02→`02x`…) |
| Testes | `test/**/*.test.ts` (Postgres real; `resetDb()` em `test/helpers.ts`) |

## Regras do projeto (obrigatórias)

1. **Fonte única por conceito.** Vagas (R05) só em `src/features/events/seats.ts`; transições de status do ingresso por
   gateway só em `applyGatewayResult` (F03); posse do evento só via `loadOwnedEvent` (F02). Não reimplemente — importe.
2. **Concorrência.** Qualquer operação que lê vagas e escreve ingresso/lotação/status do evento roda em
   `withTransaction` e trava a linha do evento com `SELECT … FROM events WHERE id = $1 FOR UPDATE` antes de contar.
3. **Mensagens e rótulos exatos do brief** (ex.: `Ingressos esgotados`, `Entrada liberada`, `Confirmados`). Copie da spec, não parafraseie.
4. **API de parceiros tem contrato fixo** (campos, status HTTP, códigos de erro): ver `docs/features/F04-api-parceiros/spec.md`.
5. **Escopo da feature.** Implemente só o que está na spec/contrato da sua feature. Precisa mudar algo de outra feature?
   Faça o mínimo, explique no PR e cubra com teste.
6. **Testes junto do código.** Toda regra implementada ganha teste em `test/`. `bash scripts/gates.sh` precisa passar antes do commit final.
7. **Quem implementa não avalia.** O implementador nunca escreve relatório em `reports/` nem marca a feature como `done`.
   A avaliação é feita por outro agente, de contexto vazio, contra `contract.md`.
8. **Relatórios são imutáveis.** Um relatório novo por avaliação, commitado uma vez, nunca editado. Correção ⇒ nova avaliação ⇒ novo arquivo.
9. **Estado.** `project-state.json` é atualizado pelo orquestrador: status da feature e caminho do relatório mais recente.
10. **Git.** Uma branch por feature (`feat/Fxx-nome`), integrada por PR. Commits pequenos e descritivos.
    Line endings LF (`.gitattributes`). Nunca commite segredos.

## Fluxo de trabalho por feature

1. Ler `docs/PRD.md` (seção da feature + critérios X que a envolvem) e `docs/features/Fxx-*/{spec,plan,contract}.md`.
2. Implementar seguindo o `plan.md`, com testes. Rodar `bash scripts/gates.sh`.
3. Subir o produto e conferir manualmente os itens do contrato que dependem do app no ar.
4. Abrir PR. **Avaliador separado** (sessão ou subagente novo) executa o contrato no commit da branch e grava
   `reports/<data>-<sha>.md` a partir do modelo. Reprovado → correção → nova avaliação.
5. Merge na main; orquestrador atualiza `project-state.json`.

## Stack

Node 24 + TypeScript (executado com `tsx`), Fastify 5, Postgres 17 (`pg`, SQL puro), HTML renderizado no servidor
(template strings com escape), Vitest. Tudo em Docker Compose.
