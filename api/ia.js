// api/ia.js - endpoint serverless da Vercel
// Recebe um pedido + contexto do app, monta o prompt e chama o OpenRouter.

const SYSTEM_PROMPT = `Você é o assistente pessoal do Saulo dentro do app "Foco - Calendário TDAH".
Você conhece o contexto dele e fala em português do Brasil.

QUEM É O SAULO
- 17 anos, vai fazer 18 em 16/10/2026
- Tem TDAH
- Autodidata
- Fundador da Montalvex
- Atua em Pro Futebol (avalia mudança de foco da empresa)
- Trabalha como prestador de serviço de tráfego pago / marketing digital para qualquer nicho, separado do Pro Futebol
- Está em fase de teste nessa área, possível migração de foco
- Está entrando na faculdade

PLANO ATUAL (janela 15/jul → 16/out/2026)
- Antes de 16/10: estruturar a Montalvex e conseguir cases
- 16/10/2026: abertura do CNPJ (coincide com aniversário de 18 anos)
- Você é copiloto dos 3 blocos: estruturação, cases, faculdade

REGRAS DE COMUNICAÇÃO (do próprio Saulo)
- Formal mas acessível
- Direto, sem rodeio
- Sem gíria
- Sem emoji
- Tom de coach: acolhedor quando ele trava, curto e objetivo quando ele está executando

O QUE VOCÊ PODE FAZER
1. "O que faço agora?" — olhe as tarefas do dia, a hora atual, o status do Pomodoro, as rotinas pendentes e diga UMA ação concreta. Sempre termine com "Toca o timer" ou "Abre a próxima" quando aplicável.
2. Quebrar tarefa em passos — pegue uma tarefa grande e devolva de 3 a 5 passos curtos com tempo estimado em minutos. Cada passo começa com verbo no infinitivo.
3. Triar caixa de entrada — receba uma lista de pensamentos soltos e classifique cada um como: TAREFA, ROTINA, IDEIA ou DESCARTAR. Para TAREFA sugira duração em minutos. Para ROTINA sugira período (manhã/tarde/noite). Saída em uma linha por item, formato: "[TAREFA 30min] responder e-mail do cliente".
4. Reflexão do dia — receba um relato do dia e devolva: (a) o que foi bem, (b) o que travou, (c) UM ajuste concreto para amanhã.

REGRAS DE SAÍDA
- Respostas curtas. Máximo 6 linhas em modo execução, 12 linhas em modo acolhimento.
- Use listas com "-" quando listar mais de 2 itens.
- Termine sempre que possível com uma pergunta ou ação concreta ("E agora?", "Toca o timer?", "Quer que eu quebre essa em passos?").
- NUNCA use emoji.
- NUNCA use gíria.
- Se a informação que ele pede não está no contexto, peça o que falta em UMA frase.`;

function buildUserPrompt(action, context) {
  // Forca timezone do Brasil (Vercel roda em UTC)
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
  const dateStr = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long' });
  const c = context || {};
  const tarefas = (c.tasks || []).map(t => `- ${t.start} | ${t.title} (${t.duration}min) [${t.category}]`).join('\n') || 'nenhuma';
  const inbox = (c.inbox || []).map((s, i) => `${i + 1}. ${s}`).join('\n') || 'vazia';
  const rotinasPendentes = (c.routinesPending || []).map(r => `- [${r.period}] ${r.text}`).join('\n') || 'nenhuma';
  const pomodoro = c.pomodoro || 'parado';
  const foco = c.foco || 'sem registro';

  const base = `CONTEXTO AGORA
- Data/hora: ${dateStr}, ${timeStr}
- Pomodoro: ${pomodoro}
- Foco recente: ${foco}
- Tarefas do dia:
${tarefas}
- Rotinas pendentes:
${rotinasPendentes}
- Caixa de entrada:
${inbox}

`;

  switch (action) {
    case 'now':
      return base + 'O que eu faço agora? Responda em até 6 linhas, com uma ação concreta no fim.';
    case 'break':
      return base + `Quebre esta tarefa em 3 a 5 passos curtos com tempo em minutos: "${c.target || ''}". Responda só com a lista.`;
    case 'triage':
      return base + `Classifique cada item da caixa de entrada. Formato: [TAREFA Xmin] ou [ROTINA período] ou [IDEIA] ou [DESCARTAR] — texto. Um por linha.`;
    case 'reflect':
      return base + `Reflexão do dia, baseada no relato abaixo. Estruture em: (a) o que foi bem, (b) o que travou, (c) UM ajuste para amanhã. Máximo 12 linhas.\n\nRelato: ${c.relato || '(vazio)'}`;
    case 'free':
      return base + `Pedido livre do Saulo: ${c.prompt || ''}`;
    default:
      return base + (c.prompt || '');
  }
}

// Sanitiza inputs do usuario para reduzir prompt injection
function sanitize(text, max) {
  if (typeof text !== 'string') return '';
  if (typeof max !== 'number') max = 500;
  let s = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x09 || code === 0x0A || code === 0x0D) { s += text[i]; continue; }
    if (code >= 0x20 && code !== 0x7F) s += text[i];
  }
  s = s.split('```').join("' ' '");
  s = s.replace(/<\/?[a-z][^>]*>/gi, '');
  return s.slice(0, max).trim();
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY nao configurada no servidor' });

  try {
    const { action, context } = req.body || {};
    // Modelo e fixo no servidor (cliente nao pode trocar)
    const chosenModel = 'google/gemini-2.5-flash-lite';
    // Sanitiza campos de texto livre antes de montar o prompt
    if (context) {
      if (context.prompt) context.prompt = sanitize(context.prompt);
      if (context.target) context.target = sanitize(context.target);
      if (context.relato) context.relato = sanitize(context.relato, 2000);
      if (Array.isArray(context.inbox)) {
        context.inbox = context.inbox.slice(0, 50).map(s => sanitize(s));
      }
    }
    const userPrompt = buildUserPrompt(action, context);

    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://foco-tdah-saulo.vercel.app',
        'X-Title': 'Foco - Calendario TDAH'
      },
      body: JSON.stringify({
        model: chosenModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 600,
        temperature: 0.6
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: 'OpenRouter erro', detail: errText });
    }

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content || '';
    const usage = data.usage || {};
    return res.status(200).json({ reply, model: chosenModel, usage });
  } catch (e) {
    return res.status(500).json({ error: 'Erro interno', detail: String(e) });
  }
};
