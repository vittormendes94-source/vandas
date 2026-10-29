# Orquidário Inteligente — guia completo, passo a passo

Endereço do painel: **https://orquidario-inteligente.vittormendes94.workers.dev**

Em todo o guia:
- **SENHA_TV** = o valor do segredo `VIEW_TOKEN`;
- **SENHA_ADMIN** = o valor do segredo `ADMIN_TOKEN`.

Os dois estão em GitHub → repositório `vandas` → Settings → Secrets and variables → Actions.

---

## 0. O que já está pronto (não precisa fazer nada)

- Painel no ar, sem computador ligado no local, com 3 visões:
  - **Visão TV** (para sua mãe);
  - **Painel completo**;
  - **Histórico**.
- Leitura automática a cada 20 min dos sensores SwitchBot (e uma conferência pouco antes de cada irrigação). Token e Secret já estão cadastrados.
- Clima de **Patrocínio, MG**: lá fora agora e os próximos 7 dias (azul = chuva provável; laranja = sol/calor).
- Mapa de calor e de umidade da estufa inteira (12 × 5 m), calculado a partir da posição de cada sensor.
- Regras de irrigação: padrão **não irrigar acima de 30 °C** na estufa nem com **sol direto acima de 500 W/m²**.
- Automação da bomba:
  - liga nos horários;
  - desliga após **5 min**;
  - desliga se sair das regras;
  - configura o Sonoff para desligar sozinho (Inching).

  Ela **só começa a agir quando o eWeLink for conectado** (parte 4).
- Registro de todas as irrigações e de todas as ações automáticas (Histórico).

---

## 1. Sensores SwitchBot (fazer agora)

### 1.1 Hub Mini
1. Instale o app **SwitchBot** (Play Store ou App Store) e entre na sua conta. Precisa ser **a mesma conta** de onde saíram o Token e o Secret.
2. Ligue o Hub Mini na tomada com o cabo e a fonte USB que vieram com ele.
3. Escolha o lugar do Hub:
   - **dentro do alcance do Wi-Fi** e o mais perto possível do orquidário;
   - os sensores falam com o Hub por Bluetooth: ideal **até ~15 m** sem paredes grossas, no máximo ~30 m em campo aberto.
4. No app: **"+" → Adicionar dispositivo → Hub Mini**. Siga a tela.
5. Escolha a rede **Wi-Fi de 2,4 GHz**. Ele **não funciona em 5 GHz**.

**O que esperar:** o Hub aparece no app como "online".

**Se der errado:**
- **Não conecta:** confira se a rede é 2,4 GHz. Se o roteador usa o mesmo nome para 2,4 e 5 GHz e falhar, separe as redes nas configurações do roteador.
- **Fica "offline":** o Wi-Fi não chega até ele. Aproxime do roteador ou use um repetidor.

### 1.2 Os 3 sensores (Outdoor Meter)
1. Abra a tampa e **puxe a lingueta plástica** das pilhas.
2. No app: **"+" → Termo-higrômetro / Outdoor Meter**. Aproxime o celular do sensor e siga a tela.
3. Dê nomes: **Início**, **Meio**, **Fundo** (ou como preferir).
4. Em cada sensor: toque nele → **engrenagem** → **Serviço de nuvem (Cloud Service)** → **LIGAR**.
   - **Sem isso o painel não recebe nada.** É o erro mais comum.
5. Confira se cada sensor está ligado ao Hub Mini. Normalmente o app faz isso sozinho.

**O que esperar:** no app, cada sensor mostra temperatura e umidade em poucos segundos.

**Se der errado:**
- **Sensor não aparece no app:** tire e recoloque as pilhas e aproxime o celular.
- **No app aparece, no painel não:** confira o Serviço de nuvem (passo 4) e espere 5 min.

### 1.3 Instalar na estufa
- Sugestão de posições: **Início**, **Meio** e **Fundo**, espalhados (não alinhados), na **altura das plantas**, **na sombra**.
- Nunca deixe o sensor no sol direto: a leitura fica mais quente que o ar.
- Meça com uma trena a posição de cada um, a partir do **canto superior esquerdo** da planta da estufa:
  - **x** = metros ao longo dos **12 m**;
  - **y** = metros ao longo dos **5 m**.

---

## 2. Configurar o painel (no computador)

