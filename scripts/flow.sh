#!/usr/bin/env bash
# Automated run of the evaluator flow (brief, steps 2–16) against a RUNNING product.
# Usage: bash scripts/up.sh && bash scripts/flow.sh      (takes ~3 min: slow-card waits are real)
# Env: WEB (default http://localhost:3000), API (default $WEB), KEY (default catraca-partner-key-dev).
# Needs: bash, curl, node (for dates/JSON). Exits non-zero if any check fails.
set -uo pipefail

WEB="${WEB:-http://localhost:${CATRACA_PORT:-3000}}"
API="${API:-$WEB}"
KEY="${KEY:-catraca-partner-key-dev}"
PW=catraca123
RUN="$(date +%s)$RANDOM"
J="$(mktemp -d)"
trap 'rm -rf "$J"' EXIT
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check() { local d="$1"; shift; if "$@"; then ok "$d"; else bad "$d"; fi; }
eq()   { [[ "$1" == "$2" ]] || { echo "         expected [$2] got [$1]" >&2; return 1; }; }
has()  { grep -qF -- "$2" <<<"$1"; }
hasnt(){ ! grep -qF -- "$2" <<<"$1"; }
step() { echo; echo "== $*"; }
day()  { node -e "const d=new Date(Date.now()+($1)*864e5);console.log(d.toISOString().slice(0,10))"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const v=(new Function("o","return o"+process.argv[1]))(o);console.log(v===undefined?"":typeof v==="object"?JSON.stringify(v):v)}catch(e){console.log("")}})' "$1"; }

login()  { curl -s -o /dev/null -c "$J/$1" -b "$J/$1" --data-urlencode "email=$2" --data-urlencode "password=$PW" "$WEB/login"; }
get()    { curl -s -b "$J/$1" "$WEB$2"; }
code_of(){ curl -s -o /dev/null -w '%{http_code}' -b "$J/$1" "$WEB$2"; }
post()   { local jar="$1" path="$2"; shift 2; curl -s -o "$J/last" -w '%{http_code} %{redirect_url}' -b "$J/$jar" -c "$J/$jar" "$@" "$WEB$path"; }
mkevent(){ # jar name capacity price date -> echoes "status evt_id"
  local out; out=$(post "$1" /organizer/events --data-urlencode "name=$2" --data-urlencode "startsAt=$5T21:00" \
    --data-urlencode "venue=Bar do Teste" --data-urlencode "capacity=$3" --data-urlencode "price=$4")
  echo "${out%% *} $(grep -o 'evt_[a-z0-9]*' <<<"$out" | head -1)"; }
publish(){ post "$1" "/organizer/events/$2/publish" -X POST >/dev/null; }
edit()   { post "$1" "/organizer/events/$2" --data-urlencode "name=$3" --data-urlencode "startsAt=$4T21:00" \
    --data-urlencode "venue=Bar do Teste" --data-urlencode "capacity=$5" --data-urlencode "price=$6" | cut -d' ' -f1; }
events() { curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events"; }
seats()  { events | json ".find(e=>e.id==='$1')?.availableSeats"; }
buy()    { curl -s -w '\n%{http_code}' -X POST "$API/api/partner/events/$1/purchases" -H "X-Api-Key: $KEY" \
    -H 'Content-Type: application/json' -d "{\"buyerEmail\":\"$2\",\"cardNumber\":\"$3\"}"; }
ticket() { curl -s -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$1"; }
tstatus(){ ticket "$1" | json .status; }
wait_status(){ # ticket status timeout_s
  local end=$(( $(date +%s) + $3 )); while (( $(date +%s) <= end )); do [[ "$(tstatus "$1")" == "$2" ]] && return 0; sleep 0.5; done; return 1; }
panel()  { get "$1" "/organizer/events/$2" | grep -o "data-metric=\"[a-z]*\">[^<]*" | sed 's/data-metric="//; s/">/=/; s/\xc2\xa0/ /g' | tr '\n' ';'; }
checkin(){ curl -s -b "$J/$1" --data-urlencode "code=$3" "$WEB/organizer/events/$2/checkin" | grep -o 'id="checkin-result"[^>]*>[^<]*' | sed 's/.*>//'; }
sleep_until(){ local now; now=$(date +%s); (( $1 > now )) && sleep $(( $1 - now )); return 0; }

FUT=$(day 35); YEST=$(day -1)
echo "Catraca flow: WEB=$WEB API=$API run=$RUN"
login A org.a@catraca.dev; login B org.b@catraca.dev; login P participante@catraca.dev

step "2. E1 em rascunho fora da vitrine e da API"
N1="E1 Flow $RUN"; read -r st E1 < <(mkevent A "$N1" 2 "100,00" "$FUT")
check "E1 criado (303) $E1" eq "$st" 303
check "vitrine sem E1" hasnt "$(curl -s "$WEB/")" "$N1"
check "API sem E1" hasnt "$(events)" "$E1"

step "3. data de ontem rejeitada"
read -r st _ < <(mkevent A "Ontem $RUN" 2 "100,00" "$YEST")
check "criação com data passada rejeitada ($st)" test "$st" != 303

step "4. publicar E1"
publish A "$E1"
check "vitrine mostra E1" has "$(curl -s "$WEB/")" "$N1"
check "API availableSeats 2" eq "$(seats "$E1")" 2
check "API priceCents 10000" eq "$(events | json ".find(e=>e.id==='$E1')?.priceCents")" 10000

step "5. participante novo compra na vitrine (0001)"
EM="flow$RUN@example.com"
post U /signup --data-urlencode "name=Flow $RUN" --data-urlencode "email=$EM" --data-urlencode "password=$PW" >/dev/null
post U "/events/$E1/purchase" --data-urlencode "cardNumber=4000000000000001" >/dev/null
row() { get U /my-tickets | grep -F "$N1" | head -1; }
check "Meus ingressos: pendente" has "$(row)" "pendente"
C1=$(row | sed -n 's/.*<code>\([A-Z0-9]*\)<\/code>.*/\1/p')
confirmed=no; for _ in $(seq 1 10); do sleep 0.5; has "$(row)" "confirmado" && { confirmed=yes; break; }; done
check "confirmado em até 5 s (C1=$C1)" eq "$confirmed" yes

step "6. compra pela API com 0004"
R=$(buy "$E1" t2@example.com 4000000000000004); T6=$(date +%s)
check "202" eq "$(tail -1 <<<"$R")" 202
T2=$(head -1 <<<"$R" | json .ticketId); C2=$(head -1 <<<"$R" | json .code)
check "status pending" eq "$(head -1 <<<"$R" | json .status)" pending
check "availableSeats 0" eq "$(seats "$E1")" 0

step "7. esgotado (antes de 30 s)"
R=$(buy "$E1" t3@example.com 4000000000000001)
check "409" eq "$(tail -1 <<<"$R")" 409
check "sold_out" eq "$(head -1 <<<"$R" | json .error)" sold_out
check "vitrine: Ingressos esgotados" has "$(get U "/events/$E1")" "Ingressos esgotados"

step "8. após 45 s, T2 declined e vaga volta"
sleep_until $((T6 + 45))
check "T2 declined" eq "$(tstatus "$T2")" declined
check "availableSeats 1" eq "$(seats "$E1")" 1
R=$(buy "$E1" t3@example.com 4000000000000001); T3=$(head -1 <<<"$R" | json .ticketId)
check "T3 confirmed em até 5 s" wait_status "$T3" confirmed 5

step "9. lotação e preço; painel"
check "reduzir lotação para 1 rejeitado" test "$(edit A "$E1" "$N1" "$FUT" 1 "100,00")" != 303
check "preço 150,00 e lotação 3 aceitos" eq "$(edit A "$E1" "$N1" "$FUT" 3 "150,00")" 303
R=$(buy "$E1" t4@example.com 4000000000000001); T4=$(head -1 <<<"$R" | json .ticketId)
check "T4 confirmed" wait_status "$T4" confirmed 6
check "painel E1" eq "$(panel A "$E1")" "confirmed=3;pending=0;checkins=0;available=0;revenue=R\$ 350,00;refunded=0;"

step "10. check-in"
check "C1 Entrada liberada" eq "$(checkin A "$E1" "$C1")" "Entrada liberada"
check "C1 Ingresso já utilizado" eq "$(checkin A "$E1" "$C1")" "Ingresso já utilizado"
check "C2 Ingresso não confirmado" eq "$(checkin A "$E1" "$C2")" "Ingresso não confirmado"
check "ZZZZZZZZ inválido" eq "$(checkin A "$E1" ZZZZZZZZ)" "Ingresso inválido para este evento"
check "painel Check-ins 1" has "$(panel A "$E1")" "checkins=1;"
T1=$(get U /my-tickets | grep -F "$C1" | grep -o 'tkt_[a-z0-9]*' | head -1)
check "API: ticket da vitrine (C1) com checkedIn true" eq "$(ticket "$T1" | json .checkedIn)" true
MG="/organizer/events/$E1"

step "11. isolamento"
check "B: lista sem E1" hasnt "$(get B /organizer)" "$N1"
check "B: endereço direto sem dados de E1" hasnt "$(get B "$MG")" "$N1"
check "B: endereço direto não 200" test "$(code_of B "$MG")" != 200
N2="E2 Flow $RUN"; read -r _ E2 < <(mkevent B "$N2" 1 "20,00" "$FUT"); publish B "$E2"
check "E2 na API" has "$(events)" "$E2"
R=$(buy "$E2" c3@example.com 4000000000000001); C3=$(head -1 <<<"$R" | json .code)
check "participante seed: sem dados de E1" hasnt "$(get P "$MG")" "$N1"
check "visitante: sem dados de E1" hasnt "$(curl -s -L "$WEB$MG")" "$N1"
check "C3 no check-in de E1: inválido" eq "$(checkin A "$E1" "$C3")" "Ingresso inválido para este evento"

step "12. E3: compras e cancelamento"
N3="E3 Flow $RUN"; read -r _ E3 < <(mkevent A "$N3" 5 "50,00" "$FUT"); publish A "$E3"
R=$(buy "$E3" t5@example.com 4000000000000003); T5S=$(date +%s); T5=$(head -1 <<<"$R" | json .ticketId)
R=$(buy "$E3" t6@example.com 4000000000000001); T6ID=$(head -1 <<<"$R" | json .ticketId); C6=$(head -1 <<<"$R" | json .code)
check "T6 confirmed" wait_status "$T6ID" confirmed 6
check "ainda antes de 30 s da compra de T5" test $(( $(date +%s) - T5S )) -lt 30
post A "/organizer/events/$E3/cancel" -X POST >/dev/null

step "13. após cancelar"
check "API sem E3" hasnt "$(events)" "$E3"
check "vitrine sem E3" hasnt "$(curl -s "$WEB/")" "$N3"
R=$(buy "$E3" x@example.com 4000000000000001)
check "compra 404 event_not_available" eq "$(tail -1 <<<"$R") $(head -1 <<<"$R" | json .error)" "404 event_not_available"
check "T6 refunded em até 10 s" wait_status "$T6ID" refunded 10
check "T5 cancelled em até 10 s" wait_status "$T5" cancelled 10
check "gestão sem formulário de edição" hasnt "$(get A "/organizer/events/$E3")" 'name="startsAt"'
check "editar E3 rejeitado" test "$(edit A "$E3" "$N3 x" "$FUT" 5 "50,00")" != 303

step "14. resposta tardia e painel E3"
sleep_until $((T5S + 45))
check "T5 continua cancelled" eq "$(tstatus "$T5")" cancelled
check "C6 Evento cancelado" eq "$(checkin A "$E3" "$C6")" "Evento cancelado"
check "painel E3" eq "$(panel A "$E3")" "confirmed=0;pending=0;checkins=0;available=0;revenue=R\$ 0,00;refunded=1;"

step "15. carga: 30 compras simultâneas, lotação 5 (E4, E5)"
for n in 4 5; do
  read -r _ EV < <(mkevent A "E$n Flow $RUN" 5 "10,00" "$FUT"); publish A "$EV"
  OUT=$(seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/partner/events/$EV/purchases" \
    -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
    -d "{\"buyerEmail\":\"carga{}@example.com\",\"cardNumber\":\"4000000000000001\"}" | sort | uniq -c | awk '{print $1"x"$2}' | tr '\n' ' ')
  check "E$n: $OUT" eq "$OUT" "5x202 25x409 "
  okp=no; for _ in $(seq 1 20); do has "$(panel A "$EV")" "confirmed=5;" && { okp=yes; break; }; sleep 0.5; done
  check "E$n painel Confirmados 5 em até 10 s" eq "$okp" yes
  check "E$n Vagas disponíveis 0" has "$(panel A "$EV")" "available=0;"
done

step "16. erros da API"
for m in "GET $API/api/partner/events" "POST $API/api/partner/events/$E1/purchases" "GET $API/api/partner/tickets/$T2"; do
  set -- $m
  check "$1 ${2#$API} sem chave → 401" eq "$(curl -s -X "$1" -w ' %{http_code}' "$2")" '{"error":"unauthorized"} 401'
  check "$1 ${2#$API} chave errada → 401" eq "$(curl -s -X "$1" -H 'X-Api-Key: errada' -w ' %{http_code}' "$2")" '{"error":"unauthorized"} 401'
done
R=$(buy "$E1" a@example.com 123)
check "cardNumber 123 → 422 invalid_request" eq "$(tail -1 <<<"$R") $(head -1 <<<"$R" | json .error)" "422 invalid_request"
check "ticket inexistente → 404 ticket_not_found" eq "$(curl -s -w ' %{http_code}' -H "X-Api-Key: $KEY" "$API/api/partner/tickets/tkt_nao_existe")" '{"error":"ticket_not_found"} 404'

echo
echo "RESULT: $PASS ok, $FAIL fail"
(( FAIL == 0 ))
