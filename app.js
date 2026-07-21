// ===== Foco - Calendário TDAH =====
// Estado + persistência local (localStorage simples para v1)

const STORAGE_KEY = 'foco-tdah-v1';

const defaultState = {
  tasks: [],          // { id, title, startMinutes, durationMin, category, dateKey }
  routines: {         // itens por período
    morning: [],
    afternoon: [],
    evening: [],
  },
  routineDone: {},    // { 'YYYY-MM-DD::morning::itemId': true }
  inbox: [],          // { id, text, createdAt }
  pomodoro: { mode: 'focus', totalSec: 25 * 60, remainingSec: 25 * 60, running: false, taskId: null },
  lastResetDate: null,
};

let state = loadState();
let timerInterval = null;
let clockInterval = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(defaultState), ...parsed, pomodoro: { ...defaultState.pomodoro, ...(parsed.pomodoro || {}) } };
  } catch (e) {
    return structuredClone(defaultState);
  }
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function minutesNow() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function formatMin(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ===== Render: relógio do dia =====
const DAY_START_MIN = 6 * 60;   // 06:00
const DAY_END_MIN = 24 * 60;    // 24:00 (meia-noite)
const RING_CIRCUM = 2 * Math.PI * 88;

function renderDayRing() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const pct = clamp((mins - DAY_START_MIN) / (DAY_END_MIN - DAY_START_MIN), 0, 1);
  const offset = RING_CIRCUM * (1 - pct);
  const fill = document.getElementById('dayRingFill');
  fill.style.strokeDashoffset = offset;
  document.getElementById('dayPercent').textContent = Math.round(pct * 100) + '%';
  const left = Math.max(0, DAY_END_MIN - mins);
  document.getElementById('dayTimeLeft').textContent = `${Math.floor(left / 60)}h${String(left % 60).padStart(2, '0')} restantes`;
  // cor por faixa
  let color = '#6c8cff';
  if (pct < 0.3) color = '#4ade80';
  else if (pct < 0.7) color = '#6c8cff';
  else if (pct < 0.9) color = '#fbbf24';
  else color = '#f87171';
  fill.style.stroke = color;
}

