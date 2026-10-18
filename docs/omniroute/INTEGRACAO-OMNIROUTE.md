# Integração do robô Tome Nota com o OmniRoute

Data: 18/10/2026
Objetivo: trocar o Gemini (fraco) por modelos melhores via OmniRoute, mantendo as travas
do robô e a aprovação humana.

Arquivos desta pasta:
- `SYSTEM-PROMPT-TOMENOTA.txt` — o system prompt completo para colar no OmniRoute;
- `INTEGRACAO-OMNIROUTE.md` — este guia;
- `teste_omniroute.py` — o teste que rodei (fonte fictícia, nada é publicado).

---

## 1. Resumo em 1 minuto

1. O OmniRoute do seu Mac **funciona** com o prompt do jornal: o modelo **Nemotron Ultra
   (NVIDIA)** passou em todas as travas reais do robô.
2. **Porém o robô mora na VPS** e não alcança o seu Mac. Para o robô usar o OmniRoute
   24 horas por dia, o OmniRoute precisa rodar **na VPS** (cabe: sobram cerca de 2,6 GB de
   memória lá).
3. No OmniRoute, você cria um **combo** chamado `tomenota-editorial` e cola o system prompt
   em **"Substituir mensagem do sistema"**.
4. Do lado do robô, falta uma **mudança pequena no código**: ele passa a chamar o OmniRoute
   e volta para o Gemini sozinho se o OmniRoute falhar. Eu faço essa mudança quando você
   autorizar.
5. Nada muda na regra de ouro: **nada é publicado sem a sua aprovação**, e **toda matéria
   precisa de foto real**.

---

## 2. O que eu testei hoje (no seu Mac)

Usei uma fonte fictícia no estilo de nota de prefeitura e passei a resposta do OmniRoute
**pelas mesmas travas que o robô usa na VPS**:
- número inventado é bloqueado;
- é preciso dizer de onde veio a informação ("segundo...");
- as citações de prova têm de ser literais;
- o texto precisa ter de 4 a 12 parágrafos;
- o tamanho precisa estar certo;
- no Radar: 3 títulos, nome da cidade, nenhuma palavra proibida.

| Modelo (pelo OmniRoute) | Escrever matéria | Corrigir a pedido | Recusar fonte fraca | Radar Viral | Tempo |
|---|---|---|---|---|---|
| `nvidia/nvidia/nemotron-3-ultra-550b-a55b` | ✅ passou (170 palavras, 6 parágrafos) | ✅ passou | ✅ 2 de 3 (1 resposta quebrada, que o robô descartaria) | ✅ passou | 5–50 s |
| `nvidia/z-ai/glm-5.3` | ⏱️ estourou o tempo (mais de 4 min) | — | ✅ | ✅ passou | 45–110 s |
| `auto/best-chat` | ❌ todas as contas falharam | | | | |
| `aug/claude-sonnet-4.6` | ❌ resposta vazia | | | | |
| `oc/deepseek-v4-flash-free` | ❌ "modelo indisponível" | | | | |
| `nvidia/moonshotai/kimi-k2.6`, `nvidia/mistralai/mistral-large-2-instruct` | ❌ não liberados na sua conta NVIDIA | | | | |

Conclusões:
- A única conta **com chave** cadastrada no seu OmniRoute é a **NVIDIA**. As outras
  (DuckDuckGo, TheOldLLM, Chipotle, OpenCode grátis, Auggie) são acessos gratuitos não
  oficiais. Elas estavam todas falhando no teste, e não é bom mandar material da redação
  para elas.
- Manchete gerada no teste: *"Prefeitura abre 120 vagas em cursos gratuitos no Pecém"*.
  Depois da correção pedida ("manchete mais curta, destaque o prazo"): *"Inscrições até 31
  de outubro para 120 vagas em cursos gratuitos no Pecém"*.

---

## 3. Como o robô usa a IA hoje (o que vai ser trocado)

O robô chama a IA em **3 situações**. Todas devolvem JSON e todas passam por travas
automáticas depois:

