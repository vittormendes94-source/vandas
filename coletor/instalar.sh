#!/usr/bin/env bash
# Instalador da coleta local do Orquidário (Raspberry Pi OS, Debian ou Ubuntu; 64 bits).
#
# Uso (no computador do orquidário, com o adaptador Zigbee USB conectado):
#   curl -fsSL https://raw.githubusercontent.com/vittormendes94-source/vandas/main/coletor/instalar.sh | sudo bash
#
# Pode ser rodado de novo a qualquer momento (atualiza tudo e mantém pareamentos, fila e configuração).
# Variáveis opcionais: ORQ_URL, ORQ_INGEST_TOKEN (evitam as perguntas), ZIGBEE_TIPO (zstack|ember),
# ZIGBEE_ADAPTADOR (caminho do adaptador), ORQ_BRANCH (padrão: main).
set -euo pipefail

REPO_URL="https://github.com/vittormendes94-source/vandas.git"
BRANCH="${ORQ_BRANCH:-main}"
APP_DIR="/opt/orquidario"
DADOS="${ORQ_DADOS:-/opt/orquidario-dados}"
SERIAL_DIR="${ZIGBEE_SERIAL_DIR:-/dev/serial/by-id}"

passo() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
erro() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
pergunta() { # pergunta "texto" VAR
  local v=""
  if [ -r /dev/tty ]; then read -r -p "$1: " v </dev/tty || true; fi
  printf -v "$2" '%s' "$v"
}
aleatorio() { od -An -N"${1:-16}" -tx1 /dev/urandom | tr -d ' \n'; } # 2 caracteres hexadecimais por byte

# Tipo do adaptador pelo nome em /dev/serial/by-id (ZBDongle-E/MG24 → ember; ZBDongle-P/PP10 → zstack).
tipo_do_adaptador() {
  case "$1" in
    *V2* | *MG24* | *EFR32* | *Dongle-E* | *ZBDongle-E* | *SkyConnect* | *ZBT*) echo ember ;;
    *Dongle_Plus* | *CC26* | *PP10* | *Texas_Instruments* | *ZBDongle-P*) echo zstack ;;
    *) echo "" ;;
  esac
}

