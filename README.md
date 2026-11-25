# Catraca

Venda de ingressos para eventos pequenos (shows em bar, workshops, meetups), construída em modo agente:
PRD → spec/plano/contrato por feature → implementação por agentes → avaliação por agente separado.

> README em construção. As seções finais (PRs da wave paralela e decisões) são completadas ao fim da entrega.

## Como rodar

Pré-requisitos: **Docker** (com Compose v2), **bash** e **Git**. (Node é opcional: tudo roda em containers.)

| Ação | Comando |
|---|---|
| Subir (build, banco, migrations, seed) | `bash scripts/up.sh` |
| Derrubar | `bash scripts/down.sh` (`--purge` apaga também o volume do banco) |
| Gates (typecheck + testes) | `bash scripts/gates.sh` |

## Endereços

- Produto (`$WEB`): http://localhost:3000
- API de parceiros (`$API`): http://localhost:3000 (rotas em `/api/partner/...`)

## Credenciais (seed)

| Conta | E-mail | Senha |
|---|---|---|
| Organizador A | `org.a@catraca.dev` | `catraca123` |
| Organizador B | `org.b@catraca.dev` | `catraca123` |
| Participante | `participante@catraca.dev` | `catraca123` |
| Chave de parceiro (`X-Api-Key`) | `catraca-partner-key-dev` | — |

## Mapa dos artefatos

- `AGENTS.md`: porta de entrada dos agentes (`CLAUDE.md` aponta para ele)
- `docs/PRD.md`: PRD
- `docs/features/Fxx-*/`: `spec.md`, `plan.md`, `contract.md`, `reports/`
- `project-state.json`: estado do projeto
