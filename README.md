# Orquidário Inteligente

Monitoramento ambiental de um orquidário de vandas de **12 × 5 m (60 m²)**:
- **Mapas:** temperatura e umidade do ar em 3 sensores SwitchBot Outdoor Meter (cada um mede as duas), com mapas estimados entre os pontos.
- **Gráficos:** média dos sensores com máxima, mínima e média do período.
- **Bomba:** estado atual (ligada/desligada) do Sonoff.
- **Histórico e exportação:** histórico persistente, replay e CSV.
- **Acesso:** link online para TV, celular e computador.

**Somente dados reais.** Não há simulador. Sem leitura, a tela mostra "aguardando". Esta versão só monitora: nenhum comando é enviado aos aparelhos.

## Como os dados chegam

```
3 × Outdoor Meter (IP65) ──Bluetooth──► Hub Mini ──► nuvem SwitchBot ──► API oficial (a cada 2 min) ──┐
                                                                                                        ├─► Cloudflare Worker + D1 ─► painel / TV
Sonoff da bomba ──Wi-Fi──► nuvem eWeLink ──► API oficial (a cada 2 min, só ligada/desligada) ──────────┘
```

Nenhum computador fica ligado no local: o servidor (Cloudflare, gratuito) lê as duas nuvens sozinho.

- **Sensores:** SwitchBot Outdoor Meter (IP65), pela **API oficial SwitchBot**, que documenta esse modelo. Só grava quando o valor muda, e valor parado nunca é "renovado". Ver [docs/INSTALACAO.md](docs/INSTALACAO.md).
- **Bomba:** pela API oficial do eWeLink. Ver [docs/INTEGRACAO-EWELINK.md](docs/INTEGRACAO-EWELINK.md).

## Situação

| Área | Situação |
|---|---|
| Painel: mapas, indicadores, gráficos da média dos 3 sensores, bomba, modo TV | Pronto; verificado em navegador (desktop, celular 360/390 px, tablet, TV 1920×1080 e 1280×720) |
| Sensores SwitchBot: assinatura oficial, lista de aparelhos, leitura a cada 2 min, gravação só quando muda, falhas visíveis, limite diário protegido | Pronto; testado contra um servidor que reproduz a API oficial e confere a assinatura pelo exemplo oficial. **Falta o teste com o kit e a sua conta** |
| Coletor local Zigbee2MQTT (alternativa com computador, **não usada no plano atual**) | Pronto e testado com Mosquitto e Zigbee2MQTT reais em contêiner |
| Bomba pelo eWeLink: OAuth, tokens cifrados e renovados sozinhos, leitura a cada 2 min, cota protegida | Pronta; testada contra um servidor que reproduz a API documentada e com os vetores de assinatura oficiais. **Falta o teste com a conta real** (custo zero) |
| Histórico, replay, lacunas, exportação CSV | Pronto |
| Publicação na Cloudflare | Pronta para rodar pelo botão do GitHub (Actions → Publicar, cria o banco sozinha). Ainda não feita: exige sua conta e seu clique ([docs/PUBLICACAO.md](docs/PUBLICACAO.md)) |

## Início rápido (local)

Requisitos: Node.js ≥ 22.13.

```bash
npm install
npm run setup     # cria apps/worker/.dev.vars com tokens aleatórios e prepara o banco local (vazio)
npm run dev       # compila a interface e abre o servidor em http://localhost:8787
```

- **TV:** `http://localhost:8787/?tv=1`.
- **Conectar o eWeLink localmente:** coloque `EWELINK_APP_ID` e `EWELINK_APP_SECRET` em `apps/worker/.dev.vars` e cadastre `http://localhost:8787/api/ewelink/callback` como retorno no app. O retorno é calculado a partir do endereço aberto. Se o eWeLink exigir HTTPS no retorno, faça a conexão já publicado.

| Comando | O que faz |
|---|---|
| `npm test` | Testes do núcleo (52), do servidor (43) e do coletor (18) |
| `npm run typecheck` | TypeScript nos 3 pacotes |
| `npm run build` | Compila a interface |
| `npm run db:reset:local` | Apaga o banco local |

## Estrutura

```
packages/core   Regras puras e testadas: DPV e ponto de orvalho, IDW, situação dos sensores, média dos sensores,
                estado da bomba, histórico, CSV, fuso horário, validação
apps/worker     Cloudflare Worker + D1: API, integração SwitchBot (sensores) e eWeLink (bomba), tarefa agendada, retenção
apps/web        Interface React: Painel, Histórico, Configurações, Dados e integração
coletor/        Alternativa não usada: coletor local Zigbee2MQTT (exige computador ligado)
docs/           Integração eWeLink, publicação, API, custos e cotas, contrato de leituras, decisões e plano
```

## Garantias contra dado errado

- **Horário real da medição:** a idade de cada leitura vem do `trigTime` informado pelo sensor. Atualizar a tela não "renova" leitura velha.
- **Sensor sem leitura recente:** vira "atrasado" ou "sem comunicação" e sai das médias e do mapa. Com menos de 3 sensores válidos, o mapa não é gerado.
- **Gráficos da média:** só usam intervalos com **todos** os sensores. Se um falhar, o trecho fica em branco, em vez de a média mudar sozinha.
- **Bomba:** "ligada"/"desligada" só aparece com o Sonoff online e leitura de até 10 min. Fora disso, "desconhecido", nunca "desligada".
- **Leituras duplicadas ou fora de ordem:** não geram dado duplicado. Valores fisicamente impossíveis e modelos de sensor não documentados são recusados.
- **Falhas visíveis:** sensor ou hub offline, credencial recusada, limite diário e falha do eWeLink aparecem na tela com o motivo.
- **Leitura nunca "renovada" à toa:** a nuvem SwitchBot não informa o horário da medição, então só se grava leitura quando o valor muda. Se o sensor parar, ele aparece como atrasado e depois sem comunicação.
- **Segredos só no servidor:** tokens do eWeLink cifrados no banco. Registros de erro sem senhas nem tokens.

## Próximos passos

- **Compras:** [docs/COMPRAS.md](docs/COMPRAS.md).
- **Instalação:** [docs/INSTALACAO.md](docs/INSTALACAO.md).
- **Decisões e plano:** [docs/SUGESTOES-E-PLANO.md](docs/SUGESTOES-E-PLANO.md).