encontrar_adaptador() {
  [ -d "$SERIAL_DIR" ] || return 0
  local f
  for f in "$SERIAL_DIR"/*; do
    [ -e "$f" ] || continue
    case "$(basename "$f")" in
      *[Zz]igbee* | *[Dd]ongle* | *SONOFF* | *Sonoff* | *ITead* | *ITEAD* | *CC26* | *EFR32* | *MG24* | *SkyConnect* | *ZBT*) echo "$f"; return 0 ;;
    esac
  done
}

# Permite testar só as funções: ORQ_SO_FUNCOES=1 source instalar.sh
if [ "${ORQ_SO_FUNCOES:-}" = "1" ]; then return 0 2>/dev/null || exit 0; fi

[ "$(id -u)" -eq 0 ] || erro "Rode como administrador: ... | sudo bash"
[ "$(uname -s)" = "Linux" ] || erro "Este instalador é para Linux (Raspberry Pi OS, Debian ou Ubuntu)."
case "$(uname -m)" in x86_64 | aarch64 | arm64) ;; *) erro "Sistema de 32 bits ($(uname -m)). Instale a versão 64 bits do sistema (Raspberry Pi OS 64-bit)." ;; esac

passo "1/7 Programas necessários (git, curl, Docker)"
if ! command -v git >/dev/null || ! command -v curl >/dev/null; then
  apt-get update -qq && apt-get install -y -qq git curl ca-certificates >/dev/null
fi
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || erro "Docker Compose não encontrado. Rode de novo ou instale o pacote docker-compose-plugin."

passo "2/7 Código do sistema ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
echo "Versão: $(git -C "$APP_DIR" log -1 --format='%h %ad' --date=short)"

passo "3/7 Adaptador Zigbee USB"
ADAPTADOR="${ZIGBEE_ADAPTADOR:-$(encontrar_adaptador)}"
[ -n "$ADAPTADOR" ] || erro "Adaptador Zigbee não encontrado em $SERIAL_DIR. Conecte o SONOFF ZBDongle (de preferência num cabo extensor USB) e rode de novo."
TIPO="${ZIGBEE_TIPO:-$(tipo_do_adaptador "$(basename "$ADAPTADOR")")}"
[ -n "$TIPO" ] || erro "Não reconheci o tipo do adaptador ($(basename "$ADAPTADOR")). Rode de novo com ZIGBEE_TIPO=zstack (ZBDongle-P) ou ZIGBEE_TIPO=ember (ZBDongle-E)."
echo "Adaptador: $(basename "$ADAPTADOR") → tipo $TIPO"

passo "4/7 Endereço do painel e token de envio"
mkdir -p "$DADOS"
URL="${ORQ_URL:-}"
TOKEN="${ORQ_INGEST_TOKEN:-}"
if [ -f "$DADOS/coletor.env" ]; then # reinstalação: reaproveita o que já estava salvo
  [ -n "$URL" ] || URL="$(sed -n 's/^ORQ_URL=//p' "$DADOS/coletor.env")"
  [ -n "$TOKEN" ] || TOKEN="$(sed -n 's/^ORQ_INGEST_TOKEN=//p' "$DADOS/coletor.env")"
fi
[ -n "$URL" ] || pergunta "Endereço do painel (ex.: https://orquidario-inteligente.SEU.workers.dev)" URL
[ -n "$TOKEN" ] || pergunta "INGEST_TOKEN (o mesmo cadastrado no GitHub)" TOKEN
URL="${URL%/}"
case "$URL" in https://* | http://localhost:* | http://host.docker.internal:*) ;; *) erro "O endereço precisa começar com https://" ;; esac
[ "${#TOKEN}" -ge 24 ] || erro "INGEST_TOKEN muito curto (mínimo 24 caracteres)."
curl -fsS -m 20 "$URL/api/health" >/dev/null || erro "Não consegui acessar $URL/api/health. Confira o endereço e a internet."
# Corpo vazio: 400 = token aceito (corpo inválido de propósito); 401 = token errado; 503 = servidor sem INGEST_TOKEN.
codigo="$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' --data '{}' "$URL/api/v1/ingest/zigbee" || true)"
case "$codigo" in
  400) echo "Servidor e token conferidos." ;;
  401) erro "O servidor recusou o token. Use o mesmo valor do segredo INGEST_TOKEN do GitHub." ;;
  503) erro "O servidor ainda não tem INGEST_TOKEN. Cadastre o segredo no GitHub e publique de novo." ;;
  *) erro "Resposta inesperada do servidor ($codigo)." ;;
esac
umask 077
cat >"$DADOS/coletor.env" <<EOF
ORQ_URL=$URL
ORQ_INGEST_TOKEN=$TOKEN
EOF
umask 022

passo "5/7 Configuração do Zigbee2MQTT e do Mosquitto"
mkdir -p "$DADOS/mosquitto" "$DADOS/zigbee2mqtt" "$DADOS/coletor"
cat >"$DADOS/mosquitto/mosquitto.conf" <<'EOF'
# Só a rede interna do Docker alcança este servidor (nenhuma porta publicada).
listener 1883
allow_anonymous true
persistence false
log_dest stdout
EOF
Z2M_CONF="$DADOS/zigbee2mqtt/configuration.yaml"
if [ ! -f "$Z2M_CONF" ]; then
  SENHA_Z2M="$(aleatorio 12)"
  cat >"$Z2M_CONF" <<EOF
# Gerado pelo instalador do Orquidário. A chave da rede é criada no primeiro início (GENERATE) e gravada aqui:
# NÃO apague este arquivo (perderia os pareamentos).
version: 5
homeassistant:
  enabled: false
frontend:
  enabled: true
  port: 8080
  auth_token: $SENHA_Z2M
mqtt:
  base_topic: zigbee2mqtt
  server: mqtt://mosquitto:1883
serial:
  port: /dev/zigbee
  adapter: $TIPO
advanced:
  channel: 25
  network_key: GENERATE
  pan_id: GENERATE
  ext_pan_id: GENERATE
  # O coletor exige estes dois valores: cada mensagem traz só o que o sensor acabou de medir, com o horário.
  cache_state: false
  last_seen: ISO_8601
  log_level: info
  log_output:
    - console
EOF
  echo "Configuração nova criada."
else
  # Reinstalação: garante as duas opções de que o coletor depende, sem tocar em chave de rede e pareamentos.
  sed -i -E 's/^(\s*)cache_state:.*/\1cache_state: false/; s/^(\s*)last_seen:.*/\1last_seen: ISO_8601/' "$Z2M_CONF"
  grep -q 'cache_state: false' "$Z2M_CONF" && grep -q 'last_seen: ISO_8601' "$Z2M_CONF" ||
    erro "Não consegui ajustar $Z2M_CONF (cache_state/last_seen). Corrija à mão e rode de novo."
  sed -i -E "s/^(\s*)adapter:.*/\1adapter: $TIPO/" "$Z2M_CONF"
  echo "Configuração existente mantida (pareamentos preservados)."
fi
chown -R 1000:1000 "$DADOS/coletor"
cat >"$DADOS/compose.env" <<EOF
ORQ_DADOS=$DADOS
ZIGBEE_ADAPTADOR=$ADAPTADOR
EOF

passo "6/7 Ajustes do computador"
# Notebook: não dormir com a tampa fechada. Inofensivo no Raspberry Pi.
mkdir -p /etc/systemd/logind.conf.d
printf '[Login]\nHandleLidSwitch=ignore\nHandleLidSwitchExternalPower=ignore\nHandleLidSwitchDocked=ignore\n' >/etc/systemd/logind.conf.d/orquidario.conf
systemctl mask -q sleep.target suspend.target hibernate.target hybrid-sleep.target 2>/dev/null || true
if command -v timedatectl >/dev/null && [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" != "yes" ]; then
  aviso "Relógio ainda não sincronizado pela internet. Ele costuma acertar sozinho em poucos minutos; o painel avisa se ficar errado."
fi
cat >/usr/local/bin/orquidario <<EOF
#!/usr/bin/env bash
# Atalhos: orquidario status | logs | reiniciar | atualizar | senha
C="docker compose --env-file $DADOS/compose.env -f $APP_DIR/coletor/docker-compose.yml"
case "\${1:-status}" in
  status) \$C ps ;;
  logs) \$C logs --tail 100 -f \${2:-} ;;
  reiniciar) \$C restart ;;
  atualizar) [ "\$(id -u)" -eq 0 ] || { echo "use: sudo orquidario atualizar"; exit 1; }; curl -fsSL https://raw.githubusercontent.com/vittormendes94-source/vandas/$BRANCH/coletor/instalar.sh | ORQ_BRANCH=$BRANCH bash ;;
  senha) grep auth_token $DADOS/zigbee2mqtt/configuration.yaml ;;
  *) echo "uso: orquidario status|logs [servico]|reiniciar|atualizar|senha" ;;
