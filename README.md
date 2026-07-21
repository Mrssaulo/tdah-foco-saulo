# Foco - Calendário TDAH

PWA pessoal para celular Android, com IA via OpenRouter. Calendário + relógio + Pomodoro + rotinas + captura rápida + assistente.

## Estrutura

```
app-tdah-saulo/
├── index.html
├── styles.css
├── app.js
├── manifest.json
├── sw.js
├── api/
│   └── ia.js              # endpoint serverless (Vercel) - chama OpenRouter
├── vercel.json
├── env.example
├── icons/
│   ├── icon.svg
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

## O que tem na v1.6

- Relógio do dia em anel (verde→amarelo→vermelho)
- Agenda "Agora / Próximo" com barra de progresso
- Pomodoro 25/5/15 acoplado à tarefa
- Rotinas manhã/tarde/noite com reset diário
- Captura rápida + caixa de entrada classificável
- **Alarmes e notificações:**
  - Pomodoro: som + vibração longa + notificação persistente ao terminar
  - Tarefa: avisa 5 minutos antes de começar
  - Rotina: avisa 5 min após o horário (8h, 14h, 21h) se houver itens pendentes
  - Botão "🔔" no topo caso a permissão esteja bloqueada
- **Aba IA com 4 botões + campo livre:**
  - "O que faço agora?"
  - "Quebrar tarefa"
  - "Triar caixa"
  - "Reflexão do dia"
- Backend Vercel chamando OpenRouter (`google/gemini-2.5-flash-lite`)
- IA conhece seu contexto (Montalvex, faculdade, Pro Futebol, regras de comunicação)

## Como publicar (passo a passo)

### 1. Pegar a chave do OpenRouter

1. Acesse https://openrouter.ai e faça login com Google
2. Menu **Keys** → **Create Key** → copie a chave (formato `sk-or-v1-...`)
3. Menu **Credits** → adicione US$5 (dura meses nesse modelo)
4. Me envie a chave aqui (eu guardo no servidor, ela nunca vai para o app)

### 2. Publicar no Vercel (com a chave já configurada)

**Caminho mais fácil (recomendado):**

1. Acesse https://vercel.com e faça login com o mesmo Google
2. Clique em **Add New Project** → **Import Folder** → faça upload da pasta `app-tdah-saulo`
3. Antes de clicar Deploy, abra **Environment Variables** e adicione:
   - Nome: `OPENROUTER_API_KEY`
   - Valor: sua chave `sk-or-v1-...`
4. Clique **Deploy**
5. Em ~1 minuto você recebe um link `https://foco-tdah-saulo.vercel.app`

### 3. Instalar no Android

1. Abra o link no Chrome do celular
2. Menu (3 pontos) → **Instalar app** ou **Adicionar à tela inicial**
3. Ícone "Foco" aparece na gaveta
4. Abre em tela cheia, sem barra de navegador, funciona offline (exceto a aba IA, que precisa de internet)

## Como rodar local (sem IA)

```bash
cd "C:\Users\Agro Legacy\app-tdah-saulo"
npx http-server -p 8080 -c-1
```

Abra `http://localhost:8080`. O app funciona inteiro, **menos a aba IA** (porque não há backend em localhost).

## Custos estimados

- Vercel: grátis (plano hobby)
- OpenRouter `gemini-2.5-flash-lite`: ~US$0.05 por 1M tokens de entrada
- Uso típico: 10 chamadas/dia × 800 tokens = 240k tokens/mês = **centavos de dólar**

## Próximos ajustes sugeridos

- Histórico de conversas com a IA
- Memória entre dias (a IA lembra do que rolou ontem)
- Som ao fim do Pomodoro
- Alarme antes da tarefa começar (notificação do Android)
- Modo claro
- Estatísticas (rotinas completas na semana, % do dia cumprido)