1. Abra `https://orquidario-inteligente.vittormendes94.workers.dev/?k=SENHA_TV`.
2. Menu **Configurações** → quadro **"Acesso para editar"** → cole a **SENHA_ADMIN** → **Desbloquear edição**.
   - Marque "Lembrar neste dispositivo" **só** no seu computador, nunca na TV.
3. Menu **Dados e integração** → no quadro do SwitchBot, clique **"↻ Ler agora"**.
   - **Esperado:** os 3 sensores aparecem na lista "Dispositivos".
4. Volte em **Configurações** → quadro **Sensores**:
   - em cada linha (S1, S2, S3), no campo **"Sensor deste ponto"**, escolha o sensor certo;
   - coloque o **nome** e a posição **x / y** em metros (ou arraste no desenho);
   - desmarque **"Provisória"**.
5. **Aspersores:** arraste ou digite a posição real de cada aspersor (só desenho).
6. **Bomba (Sonoff):** "Tempo de cada irrigação" = **5 min**. O Sonoff só aparece depois da parte 4.
7. **Regras de irrigação:**
   - padrão: 30 °C e 500 W/m²;
   - "Período a evitar" é opcional (ex.: 10:00 às 16:00);
   - deixar um campo em branco desativa aquela regra.
8. **Automação da bomba:**
   - modo **Automático**;
   - em **"+ Adicionar horário"**, coloque os horários de irrigação (ex.: 07:00 e 17:00);
   - os outros campos podem ficar no padrão: tentar por até 180 min, intervalo de 60 min, máximo 8 por dia, não irrigar com chuva;
   - mantenha marcado **"Configurar o Sonoff para desligar sozinho"**.
9. **Limites de alerta** (servem para as cores e para o "Atenção" da TV). Sugestão inicial para Vanda:
   - temperatura **mín 16, máx 32 °C**;
   - umidade **mín 60, máx 85 %**;
   - ajuste com a sua experiência.
10. **Cidade:** já está Patrocínio. Para trocar, digite o nome → Buscar → escolha a cidade.
11. Clique **"Salvar alterações"**, no rodapé.
    - **Esperado:** "Configuração salva".

**O que esperar depois:** em até 5–10 min a Visão TV mostra os valores, o mapa colorido e "Fundo X° mais quente que Início". O gráfico de 24 h vai se formando ao longo do dia. A seta de tendência aparece depois de ~1 h de leituras.

**Se der errado:**
- **"Token de administração ausente ou inválido":** a SENHA_ADMIN foi digitada errada. Copie de novo.
- **Sensores não aparecem no menu:** faça o passo 3 de novo e confira o Serviço de nuvem.
- **TV mostra "aguardando" por mais de 30 min:** veja o quadro do SwitchBot em **Dados e integração**. Ele mostra o último erro em português.

---

## 3. TV da sua mãe

1. Abra o navegador da TV (Smart TV, Chromecast, Fire TV ou computador ligado na TV).
2. Digite: `https://orquidario-inteligente.vittormendes94.workers.dev/?tv=1&k=SENHA_TV`
3. Salve nos **favoritos** e, se der, deixe em **tela cheia**.
4. Nas configurações da TV, desative **proteção de tela** e **desligamento automático**.
5. Ela não precisa fazer nada: a tela se atualiza sozinha.

**Como ler a TV:**
- **Faixa de cima:** "Tudo certo" (verde), "Atenção" (amarelo) ou alerta (vermelho), mais o clima lá fora.
- **Temperatura e umidade:** número grande, tendência, mapa da estufa e gráfico de 24 h.
- **Coluna de irrigação:**
  - bomba ligada/desligada;
  - **"Pode irrigar agora?"**;
  - horários de hoje: ✓ feito, adiada, pulada;
  - últimas irrigações.
- **Rodapé:** próximos 7 dias.

**Alertas vermelhos e o que fazer:**

| Mensagem | O que fazer |
|---|---|
| "Sem notícias dos sensores há …" | Confira se o Hub está na tomada e se a internet do local está funcionando. |
| "Bomba ligada há X min" | O tempo passou. O sistema já tenta desligar; confira no local. |
| "Irrigando fora das regras" | O sistema desliga em até 2 min. Se continuar, confira no local. |
| "Não consegui desligar a bomba" | **Vá até a bomba.** O Sonoff ou a internet caiu. |
| "Bomba: sem informação" | Sonoff sem internet. Confira a tomada e o Wi-Fi do Sonoff. |

---

## 4. Bomba e automação (quando o eWeLink aprovar)

