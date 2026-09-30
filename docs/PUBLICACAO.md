# Publicação (manual — exige sua aprovação)

Nada aqui foi executado. Publicar coloca o sistema num endereço público `*.workers.dev`. **Sem `VIEW_TOKEN`, qualquer pessoa com o endereço vê os dados.** Não use nenhum plano pago; conferir no painel da Cloudflare que a conta está no plano gratuito.

## 1. Conta e ferramenta
```bash
npx wrangler login            # abre o navegador; nenhuma cobrança
```

## 2. Banco D1
```bash
cd apps/worker
npx wrangler d1 create orquidario
# copie o database_id retornado para apps/worker/wrangler.toml (substitui o placeholder)
npm run db:migrate:remote
```

## 3. Segredos (nunca no repositório)
```bash
npx wrangler secret put ADMIN_TOKEN     # grava configuração
npx wrangler secret put INGEST_TOKEN    # dispositivos/integrações enviam leituras
npx wrangler secret put VIEW_TOKEN      # recomendado: exige token para ver o painel
```
Use valores longos e aleatórios (`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`).

## 4. Variáveis
Em `wrangler.toml` `[vars]`: `DEMO_ENABLED = "false"` (recomendado em produção real) e `DEFAULT_DATASET = "real"`. Para publicar **só a demonstração**, mantenha `"true"`/`"demo"` e semeie: `npm run db:seed:demo -- --remote` (uma vez, ~17 mil linhas escritas).

## 5. Build e deploy
```bash
cd ../..
npm run build
cd apps/worker && npx wrangler deploy
```
O endereço sairá como `https://orquidario-inteligente.<sua-conta>.workers.dev`. TV: `https://…/?tv=1&k=<VIEW_TOKEN>` (favorite; o token só permite ler).

## 6. Depois
- Confirme no painel as cotas de [CUSTOS-E-COTAS.md](CUSTOS-E-COTAS.md) e observe o uso no primeiro dia.
- Se não quiser a tarefa agendada, remova `[triggers]` de `wrangler.toml` (a retenção diária passa a ser manual: `POST /api/admin/maintenance`).
- Para conectar equipamentos: [INTEGRACAO-EWELINK.md](INTEGRACAO-EWELINK.md) e [SUGESTOES-E-PLANO.md](SUGESTOES-E-PLANO.md).
