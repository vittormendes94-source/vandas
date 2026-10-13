# Publicação

Publicar cria o endereço gratuito `https://orquidario-inteligente.<sua-conta>.workers.dev`. Use só o plano gratuito da Cloudflare e **não** ative o "Workers Paid".

Há dois caminhos. O **A** é o recomendado: tudo pelo navegador, sem instalar nada.

## A. Pelo GitHub (recomendado, ~15 min)

A publicação só acontece quando você clica em **Run workflow** e digita `PUBLICAR`. Nenhum push publica nada.

### A1. Cloudflare (uma vez)
1. Crie a conta em **dash.cloudflare.com**.
2. Abra **Workers & Pages** e, se pedir, escolha o **subdomínio** `*.workers.dev`. Ele vira parte do endereço.
3. Copie o **Account ID**: aparece na página inicial da conta, em "Account details", e na lateral de Workers & Pages.
4. Crie um token de API: ícone do perfil → **My Profile → API Tokens → Create Token**.
   - Use o modelo **"Edit Cloudflare Workers"**.
   - Clique em **+ Add more** e acrescente **Account → D1 → Edit**.
   - Em "Account Resources", escolha a sua conta.
   - Em **Create Token**, copie o token. Ele aparece uma vez só.

### A2. Segredos no GitHub (uma vez)
No repositório: **Settings → Secrets and variables → Actions → New repository secret**.

| Nome | Valor | Obrigatório |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Token do passo A1.4 | Sim |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID do passo A1.3 | Sim |
| `ADMIN_TOKEN` | Senha longa sua, com 24+ caracteres. Serve para editar a configuração e conectar o eWeLink | Sim |
| `VIEW_TOKEN` | Outra senha longa, com 24+ caracteres. É a senha de "só ver", usada na TV | Sim |
| `INGEST_TOKEN` | Terceira senha longa, com 24+ caracteres. O coletor do orquidário usa para enviar as leituras; o instalador pede este valor | Sim |
| `EWELINK_APP_ID` | APPID do app em dev.ewelink.cc | Quando o eWeLink aprovar |
| `EWELINK_APP_SECRET` | APP SECRET do mesmo app | Quando o eWeLink aprovar |

**Gerar senhas longas:** use um gerador de senhas, como o do celular ou do gerenciador de senhas, com 32 caracteres e só letras e números. Guarde as três no gerenciador de senhas.

**Opcional:** na aba **Variables**, crie `EWELINK_APP_EXPIRES_AT` com a data `AAAA-MM-DD` de vencimento da credencial anual. O painel avisa 30 dias antes.

### A3. Publicar
1. O arquivo `.github/workflows/publicar.yml` precisa estar na branch **main**. Isso é feito com o merge do pull request.
2. Abra **Actions → Publicar na Cloudflare → Run workflow**, digite `PUBLICAR` e confirme.
3. O processo, de cerca de 3 min:
   - confere os segredos;
   - roda os testes;
   - compila a interface;
   - **cria o banco D1** na primeira vez e aplica as migrações;
   - publica o sistema com os segredos.
4. No resumo da execução aparecem:
   - o **endereço do painel**, que o instalador do coletor pede;
   - o **endereço da TV**;
   - o **endereço de retorno** a cadastrar no app eWeLink.

Os segredos do eWeLink servem só para a bomba e podem vir depois. Quando receber o APPID e o APP SECRET, cadastre os dois segredos e rode **Run workflow** de novo. Os dados não se perdem: o banco é reaproveitado.

## B. Manual, no seu computador

Requisitos: Node.js 22+ e git.

```bash
git clone https://github.com/vittormendes94-source/vandas.git && cd vandas
npm install
npx wrangler login
cd apps/worker
npx wrangler d1 create orquidario        # cole o database_id em wrangler.toml (substitui o placeholder)
npm run db:migrate:remote
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put VIEW_TOKEN
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put EWELINK_APP_ID
npx wrangler secret put EWELINK_APP_SECRET
cd ../.. && npm run build && cd apps/worker && npx wrangler deploy
```

**Opcional:** em `wrangler.toml`, `EWELINK_APP_EXPIRES_AT = "AAAA-MM-DD"`.

## Depois de publicar
1. **Token de administração:** abra o endereço e informe o `ADMIN_TOKEN` em Configurações → "Acesso para editar".
2. **Retorno no app eWeLink:** cadastre `https://<seu-endereço>/api/ewelink/callback`. A tela "Dados e integração" mostra o valor exato. O sistema calcula o retorno sozinho; não há variável para configurar.
3. **Sensores:** rode o instalador do coletor no computador do orquidário ([INSTALACAO.md](INSTALACAO.md)). Em Configurações, vincule S1–S3.
4. **Bomba:** em "Dados e integração", conecte a conta eWeLink. Em Configurações, escolha o Sonoff da bomba.
5. **TV:** abra `https://…/?tv=1&k=<VIEW_TOKEN>`, salve nos favoritos e use a tela cheia. O token da TV só permite ver.
6. **Cotas:** no primeiro dia, confira no painel da Cloudflare o uso de requisições e de linhas do D1 (ver [CUSTOS-E-COTAS.md](CUSTOS-E-COTAS.md)).
