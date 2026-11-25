# F01 — Contrato de avaliação

O avaliador executa cada item no commit avaliado e registra veredito + evidência. `$WEB=http://localhost:3000`.
Comandos em bash (no Windows: dentro do WSL). Use um cookie jar por usuário: `curl -s -c jar -b jar ...`.

## Pré-requisitos
- Docker e bash. Clone limpo (ou `git status` limpo) no commit avaliado.
- Nenhum outro container publicando a porta 3000.

## Itens

| ID | Item | Como verificar | Esperado |
|---|---|---|---|
| C01-01 | Subida em clone limpo | `git clone <repo> /tmp/x && cd /tmp/x && git checkout <sha> && bash scripts/up.sh` | termina com sucesso; `curl -s $WEB/health` → `{"status":"ok"}` |
| C01-02 | Seed carregada no boot | `POST /login` com `org.a@catraca.dev`/`catraca123`, `org.b@…`, `participante@…` | 303 para cada; organizador → `Location: /organizer`, participante → `/` |
| C01-03 | Seed idempotente | `bash scripts/seed.sh` duas vezes; `docker compose exec -T db psql -U catraca -c "select email,count(*) from users group by 1"` | sem erro; cada e-mail da seed com count 1 |
| C01-04 | Cadastro de participante | `POST /signup` `name=Ana&email=ana@x.com&password=segredo1` | 303; jar logado: `GET /` mostra `Ana` e `Sair` |
| C01-05 | Cadastro inválido | `POST /signup` com e-mail repetido; com senha `123` | 422 com `E-mail já cadastrado`; 422 com a mensagem de validação |
| C01-06 | Login inválido e logout | `POST /login` com senha errada; logout com `POST /logout` e depois `GET /organizer` com o jar | 401 `E-mail ou senha inválidos`; após logout → 302 `/login` |
| C01-07 | Guardas da área do organizador (R13) | `GET /organizer` como visitante, participante e organizador A | 302 `Location: /login`; 403 sem `Área do organizador`; 200 com `Área do organizador` |
| C01-08 | Sem cadastro de organizador | `POST /signup` com `role=organizer` extra; logar e `GET /organizer` | conta criada como participante → 403 |
| C01-09 | Derrubar encerra tudo | `bash scripts/down.sh`; `docker ps --filter name=catraca`; `curl -m 2 $WEB/health` | nenhum container; curl falha (conexão recusada) |
| C01-10 | Subir de novo | `bash scripts/up.sh` após o down; login org A | sobe sem erro; login 303 |
| C01-11 | Gates | `bash scripts/gates.sh` | termina com `GATES OK`, mostra testes vitest passando (incluindo `test/auth.test.ts`) |
| C01-12 | Gateway sem chave | `grep -rn "GATEWAY\|API_KEY" docker-compose.yml src/config.ts` | modo `simulated`, nenhuma chave de pagamento exigida |
| C01-13 | AGENTS.md e CLAUDE.md | ler arquivos | AGENTS.md tem comandos subir/derrubar/gates e mapa de artefatos; CLAUDE.md aponta para AGENTS.md |

## Mapeamento critério → itens

| Critério | Itens |
|---|---|
| F01-AC1 | C01-04, C01-05 |
| F01-AC2 | C01-02, C01-06 |
| F01-AC3 | C01-07 |
| F01-AC4 | C01-02, C01-03 |
| F01-AC5 | C01-08 |
| H1 | C01-01, C01-02 |
| H2 | C01-09, C01-10 |
| H3 | C01-11 |
| H4 | C01-12 |
| H5 | C01-13 |
