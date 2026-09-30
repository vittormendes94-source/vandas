# Orquidário Inteligente

Monitoramento ambiental de um orquidário de vandas de **12 × 5 m (60 m²)**:
- **Mapas:** temperatura e umidade do ar em 3 sensores SONOFF, com mapas estimados entre os pontos.
- **Gráficos:** média dos sensores com máxima, mínima e média do período.
- **Bomba:** estado atual (ligada/desligada) do Sonoff.
- **Histórico e exportação:** histórico persistente, replay e CSV.
- **Acesso:** link online para TV, celular e computador.

**Somente dados reais.** Não há simulador. Sem leitura, a tela mostra "aguardando". Esta versão só monitora: nenhum comando é enviado aos aparelhos.

## Como os dados chegam

```
SNZB-02WD (Zigbee) ─► ponte ─┐
                             ├─► nuvem eWeLink ─► API oficial (OAuth, 1 leitura a cada 2 min) ─► Cloudflare Worker + D1 ─► painel / TV
Sonoff da bomba (Wi-Fi) ─────┘
```

A integração segue a documentação oficial do eWeLink e ainda precisa do teste com a sua conta. Veja [docs/INTEGRACAO-EWELINK.md](docs/INTEGRACAO-EWELINK.md) (inclui o que foi e o que não foi verificado).

## Situação

| Área | Situação |
|---|---|
| Painel: mapas, indicadores, gráficos da média dos 3 sensores, bomba, modo TV | Pronto; verificado em navegador (desktop, celular 360/390 px, tablet, TV 1920×1080 e 1280×720) |
| Integração eWeLink: OAuth, tokens cifrados e renovados sozinhos, leitura a cada 2 min, cota protegida, lista de aparelhos para vincular | Pronta; testada contra um servidor que reproduz a API documentada e com os vetores de assinatura oficiais. **Falta o teste com a conta real** |
| Histórico, replay, lacunas, exportação CSV | Pronto |
| Publicação na Cloudflare | Não feita: exige sua conta e sua aprovação ([docs/PUBLICACAO.md](docs/PUBLICACAO.md)) |

## Início rápido (local)

Requisitos: Node.js ≥ 22.13.

```bash
npm install
npm run setup     # cria apps/worker/.dev.vars com tokens aleatórios e prepara o banco local (vazio)
npm run dev       # compila a interface e abre o servidor em http://localhost:8787
```

- **TV:** `http://localhost:8787/?tv=1`.
- **Conectar o eWeLink localmente:** coloque `EWELINK_APP_ID` e `EWELINK_APP_SECRET` em `apps/worker/.dev.vars` e cadastre `http://localhost:8787/api/ewelink/callback` como retorno no app. Se o eWeLink exigir HTTPS no retorno, faça a conexão já publicado.

| Comando | O que faz |
|---|---|
| `npm test` | Testes do núcleo (52) e do servidor (29) |
| `npm run typecheck` | TypeScript nos 3 pacotes |
| `npm run build` | Compila a interface |
| `npm run db:reset:local` | Apaga o banco local |

## Estrutura

```
packages/core   Regras puras e testadas: DPV e ponto de orvalho, IDW, situação dos sensores, média dos sensores,
                estado da bomba, histórico, CSV, fuso horário, validação
apps/worker     Cloudflare Worker + D1: API, integração eWeLink, tarefa agendada, retenção, migração
apps/web        Interface React: Painel, Histórico, Configurações, Dados e integração
docs/           Integração eWeLink, publicação, API, custos e cotas, contrato de leituras, decisões e plano
```

## Garantias contra dado errado

- **Horário real da medição:** a idade de cada leitura vem do `trigTime` informado pelo sensor. Atualizar a tela não "renova" leitura velha.
- **Sensor sem leitura recente:** vira "atrasado" ou "sem comunicação" e sai das médias e do mapa. Com menos de 3 sensores válidos, o mapa não é gerado.
- **Gráficos da média:** só usam intervalos com **todos** os sensores. Se um falhar, o trecho fica em branco, em vez de a média mudar sozinha.
- **Bomba:** "ligada"/"desligada" só aparece com o Sonoff online e leitura de até 10 min. Fora disso, "desconhecido", nunca "desligada".
- **Leituras duplicadas ou fora de ordem:** não geram dado duplicado. Valores fisicamente impossíveis e modelos de sensor não documentados são recusados.
- **Falhas visíveis:** falha na integração (token, cota, rede) aparece na tela com o motivo. O uso da cota do eWeLink e a validade da credencial anual ficam visíveis.
- **Segredos só no servidor:** tokens do eWeLink cifrados no banco. Registros de erro sem senhas nem tokens.

## Próximos passos

Instalação completa, com lista de compras: [docs/INSTALACAO.md](docs/INSTALACAO.md). Plano de menor risco: [docs/SUGESTOES-E-PLANO.md](docs/SUGESTOES-E-PLANO.md). O primeiro passo é publicar e conectar o eWeLink usando o **Sonoff da bomba, que você já tem**. Só depois disso compre 1 sensor e 1 ponte.
