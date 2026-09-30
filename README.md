# Orquidário Inteligente

Monitoramento ambiental de um orquidário de **12 × 5 m (60 m²)**: temperatura e umidade relativa do ar em 3 pontos, dois mapas estimados, planta da irrigação, histórico persistente, replay, exportação CSV, modo TV.

> **Estado atual: demonstração funcional + API de ingestão pronta para dados reais.**
> Nenhum sensor está integrado ainda. A integração com o eWeLink **não foi validada** e **não está implementada** (ver [docs/INTEGRACAO-EWELINK.md](docs/INTEGRACAO-EWELINK.md)). Esta versão é **somente de monitoramento**: não envia comandos a nenhum equipamento.

## O que existe

| Área | Situação |
|---|---|
| Interface em pt-BR, tema escuro (verde/ciano), responsiva, modo TV + tela cheia | Funciona; verificado em navegador (desktop, 390/360 px, tablet, TV 1920×1080 e 1280×720) |
| Mapas de temperatura e UR (Canvas, IDW p=2, 12 × 5 m, escala fixa, área extrapolada hachurada, cobertura insuficiente) | Funciona |
| Planta da irrigação (6 aspersores ilustrativos, estados ligado/desligado/sem comunicação) | Funciona; simulação de estado só na demonstração e só visual |
| Indicadores: médias, maior/menor, diferença entre pontos, extremos do período, DPV e ponto de orvalho por sensor, contagem atualizados/atrasados/sem comunicação, bateria/sinal só se fornecidos | Funciona |
| Histórico 24 h / 7 d / 30 d / personalizado, sobreposição da irrigação, lacunas, CSV | Funciona |
| Replay (linha do tempo, ▶/⏸, velocidade, horário, voltar ao vivo) e comparação antes/depois | Funciona |
| Backend Cloudflare Worker + D1 (histórico persistente, agregação horária, retenção) | Funciona no `workerd` local com D1 local |
| Ingestão HTTP (`/api/v1/ingest/*`) idempotente, com validação e autenticação | Funciona e testada |
| Integração eWeLink | **Pendente** (esqueleto explícito, nenhuma chamada de rede) |
| Publicação na Cloudflare | **Não feita** (exige sua aprovação) |
| Comandos à bomba | **Não implementado** por escopo |

## Início rápido (local)

Requisitos: Node.js ≥ 22.13 e npm.

```bash
npm install
npm run setup        # cria apps/worker/.dev.vars (tokens aleatórios), aplica migrações no D1 local, gera 10 dias simulados
npm run dev          # compila a interface e sobe o Worker em http://localhost:8787
```

- Modo demonstração: `http://localhost:8787/` — TV: `http://localhost:8787/?tv=1` — dados reais: `http://localhost:8787/?modo=real`.
- O `npm run setup` imprime o `ADMIN_TOKEN` (para editar configurações) e o `INGEST_TOKEN`. Ficam só em `apps/worker/.dev.vars` (ignorado pelo git).
- Para ver o **modo real** com dados de exemplo: `node scripts/send-sample-readings.mjs` (ou `--stale` para simular sensor atrasado/sem comunicação). Esses valores são inventados; use só localmente.
- Desenvolvimento da interface com HMR: em outro terminal `npm run dev:web` (http://localhost:5173, encaminha `/api` ao Worker).
- Zerar o estado local: `npm run db:reset:local && npm run setup`.

### Comandos

| Comando | O que faz |
|---|---|
| `npm test` | Testes do núcleo (66) e do backend (29) |
| `npm run typecheck` | TypeScript nos 3 pacotes |
| `npm run build` | Compila a interface para `apps/web/dist` |
| `npm run db:migrate:local` | Aplica as migrações no D1 local |
| `npm run db:seed:demo [-- --reset]` | Gera o histórico simulado (10 dias) no D1 local |

## Estrutura

```
packages/core   Regras puras e testadas: psicrometria (DPV, orvalho), IDW/casco convexo, frescor, snapshot,
                irrigação, comparação antes/depois, simulador determinístico, CSV, tempo/fuso, validação (zod)
apps/worker     Cloudflare Worker (Hono) + D1: API, ingestão, autenticação, retenção, adaptadores, migrações, seed
apps/web        React + TypeScript + Vite: painel, histórico, configurações, dados e integração
docs/           API, contrato de leituras, custos e cotas, eWeLink, publicação, sugestões e plano
examples/       Sketch de ESP32 (NÃO testado em hardware)
scripts/        setup local, reset, leituras de exemplo
```

## Como o sistema trata os dados

- **Demonstração × real** ficam separados (`dataset` em todas as tabelas, configurações independentes). O simulador só grava em `demo`; a ingestão só grava em `real`. O modo real **nunca** usa dados simulados como reserva: sem leituras, mostra “sem dados”.
- **Dois horários**: `measured_at` (da origem, se informado) e `received_at` (recebimento). A idade de uma leitura vem sempre da medição; atualizar a tela **não** a renova. O “agora” usado nas idades é o do servidor.
- **Situação do sensor**: atualizado (≤ limite), atrasado, sem comunicação. Só os atualizados entram em médias e mapas; se houver menos de 3 pontos não colineares, o mapa não é gerado.
- **Duplicidade e desordem**: chave `(sensor, instante da medição)`; mensagens fora de ordem entram no histórico sem substituir a “última leitura”.
- **UTC no banco, America/Sao_Paulo na tela.**
- Fórmulas e métodos: tela “Dados e integração” e [docs/API.md](docs/API.md#fórmulas).

## Segurança

- Três tokens **só no servidor**: `ADMIN_TOKEN` (grava configuração), `INGEST_TOKEN` (envia leituras), `VIEW_TOKEN` opcional (leitura; a URL da TV leva `?k=…`; só permite ler). Modelo em `apps/worker/.dev.vars.example` (sem segredos). Sem `ADMIN_TOKEN`/`INGEST_TOKEN`, as rotas correspondentes respondem 503.
- **Sem `VIEW_TOKEN`, a leitura é aberta a quem tiver o endereço.** Defina-o antes de publicar dados reais.
- Erros são registrados sem tokens/senhas (`redact`, testado). Cabeçalhos de segurança e CSP em `apps/web/public/_headers`.

## Próximos passos e pendências

Veja [docs/SUGESTOES-E-PLANO.md](docs/SUGESTOES-E-PLANO.md) (alternativas de sensores e plano por fases com critérios de decisão), [docs/INTEGRACAO-EWELINK.md](docs/INTEGRACAO-EWELINK.md) e [docs/PUBLICACAO.md](docs/PUBLICACAO.md).

## O que foi verificado e o que não foi

**Executado nesta entrega:** testes automatizados (núcleo e backend com SQLite real), typecheck, build, `wrangler dev` com D1 local, chamadas HTTP reais à API, teste ponta a ponta em Chromium (replay, histórico, comparação, exportação CSV, edição de configuração com token correto/errado, modo real vazio e com sensores atrasados), verificação de rolagem horizontal e de altura da TV.

**Não executado / depende de você:** publicação na Cloudflare e conferência das cotas no painel; qualquer teste com sensores, ponte Zigbee ou Sonoff reais; validação da API do eWeLink; medição de CPU por requisição no ambiente gratuito real (limite de 10 ms, ver [docs/CUSTOS-E-COTAS.md](docs/CUSTOS-E-COTAS.md)); teste do sketch de ESP32.