// ===== Render: tarefas (Agora / Próximo) =====
function todaysTasks() {
  const key = todayKey();
  return state.tasks
    .filter(t => t.dateKey === key)
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

function renderAgenda() {
  const list = todaysTasks();
  const now = minutesNow();
  const current = list.find(t => now >= t.startMinutes && now < t.startMinutes + t.durationMin);
  const next = list.filter(t => t.startMinutes > now).slice(0, 5);
  const cur = document.getElementById('currentTask');
  if (current) {
    const elapsed = now - current.startMinutes;
    const pct = clamp(elapsed / current.durationMin, 0, 1);
    cur.classList.remove('empty');
    cur.innerHTML = `
      <div class="ct-info">
        <div class="ct-title"></div>
        <div class="ct-meta"></div>
        <div class="ct-bar"><span style="width:${pct * 100}%"></span></div>
      </div>
      <span class="nl-cat cat-${current.category}">${current.category}</span>
    `;
    cur.querySelector('.ct-title').textContent = current.title;
    const endMin = current.startMinutes + current.durationMin;
    cur.querySelector('.ct-meta').textContent = `${formatMin(current.startMinutes)} → ${formatMin(endMin)} • ${current.durationMin} min`;
  } else {
    cur.classList.add('empty');
    cur.innerHTML = '<div class="empty-state">Nada por agora. Toque em <strong>+ Tarefa</strong>.</div>';
  }
  const nextEl = document.getElementById('nextTasks');
  nextEl.innerHTML = '';
  next.forEach(t => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="nl-time">${formatMin(t.startMinutes)}</span>
      <span class="nl-title"></span>
      <span class="nl-cat cat-${t.category}">${t.category}</span>
    `;
    li.querySelector('.nl-title').textContent = t.title;
    li.addEventListener('click', () => openTaskModal(t.id));
    nextEl.appendChild(li);
  });
}

// ===== Modal de tarefa =====
function openTaskModal(id) {
  const modal = document.getElementById('taskModal');
  const title = document.getElementById('taskModalTitle');
  const del = document.getElementById('taskDelete');
  const form = document.getElementById('taskForm');
  form.reset();
  if (id) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    title.textContent = 'Editar tarefa';
    del.classList.remove('hidden');
    document.getElementById('taskTitle').value = t.title;
    document.getElementById('taskStart').value = formatMin(t.startMinutes);
    document.getElementById('taskDuration').value = t.durationMin;
    document.getElementById('taskCategory').value = t.category;
    form.dataset.editId = id;
  } else {
    title.textContent = 'Nova tarefa';
    del.classList.add('hidden');
    const d = new Date();
    d.setMinutes(d.getMinutes() + 5);
    document.getElementById('taskStart').value = formatMin(d.getHours() * 60 + d.getMinutes());
    form.dataset.editId = '';
  }
  modal.classList.remove('hidden');
}
function closeTaskModal() { document.getElementById('taskModal').classList.add('hidden'); }

function saveTaskFromForm(e) {
  e.preventDefault();
  const form = e.target;
  const title = document.getElementById('taskTitle').value.trim();
  const start = document.getElementById('taskStart').value;
  const duration = parseInt(document.getElementById('taskDuration').value, 10);
  const category = document.getElementById('taskCategory').value;
  if (!title || !start || !duration) return;
  const [h, m] = start.split(':').map(Number);
  const startMinutes = h * 60 + m;
  const editId = form.dataset.editId;
  if (editId) {
    const t = state.tasks.find(x => x.id === editId);
    if (t) Object.assign(t, { title, startMinutes, durationMin: duration, category });
  } else {
    state.tasks.push({ id: uid(), title, startMinutes, durationMin: duration, category, dateKey: todayKey() });
  }
  saveState();
  closeTaskModal();
  renderAll();
}
function deleteCurrentTask() {
  const id = document.getElementById('taskForm').dataset.editId;
  if (!id) return;
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveState();
  closeTaskModal();
  renderAll();
}

// ===== Pomodoro =====
function openPomodoro() {
  document.getElementById('pomodoroModal').classList.remove('hidden');
  updatePomodoroLabel();
  renderPomodoro();
}
function closePomodoro() {
  document.getElementById('pomodoroModal').classList.add('hidden');
}
function setPomodoroMode(mode) {
  const map = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
  state.pomodoro.mode = mode;
  state.pomodoro.totalSec = map[mode];
  state.pomodoro.remainingSec = map[mode];
  state.pomodoro.running = false;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  renderPomodoro();
  saveState();
}
function updatePomodoroLabel() {
  const now = minutesNow();
  const list = todaysTasks();
  const current = list.find(t => now >= t.startMinutes && now < t.startMinutes + t.durationMin);
  if (current) {
    state.pomodoro.taskId = current.id;
    document.getElementById('pomodoroTaskLabel').textContent = `Em: ${current.title}`;
  } else {
    const next = list.find(t => t.startMinutes > now);
    if (next) {
      state.pomodoro.taskId = next.id;
      document.getElementById('pomodoroTaskLabel').textContent = `Próxima: ${next.title}`;
    } else {
      state.pomodoro.taskId = null;
      document.getElementById('pomodoroTaskLabel').textContent = 'Sem tarefa vinculada';
    }
  }
  saveState();
}
function renderPomodoro() {
  const { remainingSec, running, mode } = state.pomodoro;
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
  const ss = String(remainingSec % 60).padStart(2, '0');
  document.getElementById('pomodoroTime').textContent = `${mm}:${ss}`;
  document.getElementById('pomodoroStart').classList.toggle('hidden', running);
  document.getElementById('pomodoroPause').classList.toggle('hidden', !running);
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}
function togglePomodoro() {
  if (state.pomodoro.running) {
    state.pomodoro.running = false;
    clearInterval(timerInterval);
    timerInterval = null;
  } else {
    state.pomodoro.running = true;
    timerInterval = setInterval(tickPomodoro, 1000);
  }
  saveState();
  renderPomodoro();
}
function tickPomodoro() {
  if (state.pomodoro.remainingSec > 0) {
    state.pomodoro.remainingSec--;
    saveState();
    renderPomodoro();
    if (state.pomodoro.remainingSec === 0) {
      state.pomodoro.running = false;
      clearInterval(timerInterval);
      timerInterval = null;
      const isFocus = state.pomodoro.mode === 'focus';
      window.FocoAlarm?.fireAlarm(
        isFocus ? 'Pomodoro concluido' : 'Pausa encerrada',
        isFocus ? 'Hora da pausa. Levanta, bebe agua, respira.' : 'Hora de voltar ao foco. Toca o timer.',
        { tag: 'pomodoro-done', vibrate: [400, 150, 400, 150, 800] }
      );
      saveState();
      renderPomodoro();
    }
  }
}
function resetPomodoro() {
  state.pomodoro.running = false;
  clearInterval(timerInterval);
  timerInterval = null;
  const map = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
  state.pomodoro.remainingSec = map[state.pomodoro.mode];
  saveState();
  renderPomodoro();
}

// ===== Rotinas =====
function renderRoutines() {
  ['morning', 'afternoon', 'evening'].forEach(period => {
    const ul = document.getElementById('routine' + capitalize(period));
    ul.innerHTML = '';
    const items = state.routines[period] || [];
    const key = todayKey() + '::' + period;
    items.forEach(item => {
      const done = !!state.routineDone[key + '::' + item.id];
      const li = document.createElement('li');
      li.className = 'routine-item' + (done ? ' done' : '');
      li.innerHTML = `
        <button class="ri-check" aria-label="Marcar"></button>
        <span class="ri-text"></span>
        <button class="ri-remove" aria-label="Remover">×</button>
      `;
      li.querySelector('.ri-text').textContent = item.text;
      li.querySelector('.ri-check').addEventListener('click', () => {
        const k = key + '::' + item.id;
        if (state.routineDone[k]) delete state.routineDone[k];
        else state.routineDone[k] = true;
        saveState();
        renderRoutines();
      });
      li.querySelector('.ri-remove').addEventListener('click', () => {
        state.routines[period] = state.routines[period].filter(x => x.id !== item.id);
        saveState();
        renderRoutines();
      });
      ul.appendChild(li);
    });
    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'routine-item';
      li.style.justifyContent = 'center';
      li.style.color = 'var(--muted)';
      li.textContent = 'Vazio. Toque em + Item.';
      ul.appendChild(li);
    }
  });
}
function addRoutineItem() {
  const text = prompt('Adicionar item de rotina:');
  if (!text || !text.trim()) return;
  const periods = ['morning', 'afternoon', 'evening'];
  const nowH = new Date().getHours();
  let period = 'morning';
  if (nowH >= 12 && nowH < 18) period = 'afternoon';
  else if (nowH >= 18) period = 'evening';
  const choice = prompt('Período (manhã / tarde / noite):', period);
  const map = { 'manhã': 'morning', 'manha': 'morning', 'morning': 'morning', 'tarde': 'afternoon', 'afternoon': 'afternoon', 'noite': 'evening', 'evening': 'evening' };
  period = map[(choice || '').toLowerCase()] || period;
  state.routines[period].push({ id: uid(), text: text.trim() });
  saveState();
  renderRoutines();
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ===== Inbox / Captura =====
function openCapture() {
  document.getElementById('captureModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('captureText').focus(), 100);
}
function closeCapture() { document.getElementById('captureModal').classList.add('hidden'); }
function saveCapture(e) {
  e.preventDefault();
  const text = document.getElementById('captureText').value.trim();
  if (!text) return;
  state.inbox.unshift({ id: uid(), text, createdAt: Date.now() });
  document.getElementById('captureText').value = '';
  saveState();
  renderInbox();
  closeCapture();
}
function renderInbox() {
  document.getElementById('inboxCount').textContent = state.inbox.length;
  const ul = document.getElementById('inboxList');
  ul.innerHTML = '';
  if (state.inbox.length === 0) {
    const li = document.createElement('li');
    li.style.justifyContent = 'center';
    li.style.color = 'var(--muted)';
    li.textContent = 'Caixa vazia.';
    ul.appendChild(li);
    return;
  }
  state.inbox.forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="in-text"></span>
      <div class="in-actions">
        <button class="in-btn">→ Tarefa</button>
        <button class="in-btn danger">Excluir</button>
      </div>
    `;
    li.querySelector('.in-text').textContent = item.text;
    li.querySelector('.in-btn:not(.danger)').addEventListener('click', () => {
      // converter em tarefa agora
      const d = new Date();
      d.setMinutes(d.getMinutes() + 5);
      state.tasks.push({ id: uid(), title: item.text.slice(0, 80), startMinutes: d.getHours() * 60 + d.getMinutes(), durationMin: 25, category: 'pessoal', dateKey: todayKey() });
      state.inbox = state.inbox.filter(x => x.id !== item.id);
      saveState();
      renderAll();
    });
    li.querySelector('.in-btn.danger').addEventListener('click', () => {
      state.inbox = state.inbox.filter(x => x.id !== item.id);
      saveState();
      renderInbox();
    });
    ul.appendChild(li);
  });
}

