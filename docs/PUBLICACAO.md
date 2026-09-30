# Publicação (manual — exige sua aprovação)

Nada aqui foi executado. Publicar cria um endereço gratuito `https://orquidario-inteligente.<sua-conta>.workers.dev`. Use só o plano gratuito da Cloudflare e **não** ative o "Workers Paid".

## 1. Conta e ferramenta
```bash
npm install
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
npx wrangler secret put ADMIN_TOKEN          # edita configuração e conecta o eWeLink
npx wrangler secret put VIEW_TOKEN           # recomendado: exige token para ver o painel (TV usa ?k=…)
npx wrangler secret put EWELINK_APP_ID       # do app em dev.ewelink.cc
npx wrangler secret put EWELINK_APP_SECRET
```
Gere tokens longos: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.

## 4. Variáveis em `apps/worker/wrangler.toml`
- `EWELINK_REDIRECT_URL = "https://orquidario-inteligente.<sua-conta>.workers.dev/api/ewelink/callback"`: cadastre o mesmo valor no app eWeLink.
- `EWELINK_APP_EXPIRES_AT = "AAAA-MM-DD"`: vencimento da credencial anual, para o aviso antecipado.

## 5. Build e deploy
```bash
cd ../..
npm run build
cd apps/worker && npx wrangler deploy
```

## 6. Depois
1. **Token de administração:** abra o endereço e informe o token em Configurações → "Acesso para editar".
2. **eWeLink:** em "Dados e integração", conecte a conta. Em Configurações, vincule os sensores e o Sonoff da bomba.
3. **TV:** abra `https://…/?tv=1&k=<VIEW_TOKEN>`, salve nos favoritos e use a tela cheia. O token da TV só permite ler.
4. **Cotas:** confira no painel da Cloudflare, no primeiro dia, o uso de requisições e de linhas do D1 (ver [CUSTOS-E-COTAS.md](CUSTOS-E-COTAS.md)).
