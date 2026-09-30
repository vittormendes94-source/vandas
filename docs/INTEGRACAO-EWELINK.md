# Integração eWeLink

**Estado: implementada conforme a documentação oficial; ainda NÃO testada com uma conta e aparelhos reais.**
Foi testada contra um servidor que reproduz os formatos documentados e confere as assinaturas. O cálculo da assinatura bate com os **vetores de exemplo publicados pelo eWeLink**. A primeira conexão com a sua conta é o teste definitivo.

Fonte: documentação oficial em `github.com/CoolKit-Technologies/eWeLink-API` (`en/OAuth2.0.md`, `en/APICenterV2.md`, `en/UIIDProtocol.md`, `en/Pricing.md`), consultada em 30/09/2026 (última alteração do documento: 14/02/2026).

## O que a documentação oficial garante

| Ponto | Documentação |
|---|---|
| Custo | Desenvolvedor pessoal: gratuito, somente OAuth 2.0, **uma credencial válida por 1 ano**, sem suporte |
| Cota | 50 000 chamadas/mês por região (app gratuito). Estourou → HTTP 403 ou erro 412 até o mês seguinte |
| Frequência | ≥ 500 ms entre chamadas; ≤ 300 chamadas em 5 min por IP |
| Tokens | Acesso: 30 dias. Renovação: 60 dias. `POST /v2/user/refresh` renova os dois |
| Marcas | Liberadas: **Sonoff** e CoolKit (os seus aparelhos são Sonoff) |
| Sensor Zigbee (UIID 1770) | `temperature` e `humidity` = valor × 100; `battery`; **`trigTime` = instante da última medição (ms)** |
| **SNZB-02WD (UIID 7033)** — *não está na documentação oficial* | Valores **diretos** (`"temperature": "22.8"`, `"humidity": "61"`), `trigTime`, `battery`, `subDevRssi`, `parentid` da ponte. Fonte: JSON real de um SNZB-02WD publicado no integrador comunitário SonoffLAN (issues #1612 e #1857) e o mapeamento dele (`core/devices.py`) |
| Liga/desliga | `switch: "on"|"off"` (1 canal) ou `switches[{switch, outlet}]` |
| Online | Cada aparelho vem com `online: true/false` |

## Como o sistema usa

- **Conexão:** feita em "Dados e integração" → "Conectar conta eWeLink". Você entra na **página oficial** do eWeLink, e a senha não passa pelo sistema. O retorno é validado por um código de uso único que vale 10 min.
- **Tokens:** ficam **cifrados** (AES-GCM) no banco. São renovados automaticamente 5 dias antes de vencer, ou na hora, se o eWeLink responder "expirado".
- **Leitura:** a cada 2 min, uma chamada (`GET /v2/device/thing?num=0`) traz todos os aparelhos. São cerca de 21,6 mil chamadas/mês, 43 % da cota.
  - **Proteção da cota:** perto de 46 mil chamadas no mês, a leitura desacelera para 1 a cada 10 min.
- **Sensores:** só grava leitura com `trigTime` válido. Como a chave é (sensor, `trigTime`), consultar de novo a mesma medição não grava nada.
  - **Valores fora da faixa física:** são descartados.
  - **Modelos não documentados:** aparecem como "não suportado" e não são lidos.
- **Bomba:** mostra só o estado atual. "Desconhecido" em três casos: o Sonoff está offline, a leitura parou há mais de 10 min, ou o Sonoff não está vinculado. **Nada da bomba é gravado em histórico** e **nenhum comando é enviado**.
- **Saúde da integração:** a tela mostra a última leitura, o último erro, as falhas seguidas, o uso da cota e a validade dos tokens e da credencial anual.

## Pontos que só o teste real confirma

1. Aprovação do cadastro de desenvolvedor pessoal em **dev.ewelink.cc**.
2. Se o app **pessoal** enxerga os sensores Zigbee da ponte. O integrador comunitário os lê com as credenciais de outro app; a documentação diz que o app pessoal tem acesso a "tipos de dispositivo principais". O SNZB-02WD já é lido no formato UIID 7033, testado com o JSON real publicado. Se aparecer com outro UIID, a tela mostra "Não suportado (UIID X)"; me envie o número.
3. De quanto em quanto tempo o SNZB-02WD atualiza o `trigTime`: ele envia por variação. Ajuste "atualizado/atrasado" em Configurações.
4. Se o login da API convive com o app do celular na mesma conta. A documentação cita o erro 401 "conta logada por outro". Se houver conflito, a solução é uma conta eWeLink só para o sistema, com os aparelhos **compartilhados** para ela. O sistema lê aparelhos compartilhados (`itemType 2`).
5. A região da sua conta (provavelmente `us`, Américas). Ela vem no retorno do login, então não é preciso configurar.

## Passo a passo

1. **dev.ewelink.cc:** cadastro de desenvolvedor pessoal e criação do app.
2. **URL de retorno do app:** `https://<seu-endereço>/api/ewelink/callback`. O mesmo valor vai em `EWELINK_REDIRECT_URL`, no `wrangler.toml`.
3. **Credencial:** `wrangler secret put EWELINK_APP_ID` e `wrangler secret put EWELINK_APP_SECRET`. Anote a data de vencimento (1 ano) em `EWELINK_APP_EXPIRES_AT`.
4. **Conectar:** no sistema, informe o token de administração, depois "Dados e integração" → Conectar.
5. **Vincular:** em Configurações, escolha cada sensor e o Sonoff da bomba na lista.

Quando a credencial anual vencer, crie um app novo, troque os dois segredos e conecte de novo. O painel avisa com 30 dias de antecedência.