// ===== Tabs =====
function setTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.getElementById('routinesPanel').classList.toggle('hidden', name !== 'routines');
  document.getElementById('inboxPanel').classList.toggle('hidden', name !== 'inbox');
  document.getElementById('iaPanel').classList.toggle('hidden', name !== 'ia');
  // Em telas pequenas, esconde o relógio + agenda quando outras tabs estão ativas
  const small = window.innerWidth < 720;
  if (small) {
    document.querySelector('.time-card').classList.toggle('hidden', name !== 'agenda');
    document.querySelector('.agenda-card').classList.toggle('hidden', name !== 'agenda');
    document.querySelector('.actions-card').classList.toggle('hidden', name !== 'agenda');
  }
}

// ===== Reset diário das rotinas =====
function checkDailyReset() {
  const today = todayKey();
  if (state.lastResetDate !== today) {
    // limpa conclusões antigas
    Object.keys(state.routineDone).forEach(k => { if (!k.startsWith(today)) delete state.routineDone[k]; });
    state.lastResetDate = today;
    saveState();
  }
}

// ===== Render geral =====
function renderAll() {
  checkDailyReset();
  renderDayRing();
  renderAgenda();
  renderRoutines();
  renderInbox();
  updatePomodoroLabel();
  renderPomodoro();
}

