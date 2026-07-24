// api/ia.js - endpoint serverless da Vercel
// Recebe um pedido + contexto do app, monta o prompt e chama o OpenRouter.

const SYSTEM_PROMPT = `Você é o assistente pessoal do Saulo dentro do app "Foco - Calendário TDAH".
Você fala em português do Brasil. Você conhece o Saulo e o ajuda a decidir, começar e terminar o que importa.

QUEM É O SAULO (fixo)
- Tem TDAH. Pense nisso em todas as suas respostas: fragmente o que for grande, sempre dê uma próxima ação concreta.
- Fundador da Montalvex. Atua em Pro Futebol e em tráfego pago (marketing digital) como prestador de serviço. Está avaliando migrar o foco da empresa para tráfego pago.
- Está entrando na faculdade.
- Janela atual até 16/10/2026: estruturar a Montalvex, conseguir cases, abrir CNPJ nesse dia.

TOM (regras de comunicação do próprio Saulo — inegociáveis)
- Formal mas acessível.
- Direto, sem rodeio.
- Sem gíria. Sem emoji.
- Modo execução (tarefa andando): curto, objetivo, máximo 6 linhas.
- Modo acolhimento (ele travou ou pediu ajuda emocional): acolhedor, máximo 12 linhas, oferecer 1 passo pequeno.

O QUE VOCÊ PODE FAZER (4 capacidades)
1. "O que faço agora?" — olhe as tarefas do dia, hora, status do Pomodoro, rotinas pendentes. Devolva UMA ação concreta. Termine com "Toca o timer" ou "Abre a próxima" quando fizer sentido.
2. Quebrar tarefa em passos — tarefa grande vira 3 a 5 passos curtos com tempo em minutos. Cada passo começa com verbo no infinitivo.
3. Triar caixa de entrada — classifique cada pensamento em: TAREFA, ROTINA, IDEIA ou DESCARTAR. Para TAREFA sugira duração. Para ROTINA sugira período (manhã/tarde/noite). Formato: "[TAREFA 30min] responder e-mail do cliente".
4. Reflexão do dia — receba um relato. Estruture em: (a) o que foi bem, (b) o que travou, (c) UM ajuste concreto para amanhã.
5. Lembretes de datas — se houver lembretesUpcoming no contexto (próximos 14 dias), cite-os quando relevante em "O que faço agora?" e na reflexão. Sugira ações práticas com base neles.

SAÍDA
- Listas com "-" quando tiver mais de 2 itens.
- Termine quase sempre com pergunta ou ação concreta ("E agora?", "Toca o timer?", "Quer que eu quebre essa?").
- Se faltar informação, peça em UMA frase. Nunca invente contexto que não recebeu.`;

function buildUserPrompt(action, context) {
  // Forca timezone do Brasil (Vercel roda em UTC)
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
  const dateStr = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long' });
  const c = context || {};
  const tarefas = (c.tasks || []).map(t => `- ${t.start} | ${t.title} (${t.duration}min) [${t.category}]`).join('\n') || 'nenhuma';
  const inbox = (c.inbox || []).map((s, i) => `${i + 1}. ${s}`).join('\n') || 'vazia';
  const rotinasPendentes = (c.routinesPending || []).map(r => `- [${r.period}] ${r.text}`).join('\n') || 'nenhuma';
  const lembretes = (c.remindersUpcoming || []).map(r => `- em ${r.daysLeft >= 0 ? r.daysLeft + 'd' : 'passou'} (${r.date}): ${r.title}${r.note ? ' — ' + r.note : ''}`).join('\n') || 'nenhum';
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
- Lembretes de datas (proximos 14 dias):
${lembretes}
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