esac
EOF
chmod +x /usr/local/bin/orquidario

passo "7/7 Iniciando (Mosquitto, Zigbee2MQTT, coletor)"
COMPOSE=(docker compose --env-file "$DADOS/compose.env" -f "$APP_DIR/coletor/docker-compose.yml")
"${COMPOSE[@]}" pull -q mosquitto zigbee2mqtt
"${COMPOSE[@]}" up -d --build --remove-orphans

echo "Aguardando o Zigbee2MQTT iniciar (até 90 s)…"
ok=""
for _ in $(seq 1 45); do
  if "${COMPOSE[@]}" logs zigbee2mqtt 2>/dev/null | grep -q "Zigbee2MQTT started"; then ok=1; break; fi
  sleep 2
done
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -n "$ok" ]; then
  printf '\n\033[1;32m✔ Tudo funcionando.\033[0m\n'
else
  aviso "O Zigbee2MQTT ainda não confirmou o início. Veja: orquidario logs zigbee2mqtt"
fi
cat <<EOF

Próximos passos:
  1. No navegador (mesma rede): http://${IP:-IP-DESTE-COMPUTADOR}:8080
     Senha da tela: $(grep -E '^\s*auth_token:' "$Z2M_CONF" | awk '{print $2}')
  2. Clique em "Permitir entrada" (Permit join), segure o botão do sensor ~5 s até piscar e aguarde aparecer.
     Renomeie para "Orquidario 1", "Orquidario 2", "Orquidario 3".
  3. No painel ($URL) → Configurações → Sensores: vincule S1, S2 e S3 e salve.

Comandos úteis: orquidario status | orquidario logs | sudo orquidario atualizar
EOF