// ===== IA - monta contexto e chama o endpoint =====
function buildIaContext() {
  const list = todaysTasks();
  const now = minutesNow();
  const tasks = list.map(t => {
    const status = (now >= t.startMinutes && now < t.startMinutes + t.durationMin) ? 'em andamento' :
                   (t.startMinutes > now ? 'futura' : 'passada');
    return {
      start: formatMin(t.startMinutes),
      title: t.title,
      duration: t.durationMin,
      category: t.category,
      status
    };
  });
  const inbox = state.inbox.map(i => i.text);
  // rotinas pendentes
  const routinesPending = [];
  ['morning', 'afternoon', 'evening'].forEach(period => {
    const items = state.routines[period] || [];
    const key = todayKey() + '::' + period;
    items.forEach(item => {
      if (!state.routineDone[key + '::' + item.id]) {
        routinesPending.push({ period, text: item.text });
      }
    });
  });
  // pomodoro
  let pomodoro = 'parado';
  if (state.pomodoro.running) {
    const m = Math.floor(state.pomodoro.remainingSec / 60);
    const s = state.pomodoro.remainingSec % 60;
    pomodoro = `rodando (${state.pomodoro.mode}, faltam ${m}:${String(s).padStart(2, '0')})`;
  }
  return { tasks, inbox, routinesPending, pomodoro };
}

async function callIa(action, extra) {
  const statusEl = document.getElementById('iaStatus');
  const replyEl = document.getElementById('iaReply');
  statusEl.textContent = 'pensando';
  replyEl.classList.remove('hidden', 'error');
  replyEl.classList.add('loading');
  replyEl.textContent = 'Aguarde, pensando...';
  try {
    const r = await fetch('/api/ia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, context: { ...buildIaContext(), ...(extra || {}) } })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro ' + r.status);
    replyEl.classList.remove('loading');
    replyEl.textContent = data.reply || '(sem resposta)';
    statusEl.textContent = 'pronto';
  } catch (e) {
    replyEl.classList.remove('loading');
    replyEl.classList.add('error');
    replyEl.textContent = 'Erro: ' + (e.message || e) + '\n\nDica: a IA só funciona depois que o app estiver publicado (HTTPS) com a chave configurada no servidor.';
    statusEl.textContent = 'erro';
  }
}