| Situação | Onde fica no código | O que o robô manda | O que espera de volta |
|---|---|---|---|
| Escrever matéria | `news-agent/tnn/autonomous/writer.py` + `editorial.txt` | `{"modo","pauta","fontes":[...]}` | `{slug,titulo,resumo,texto,localidade,capa_hint,evidencias}` ou `{"erro":"fontes_insuficientes"}` |
| Corrigir matéria ("CORRIGIR 12: ...") | mesmo arquivo | o mesmo, mais `"versao_anterior"` e `"correcao_solicitada"` | a matéria inteira de novo, no mesmo formato |
| Radar Viral (ângulo de pauta) | `radar-viral/tnn_viral/editor.py` + `editorial.txt` | `{"fonte":{titulo,trecho,url,data,cidade_detectada},"cidade","correcao"}` | `{eligible:true,gatilho,titulos[3],hook,angulo,potencial,score_justificativa,evidencia}` ou `{"eligible":false}` |

O system prompt novo (`SYSTEM-PROMPT-TOMENOTA.txt`) junta as regras das 3 situações num
só texto. Ele reconhece a tarefa pelos campos que chegam, então serve para tudo com um
único combo. Ele ainda traz duas tarefas extras, para o futuro: `classificar_mensagem`
(entender o que você escreveu no WhatsApp) e `perguntas_ao_editor` (pedir o que falta
quando a pauta está fraca).

---

## 4. Onde o OmniRoute deve rodar

| Opção | Funciona 24h? | Recomendação |
|---|---|---|
| **A. OmniRoute na VPS** (Docker, só acesso interno, mesma rede do robô) | ✅ sim | **Recomendada** |
| B. Túnel da VPS até o seu Mac | ❌ só com o Mac ligado e acordado | Só para teste |
| C. Abrir o OmniRoute do Mac na internet | ⚠️ arriscado | Não fazer |

Opção A, em detalhe:
- **Imagem:** o container oficial `diegosouzapw/omniroute`.
- **Endereço:** ouvindo só dentro da VPS (`127.0.0.1` e a rede interna do Docker). O robô
  acessa em `http://omniroute:20128/v1`.
- **Memória:** limite de 1 GB (usa cerca de 580 MB parado; a VPS tem cerca de 2 GB livres).
- **Dados:** num volume próprio (`omniroute-data`). **Nunca** apagar com `down -v`.
- **Painel:** você abre pelo mesmo túnel das ferramentas, no seu Mac
  (`http://127.0.0.1:20128`). É lá que cadastra a chave NVIDIA e o combo. **Eu não digito
  chave nenhuma.**
- **Acesso:** chave de API do OmniRoute ligada (`REQUIRE_API_KEY=true`). O robô guarda essa
  chave no `.env` dele, nunca no WhatsApp ou no site.

---

## 5. Passo a passo no OmniRoute (você faz no painel)

### 5.1 Criar o combo `tomenota-editorial`

1. Painel do OmniRoute → **Combos** → **Create Combo**.
2. Nome: `tomenota-editorial`.
3. Estratégia: **priority** (tenta na ordem; se um falhar, passa para o próximo).
4. Modelos, nesta ordem:
   1. `nvidia/nvidia/nemotron-3-ultra-550b-a55b` (o melhor no teste);
   2. `nvidia/z-ai/glm-5.3` (reserva lenta);
   3. opcional: um modelo pago oficial, se um dia você quiser (OpenAI, Anthropic ou
      Gemini Pro com chave própria).

   Não coloque no combo do jornal: `ddgw/*`, `tllm/*`, `pepper/*`, `oc/*-free`,
   `veo*`, `auto/*`. São instáveis e não oficiais.
5. **Recursos do agente** → **"Substituir mensagem do sistema"** → cole **todo** o
   conteúdo de `SYSTEM-PROMPT-TOMENOTA.txt` (cerca de 17 mil caracteres; o limite do
   campo é 50 mil).
6. **Compressão:** desligada para este combo, se a opção aparecer. O robô também manda o
   aviso `x-omniroute-compression: off` em toda chamada. **Motivo:** a compressão reescreve
   o texto das fontes, e aí as citações deixam de ser literais. O robô recusa a matéria se
   isso acontecer.
7. Salvar.

Para copiar o prompt no Mac:

```bash
pbcopy < ~/tomezap-servidor/tome/docs/omniroute/SYSTEM-PROMPT-TOMENOTA.txt
```