1. Quando chegar o e-mail de aprovação, entre em **dev.ewelink.cc** com a sua conta eWeLink.
2. Crie o app (tipo **OAuth 2.0**). No campo **Redirect URL**, cole **exatamente**:
   `https://orquidario-inteligente.vittormendes94.workers.dev/api/ewelink/callback`
3. Copie o **APP ID** e o **APP SECRET**.
4. No GitHub (repositório `vandas` → Settings → Secrets and variables → Actions → **New repository secret**), crie:
   - `EWELINK_APP_ID` = APP ID;
   - `EWELINK_APP_SECRET` = APP SECRET;
   - opcional: `EWELINK_APP_EXPIRES_AT` = data de validade (AAAA-MM-DD), para o painel avisar antes de vencer.
5. **Publique** (parte 6).
6. No painel: **Dados e integração** → **"Conectar conta eWeLink"**.
   - Abre a página oficial do eWeLink. Entre com a **mesma conta do app eWeLink** onde está o Sonoff e autorize.
   - **Esperado:** volta ao painel com "conectado".
7. **Configurações → Bomba (Sonoff)** → escolha o Sonoff da bomba → **Salvar alterações**.

**O que esperar (em até 2–4 min):**
- TV: "Bomba desligada" e cartão **"Irrigação automática"** com bolinha verde.
- **Histórico → Ações automáticas:** "Configurou o desligamento automático … ok". O Sonoff passa a desligar sozinho em 5 min.

**Teste seguro (faça uma vez, perto da bomba):**
1. Em Automação, adicione um horário **3 min à frente** do relógio e salve.
2. No horário, a bomba **liga**. Em ~5 min ela **desliga sozinha**.
3. Confira em **Histórico → Ações automáticas** e **Irrigações**.
4. Remova o horário de teste.
5. **Apague os timers do app eWeLink**, senão a bomba irriga duas vezes. Se preferir manter os timers do app, use o modo **"Só proteção"**.

**Se der errado:**
- **Erro de "redirect" na página do eWeLink:** o Redirect URL do app está diferente. Copie de novo, igual ao passo 2.
- **Erro 407 / sem permissão:** o app eWeLink ainda não foi aprovado ou ativado.
- **Sonoff não aparece em Configurações:** ele precisa estar na mesma conta eWeLink que você conectou. Use "Ler agora" em Dados e integração.
- **Ação automática "falhou: … device offline":** o Sonoff está sem internet. O sistema tenta de novo sozinho.
- **"Configurou o desligamento automático" com falha:** configure à mão no app eWeLink. Abra o Sonoff → configurações → **Inching** → **300 segundos**.

---

## 5. Segurança (recomendado)

As senhas foram escritas no chat, então troque:
1. GitHub → Secrets → edite `ADMIN_TOKEN` e `VIEW_TOKEN` (cada uma com **24 caracteres ou mais**).
2. Publique (parte 6).
3. Na TV, abra o link de novo com a **nova SENHA_TV**.

---

## 6. Publicar sozinho (sem precisar do Claude)

Faça isso sempre que mudar um segredo no GitHub:
1. GitHub → repositório `vandas` → aba **Actions** → **"Publicar na Cloudflare"** → **Run workflow**.
2. Digite `PUBLICAR` → **Run workflow**.
3. Espere ~2 min até ficar **verde ✓**.
   - **Se ficar vermelho** com "assets-upload-session" ou "unknown error": é instabilidade da Cloudflare. Abra a execução → **Re-run failed jobs**.
4. Seus dados e configurações **não se perdem** ao publicar.

---

## 7. Limites que é bom saber

- **Horários das irrigações:** precisão de ~2 min, porque a bomba é lida a cada 2 min. O desligamento em 5 min exato é feito pelo próprio Sonoff (Inching).
- **Clima e sol:** são **previsão do Open-Meteo para a cidade**, não medição na estufa.
- **Sensores sem leitura:** a regra de temperatura não é avaliada. A automação segue os horários usando sol e horário, e nunca liga sem confirmar o estado da bomba.
- **eWeLink:** o comando de ligar/desligar foi testado com um simulador da API oficial. A **primeira conexão real** é o teste definitivo (por isso o "teste seguro" da parte 4).
- **Cotas grátis** (sobram com folga):
  - SwitchBot: 10.000 chamadas por dia (o sistema usa ~720);
  - eWeLink: 50.000 por mês (o sistema usa ~22.000);
  - Cloudflare: plano gratuito.