// ===== Bind eventos =====
function bindEvents() {
  document.getElementById('newTaskBtn').addEventListener('click', () => openTaskModal());
  document.getElementById('taskModalClose').addEventListener('click', closeTaskModal);
  document.getElementById('taskForm').addEventListener('submit', saveTaskFromForm);
  document.getElementById('taskDelete').addEventListener('click', deleteCurrentTask);

  document.getElementById('pomodoroBtn').addEventListener('click', openPomodoro);
  document.getElementById('pomodoroClose').addEventListener('click', closePomodoro);
  document.getElementById('pomodoroStart').addEventListener('click', togglePomodoro);
  document.getElementById('pomodoroPause').addEventListener('click', togglePomodoro);
  document.getElementById('pomodoroReset').addEventListener('click', resetPomodoro);
  document.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => setPomodoroMode(b.dataset.mode)));

  document.getElementById('captureBtn').addEventListener('click', openCapture);
  document.getElementById('captureClose').addEventListener('click', closeCapture);
  document.getElementById('captureForm').addEventListener('submit', saveCapture);

  document.getElementById('routinesBtn').addEventListener('click', () => setTab('routines'));
  document.getElementById('inboxBtn').addEventListener('click', () => setTab('inbox'));
  document.getElementById('addRoutineBtn').addEventListener('click', addRoutineItem);

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

  // IA
  document.querySelectorAll('.ia-btn').forEach(b => {
    b.addEventListener('click', () => {
      const action = b.dataset.action;
      if (action === 'now') return callIa('now');
      if (action === 'triage') {
        if (state.inbox.length === 0) {
          const replyEl = document.getElementById('iaReply');
          replyEl.classList.remove('hidden', 'error');
          replyEl.classList.add('loading');
          replyEl.textContent = 'Caixa vazia. Capture algumas ideias primeiro.';
          setTimeout(() => replyEl.classList.remove('loading'), 1500);
          return;
        }
        return callIa('triage', { inbox: state.inbox.map(i => i.text) });
      }
      if (action === 'reflect') {
        const relato = prompt('Como foi o dia? (segue, sem pressa)');
        if (!relato) return;
        return callIa('reflect', { relato });
      }
      if (action === 'break') {
        const target = prompt('Qual tarefa você quer quebrar em passos?');
        if (!target) return;
        return callIa('break', { target });
      }
    });
  });
  document.getElementById('iaForm').addEventListener('submit', e => {
    e.preventDefault();
    const prompt = document.getElementById('iaPrompt').value.trim();
    if (!prompt) return;
    document.getElementById('iaPrompt').value = '';
    callIa('free', { prompt });
  });

  // fechar modal tocando fora
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });
  });
}

// ===== Inicialização =====
function tickClock() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  document.getElementById('clock').textContent = `${hh}:${mm}`;
}

function updateNotifButton() {
  const btn = document.getElementById('notifBtn');
  if (!btn) return;
  const supported = 'Notification' in window;
  if (!supported) { btn.classList.add('hidden'); return; }
  if (Notification.permission === 'granted') { btn.classList.add('hidden'); return; }
  btn.classList.remove('hidden');
  btn.textContent = Notification.permission === 'denied' ? '🔕' : '🔔';
  btn.title = Notification.permission === 'denied' ? 'Notificações bloqueadas. Toque para saber como liberar.' : 'Ativar notificações';
}

async function handleNotifButton() {
  if (!('Notification' in window)) {
    alert('Seu navegador não suporta notificações.');
    return;
  }
  if (Notification.permission === 'denied') {
    alert('Notificações estão bloqueadas no navegador. Para ativar:\n\n1. Toque no cadeado/configurações ao lado da URL\n2. Permissões → Notificações → Permitir\n3. Volte aqui e atualize a página');
    return;
  }
  await window.FocoAlarm?.ensureNotificationPermission();
  updateNotifButton();
}

function init() {
  bindEvents();
  renderAll();
  tickClock();
  updateNotifButton();
  window.FocoAlarm?.cleanOldAlerts();
  // Pede permissao de notificacao no primeiro uso (sem bloqueio se negado)
  if (Notification && Notification.permission === 'default') {
    setTimeout(() => {
      window.FocoAlarm?.ensureNotificationPermission().then(updateNotifButton);
    }, 2000);
  }
  document.getElementById('notifBtn')?.addEventListener('click', handleNotifButton);
  clockInterval = setInterval(() => {
    tickClock();
    renderDayRing();
    renderAgenda();
    updatePomodoroLabel();
    if (window.FocoAlarm) {
      window.FocoAlarm.checkUpcomingTasks(state.tasks, a => window.FocoAlarm.fireAlarm(a.title, a.body, { tag: a.tag }));
      window.FocoAlarm.checkRoutines(state.routines, state.routineDone, a => window.FocoAlarm.fireAlarm(a.title, a.body, { tag: a.tag }));
    }
  }, 30 * 1000);

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