Depois é só colar (Cmd+V) no campo do combo.

### 5.2 Testar o combo no Mac

```bash
SO_COMBO=1 ~/tomezap-servidor/venv-testes/bin/python ~/tomezap-servidor/tome/docs/omniroute/teste_omniroute.py tomenota-editorial
```

O resultado esperado: quatro linhas "PASSOU", ou "erro: fontes_insuficientes" no teste
da fonte fraca.

### 5.3 Atenção: o "System Prompt global"

O OmniRoute também tem um system prompt **global**, em Configurações, que vale para
**todas** as chamadas: editor de vídeo, Codex, tudo. **Não cole o prompt do jornal ali.**
Use só o campo do combo. Se o global estiver ligado com outro texto, ele se mistura ao do
jornal. O ideal é deixá-lo desligado.

---

## 6. Contrato técnico (para quem for programar)

**Endpoint**

```
POST {OMNIROUTE_URL}/chat/completions        (OMNIROUTE_URL = http://omniroute:20128/v1)
Authorization: Bearer {OMNIROUTE_API_KEY}
Content-Type: application/json
x-omniroute-compression: off
```

**Corpo da requisição** (formato OpenAI)

```json
{
  "model": "tomenota-editorial",
  "stream": false,
  "temperature": 0.3,
  "max_tokens": 8000,
  "response_format": {"type": "json_object"},
  "messages": [
    {"role": "system", "content": "(o combo substitui por SYSTEM-PROMPT-TOMENOTA)"},
    {"role": "user", "content": "{\"modo\":\"fonte_unica_oficial\",\"pauta\":\"...\",\"fontes\":[...]}"}
  ]
}
```

- **Temperatura:** 0.3 para matéria e correção; 0.4 para o Radar.
- **`max_tokens`:** alto, porque modelos que "pensam" gastam tokens antes de responder.
- **Resposta:** em `choices[0].message.content`. Se vier `reasoning_content`, ele é
  **ignorado**.
- **Limpeza:** tirar cercas de Markdown (```` ```json ````) se aparecerem, e depois fazer
  `json.loads`.
- **Fim da resposta:** `finish_reason` diferente de `stop` = resposta inválida → tentar de
  novo uma vez → cair para o Gemini.

**Campos novos que o robô passa a mandar** (porque o combo substitui o system prompt do
robô):
- `"tarefa"`: `redigir_materia` | `corrigir_materia` | `radar_angulo`. Opcional: o prompt
  também reconhece a tarefa pelos campos.
- `"investigativa": true` quando for "pauta a apurar". Hoje essa regra é acrescentada ao
  prompt dentro do robô; com o OmniRoute ela vai no próprio pedido.

**Travas que continuam no robô** (não dependem do modelo e não mudam):
- todo número precisa existir nas fontes;
- precisa haver "segundo/conforme/de acordo com" no texto;
- 4 a 12 parágrafos; 150 a 500 palavras (fonte única ou material da redação) ou 300 a 500
  (várias fontes);
- uma evidência literal por campo e parágrafo, conferida letra por letra;
- Radar: 3 títulos de até 12 palavras, com o nome da cidade, sem números novos e sem
  palavras proibidas;
- foto real obrigatória para aprovar (`WA_REQUIRE_PHOTO`);
- aprovação humana obrigatória para publicar.

**Variáveis novas no robô**

Vão em `news-agent/.env.autonomous` e `radar-viral/.env`, que ficam só na VPS:

```
LLM_PROVIDER=omniroute            # gemini = volta ao que é hoje
OMNIROUTE_URL=http://omniroute:20128/v1
OMNIROUTE_API_KEY=(você cola pelo script, nunca no chat)
OMNIROUTE_MODEL=tomenota-editorial
OMNIROUTE_TIMEOUT=180
OMNIROUTE_MAX_CALLS_PER_DAY=300
LLM_FALLBACK=gemini               # se o OmniRoute falhar, usa o Gemini
```

---

## 7. O que muda no código do robô (eu faço depois do seu OK)

1. **`news-agent/tnn/providers.py`:** nova classe `OmniRoute`, com o mesmo
   `generate(prompt, dados, schema)` do Gemini. Ela:
   - tenta de novo uma vez se a resposta vier quebrada;
   - depois cai para o Gemini;
   - conta as chamadas do dia;
   - nunca grava a chave em log.
2. **`writer.py`:** escolhe o provedor por `LLM_PROVIDER` e manda `"investigativa": true`
   quando for o caso.
3. **`radar-viral/tnn_viral/editor.py`:** a mesma troca, mantendo todas as travas do Radar.
4. **`docker-compose`:** o serviço `omniroute`, só interno, com limite de memória e volume
   próprio. Não mexe nos serviços que já estão lá.
5. **Testes:**
   - os testes atuais continuam passando;
   - novos testes cobrem "OmniRoute respondeu certo", "respondeu quebrado → tentou de
     novo" e "caiu → usou Gemini".
6. **Volta atrás em 10 segundos:** `LLM_PROVIDER=gemini` + reiniciar `redacao` e
   `radar-viral`.

O que **não** muda:
- o Radar privado (`radar-coletor`) e as tabelas dele;
- as regras de segurança do banco (RLS);
- as migrations já aplicadas;
- a regra da foto;
- a aprovação pelo WhatsApp e pelo painel.

---

## 8. Segurança e cuidados

1. **O OmniRoute do seu Mac está aberto na rede, sem senha.** Ele escuta em todas as
   interfaces (porta 20128) e aceitou chamadas sem chave. Qualquer pessoa no mesmo Wi-Fi
   pode usar a sua conta NVIDIA por ele. Resolva assim:
   - painel → **Endpoints** → crie uma chave de API;
   - ligue a opção de exigir chave (`REQUIRE_API_KEY=true`).
2. **Conta NVIDIA grátis:** tem limite de uso e é pensada para testes. Se a NVIDIA limitar
   ou mudar as regras, o combo falha e o robô volta para o Gemini sozinho, sem parar.
3. **Chaves:** a chave NVIDIA fica só no painel do OmniRoute. A chave do OmniRoute fica só
   no `.env` da VPS. Nenhuma das duas vai em WhatsApp, site, GitHub ou conversa.
4. **Provedores não oficiais:** fora do combo do jornal. Material da redação não deve
   passar por eles.
5. **Compressão desligada** no combo do jornal (ver 5.1).

---

## 9. Checklist para ligar

- [ ] Você: proteger o OmniRoute do Mac com chave (item 8.1).
- [x] Autorizado em 18/10 ("pode instalar").
- [x] OmniRoute 3.8.48 na VPS (`omniroute`, painel em `127.0.0.1:18105`, túnel no `abrir-ferramentas.sh`).
- [x] Chave NVIDIA cadastrada no painel da VPS.
- [x] Combo `tomenota-editorial` criado no OmniRoute do **Mac** em 18/10 (prompt + compressão desligada), testado: 4 de 4.
- [x] Combo `tomenota-editorial` criado também na **VPS** (mesmo prompt, compressão desligada).
- [x] Chave `robo-tomenota` gravada no robô com `pbpaste | ssh … /root/tomezap-omniroute-chave.sh`.
- [x] Código `bcf1816` na VPS; teste na VPS só pelo OmniRoute: matéria 23 s, correção 22 s, Radar 5 s.
- [x] `LLM_PROVIDER=omniroute` ligado na redação e no Radar (Gemini de reserva).
- [ ] Teste real: você manda uma pauta no grupo e confere a prévia com foto.
- [ ] Se algo der errado: `LLM_PROVIDER=gemini` e tudo volta ao que era.

---

## 10. Perguntas rápidas

**Posso editar o prompt no OmniRoute depois?**
Pode: tom, estilo, regras de manchete. **Não mude** os nomes dos campos do JSON
(`titulo`, `resumo`, `texto`, `evidencias`...) nem os limites (parágrafos, palavras,
3 títulos). Se mudar, o robô passa a recusar as respostas.

**O OmniRoute vai publicar sozinho?**
Não. Ele só escreve o rascunho. Publicar continua dependendo do seu "APROVAR" com foto real.

**E se eu quiser um modelo mais forte?**
Coloque um modelo pago oficial como primeiro do combo. O robô não precisa mudar nada.
