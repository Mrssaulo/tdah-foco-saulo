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
  reminders: [],      // { id, title, dateKey, note, source, createdAt }
  pomodoro: { mode: 'focus', totalSec: 25 * 60, remainingSec: 25 * 60, running: false, taskId: null },
  lastResetDate: null,
  // taskDone: { 'YYYY-MM-DD::taskId': true } — concluídas hoje
  taskDone: {},
  // IA: histórico de conversas (últimas N sessões) + memória curta entre dias
  iaHistory: [],      // [{ id, startedAt, action, prompt, reply }]
  iaMemory: [],       // [{ dateKey, summary, tipo, createdAt }]
  // Gamificação
  xp: 0,              // XP total acumulado
  badges: [],         // ['streak-7', 'pomo-10', 'task-50', etc]
  lastActiveDate: null, // YYYY-MM-DD do último acesso (pra calcular streak)
  xpToday: { date: null, amount: 0 }, // XP ganho hoje (reseta à meia-noite)
};

// Limites
const IA_HISTORY_MAX = 30;       // sessões guardadas no app
const IA_HISTORY_CONTEXT = 5;    // últimas enviadas à IA
const IA_MEMORY_MAX = 7;         // dias de memória curta

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

// ===== Gamificação: XP, nível, streak, badges =====
const XP_REWARDS = {
  task: 15,           // concluir tarefa
  routine: 8,         // item de rotina marcado
  pomodoro: 25,       // pomodoro de foco concluído
  reflect: 30,        // fazer reflexão do dia
  capture: 5,         // capturar na caixa
  firstVisit: 10,     // primeira ação do dia
};
const LEVELS = [
  { level: 1,  xpRequired: 0,    title: 'Iniciante' },
  { level: 2,  xpRequired: 50,   title: 'Aprendiz' },
  { level: 3,  xpRequired: 150,  title: 'Dedicado' },
  { level: 4,  xpRequired: 350,  title: 'Focado' },
  { level: 5,  xpRequired: 700,  title: 'Disciplinado' },
  { level: 6,  xpRequired: 1200, title: 'Centrado' },
  { level: 7,  xpRequired: 2000, title: 'Imparável' },
  { level: 8,  xpRequired: 3200, title: 'Mestre do Foco' },
  { level: 9,  xpRequired: 5000, title: 'Lendário' },
  { level: 10, xpRequired: 8000, title: 'Transcendente' },
];
const BADGES_DEF = [
  { id: 'first-step',     icon: '🌱', name: 'Primeiro passo',         desc: 'Ganhou XP pela primeira vez',          check: s => s.xp >= 10 },
  { id: 'streak-3',       icon: '🔥', name: '3 dias seguidos',        desc: 'Usou o Foco 3 dias seguidos',         check: s => s.streak >= 3 },
  { id: 'streak-7',       icon: '🔥', name: 'Uma semana inteira',     desc: '7 dias seguidos usando o Foco',       check: s => s.streak >= 7 },
  { id: 'streak-30',      icon: '��', name: '30 dias seguidos',       desc: 'Um mês sem quebrar a sequência',     check: s => s.streak >= 30 },
  { id: 'pomo-1',         icon: '🍅', name: 'Primeiro pomodoro',      desc: 'Concluiu 1 pomodoro de foco',         check: s => s.pomoCount >= 1 },
  { id: 'pomo-10',        icon: '🍅', name: '10 pomodoros',           desc: 'Concluiu 10 pomodoros de foco',       check: s => s.pomoCount >= 10 },
  { id: 'pomo-50',        icon: '🏅', name: '50 pomodoros',           desc: 'Concluiu 50 pomodoros de foco',       check: s => s.pomoCount >= 50 },
  { id: 'task-10',        icon: '✅', name: '10 tarefas cumpridas',   desc: 'Marcou 10 tarefas como concluídas',   check: s => s.taskCount >= 10 },
  { id: 'task-50',        icon: '✅', name: '50 tarefas cumpridas',   desc: 'Marcou 50 tarefas como concluídas',   check: s => s.taskCount >= 50 },
  { id: 'routine-week',   icon: '☀️', name: 'Rotina completa',        desc: 'Marcou todos os itens de uma rotina', check: s => s.fullRoutines >= 1 },
  { id: 'reflect-1',      icon: '🪞', name: 'Primeira reflexão',       desc: 'Fez a primeira reflexão do dia',      check: s => s.reflectCount >= 1 },
  { id: 'reflect-7',      icon: '🪞', name: '7 reflexões',            desc: 'Fez 7 reflexões do dia',              check: s => s.reflectCount >= 7 },
  { id: 'level-5',        icon: '⭐', name: 'Nível 5',                desc: 'Chegou ao nível 5',                   check: s => s.level >= 5 },
  { id: 'level-10',       icon: '👑', name: 'Nível 10',               desc: 'Chegou ao nível máximo',              check: s => s.level >= 10 },
];

function levelFromXp(xp) {
  let lvl = LEVELS[0];
  for (const l of LEVELS) { if (xp >= l.xpRequired) lvl = l; }
  return lvl;
}
function xpForNextLevel(xp) {
  const cur = levelFromXp(xp);
  const idx = LEVELS.findIndex(l => l.level === cur.level);
  const next = LEVELS[idx + 1];
  if (!next) return { current: xp - cur.xpRequired, needed: 0, done: true, pct: 1, cur, next: null };
  const current = xp - cur.xpRequired;
  const needed = next.xpRequired - cur.xpRequired;
  return { current, needed, done: false, pct: clamp(current / needed, 0, 1), cur, next };
}

// Recalcula streak (precisa do lastActiveDate salvo)
function computeStreak() {
  const last = state.lastActiveDate;
  const today = todayKey();
  if (!last) return 0;
  const [y, m, d] = last.split('-').map(Number);
  const lastD = new Date(y, m - 1, d); lastD.setHours(0,0,0,0);
  const todayD = new Date(); todayD.setHours(0,0,0,0);
  const diffDays = Math.round((todayD - lastD) / 86400000);
  if (diffDays === 0) {
    // Mesmo dia, mantém o streak atual (campo derivado não persistido, inferido de quantos dias consecutivos foram ativos — usamos lastStreakCount)
    return state.streak || 1;
  }
  if (diffDays === 1) {
    // Voltou no dia seguinte → streak + 1
    return (state.streak || 0) + 1;
  }
  // Pulou dias: streak reinicia em 1 (porque ele tá ativo hoje)
  return 1;
}

// Conta quantos pomodoros / tarefas / reflexões já foram concluídos na história
function computeAggregateCounts() {
  const pomoCount = (state.pomodoroLog || []).filter(p => p.kind === 'pomodoro').length;
  // taskCount = chaves únicas já marcadas como done (inclui repetições entre dias, mas queremos total de conclusões)
  const taskCount = Object.keys(state.taskDone || {}).length;
  const reflectCount = (state.iaMemory || []).filter(m => m.tipo === 'reflect').length
                     + (state.iaHistory || []).filter(h => h.action === 'reflect').length;
  // Rotinas completas: dias em que todos os itens de uma rotina foram cumpridos
  let fullRoutines = 0;
  ['morning','afternoon','evening'].forEach(period => {
    const items = state.routines[period] || [];
    if (items.length === 0) return;
    const itemIds = new Set(items.map(it => it.id));
    // Conta ocorrências por dia
    const byDay = {};
    Object.keys(state.routineDone || {}).forEach(k => {
      const parts = k.split('::');
      if (parts.length !== 3) return;
      const dk = parts[0];
      const per = parts[1];
      const itId = parts[2];
      if (per === period && itemIds.has(itId)) {
        byDay[dk] = byDay[dk] || new Set();
        byDay[dk].add(itId);
      }
    });
    Object.values(byDay).forEach(setIds => {
      if (setIds.size === items.length) fullRoutines++;
    });
  });
  return { pomoCount, taskCount, reflectCount, fullRoutines };
}

function playerState() {
  const lvl = levelFromXp(state.xp || 0);
  const streak = computeStreak();
  const agg = computeAggregateCounts();
  return { level: lvl.level, title: lvl.title, xp: state.xp || 0, streak, ...agg };
}

// Marca presença do dia de hoje (chamado uma vez por dia)
function registerPresence() {
  const today = todayKey();
  if (state.lastActiveDate !== today) {
    // Verifica se é dia consecutivo
    const last = state.lastActiveDate;
    let newStreak = 1;
    if (last) {
      const [y, m, d] = last.split('-').map(Number);
      const lastD = new Date(y, m - 1, d); lastD.setHours(0,0,0,0);
      const todayD = new Date(); todayD.setHours(0,0,0,0);
      const diff = Math.round((todayD - lastD) / 86400000);
      if (diff === 1) newStreak = (state.streak || 0) + 1;
      else if (diff === 0) newStreak = state.streak || 1;
      else newStreak = 1;
    }
    state.streak = newStreak;
    state.lastActiveDate = today;
    state.xpToday = { date: today, amount: 0 };
    // Bonus diário de presença
    addXp(XP_REWARDS.firstVisit, 'Presença', null);
  }
}

function addXp(amount, label, originEl) {
  const before = state.xp || 0;
  state.xp = before + amount;
  // marca no xp de hoje
  if (!state.xpToday || state.xpToday.date !== todayKey()) {
    state.xpToday = { date: todayKey(), amount: 0 };
  }
  state.xpToday.amount += amount;
  saveState();
  // checa level up
  const beforeLvl = levelFromXp(before).level;
  const afterLvl = levelFromXp(state.xp).level;
  if (afterLvl > beforeLvl) onLevelUp(beforeLvl, afterLvl);
  // checa novos badges
  checkBadges();
  // UI
  renderPlayer();
  // flutua "+XP" perto do botão que deu origem
  if (originEl) floatXp(amount, label, originEl);
}

function floatXp(amount, label, originEl) {
  const layer = document.getElementById('fxLayer');
  if (!layer) return;
  const rect = originEl.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'xp-float';
  el.innerHTML = `<span class="xf-amt">+${amount}</span><span class="xf-lbl">${label}</span>`;
  el.style.left = (rect.left + rect.width / 2) + 'px';
  el.style.top = (rect.top + window.scrollY) + 'px';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function onLevelUp(prev, next) {
  const layer = document.getElementById('fxLayer');
  if (!layer) return;
  const lvl = LEVELS.find(l => l.level === next);
  // overlay
  const overlay = document.createElement('div');
  overlay.className = 'levelup-overlay';
  overlay.innerHTML = `
    <div class="lu-burst"></div>
    <div class="lu-card">
      <div class="lu-icon">⚡</div>
      <div class="lu-pre">Subiu de nível!</div>
      <div class="lu-lvl">${prev} → ${next}</div>
      <div class="lu-title">${lvl ? lvl.title : ''}</div>
    </div>
  `;
  layer.appendChild(overlay);
  // confete
  burstConfetti(40);
  setTimeout(() => overlay.remove(), 2400);
}

function burstConfetti(n) {
  const layer = document.getElementById('fxLayer');
  if (!layer) return;
  const colors = ['#6c8cff', '#a78bfa', '#fbbf24', '#4ade80', '#f472b6', '#22d3ee'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = (Math.random() * 100) + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = (Math.random() * 0.3) + 's';
    c.style.animationDuration = (1.4 + Math.random() * 1.2) + 's';
    layer.appendChild(c);
    setTimeout(() => c.remove(), 3000);
  }
}

function checkBadges() {
  const before = new Set(state.badges || []);
  const earned = new Set(state.badges || []);
  const s = playerState();
  BADGES_DEF.forEach(b => {
    if (!earned.has(b.id) && b.check(s)) earned.add(b.id);
  });
  if (earned.size > before.size) {
    state.badges = Array.from(earned);
    saveState();
    // mostra notificação dos novos
    Array.from(earned).filter(id => !before.has(id)).forEach((id, i) => {
      setTimeout(() => notifyBadgeEarned(id), 600 + i * 1200);
    });
  } else {
    state.badges = Array.from(earned);
    saveState();
  }
}

function notifyBadgeEarned(id) {
  const def = BADGES_DEF.find(b => b.id === id);
  if (!def) return;
  const layer = document.getElementById('fxLayer');
  if (!layer) return;
  const toast = document.createElement('div');
  toast.className = 'badge-toast';
  toast.innerHTML = `<span class="bt-icon">${def.icon}</span><div class="bt-text"><div class="bt-name">${def.name}</div><div class="bt-desc">${def.desc}</div></div>`;
  layer.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function renderPlayer() {
  const s = playerState();
  const xpInfo = xpForNextLevel(s.xp);
  document.getElementById('playerLevel').textContent = s.level;
  document.getElementById('playerTitle').textContent = s.title;
  document.getElementById('playerXpText').textContent = s.xp + ' XP' + (xpInfo.done ? ' • MAX' : ` • ${xpInfo.current}/${xpInfo.needed}`);
  const fill = document.getElementById('playerXpFill');
  fill.style.width = (xpInfo.pct * 100) + '%';
  document.getElementById('playerStreak').innerHTML = `<span class="flame">🔥</span> ${s.streak} dia${s.streak === 1 ? '' : 's'}`;
  const todayXp = (state.xpToday && state.xpToday.date === todayKey()) ? state.xpToday.amount : 0;
  document.getElementById('playerToday').textContent = `+${todayXp} hoje`;
  document.getElementById('badgesCount').textContent = (state.badges || []).length;
  // muda cor do avatar pelo nível
  const av = document.getElementById('playerAvatar');
  if (av) av.dataset.level = s.level;
}

function openBadgesModal() {
  const modal = document.getElementById('badgesModal');
  const list = document.getElementById('badgesList');
  list.innerHTML = '';
  const earned = new Set(state.badges || []);
  list.classList.remove('list-anim');
  void list.offsetWidth;
  list.classList.add('list-anim');
  BADGES_DEF.forEach(b => {
    const li = document.createElement('li');
    li.className = 'badge-row' + (earned.has(b.id) ? ' earned' : '');
    li.innerHTML = `
      <span class="badge-icon">${earned.has(b.id) ? b.icon : '🔒'}</span>
      <div class="badge-info">
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>
      </div>
    `;
    list.appendChild(li);
  });
  modal.classList.remove('hidden');
}
function closeBadgesModal() { document.getElementById('badgesModal').classList.add('hidden'); }

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
  const todayK = todayKey();
  if (current) {
    const elapsed = now - current.startMinutes;
    const pct = clamp(elapsed / current.durationMin, 0, 1);
    cur.classList.remove('empty');
    const doneKey = todayK + '::' + current.id;
    const isDone = !!state.taskDone[doneKey];
    // aplica animacao de swap quando a tarefa atual muda (id diferente do ultimo render)
    const lastCurrentId = cur.dataset.currentId;
    if (lastCurrentId && lastCurrentId !== current.id) {
      cur.classList.remove('swap');
      // forca reflow para reiniciar a animacao
      void cur.offsetWidth;
      cur.classList.add('swap');
    } else if (!lastCurrentId) {
      cur.classList.add('swap');
    }
    cur.dataset.currentId = current.id;
    cur.innerHTML = `
      <div class="ct-info">
        <div class="ct-title"></div>
        <div class="ct-meta"></div>
        <div class="ct-bar"><span style="width:${pct * 100}%"></span></div>
      </div>
      <button class="ct-done-btn${isDone ? ' done' : ''}" aria-label="Marcar como concluída">${isDone ? '✓' : '○'}</button>
      <span class="nl-cat cat-${current.category}">${current.category}</span>
    `;
    cur.querySelector('.ct-title').textContent = current.title;
    const endMin = current.startMinutes + current.durationMin;
    cur.querySelector('.ct-meta').textContent = `${formatMin(current.startMinutes)} → ${formatMin(endMin)} • ${current.durationMin} min`;
    cur.querySelector('.ct-done-btn').addEventListener('click', () => toggleTaskDone(current.id));
  } else {
    cur.classList.add('empty');
    cur.innerHTML = '<div class="empty-state">Nada por agora. Toque em <strong>+ Tarefa</strong>.</div>';
  }
  const nextEl = document.getElementById('nextTasks');
  nextEl.innerHTML = '';
  nextEl.classList.remove('list-anim');
  void nextEl.offsetWidth;
  nextEl.classList.add('list-anim');
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

function toggleTaskDone(taskId) {
  const todayK = todayKey();
  const k = todayK + '::' + taskId;
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) return;
  const btn = document.activeElement && document.activeElement.classList.contains('ct-done-btn') ? document.activeElement : null;
  if (state.taskDone[k]) {
    delete state.taskDone[k];
  } else {
    state.taskDone[k] = true;
    // loga minutos cumpridos: conta como a duração total da tarefa
    state.pomodoroLog = state.pomodoroLog || [];
    state.pomodoroLog.push({ dateKey: todayK, kind: 'task', taskId, minutes: t.durationMin, createdAt: Date.now() });
    addXp(XP_REWARDS.task, 'tarefa', btn);
  }
  saveState();
  renderAgenda();
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
      // loga só sessões de foco (não pausas) para estatísticas
      if (isFocus) {
        state.pomodoroLog = state.pomodoroLog || [];
        state.pomodoroLog.push({
          dateKey: todayKey(),
          kind: 'pomodoro',
          minutes: Math.floor(state.pomodoro.totalSec / 60),
          createdAt: Date.now()
        });
        addXp(XP_REWARDS.pomodoro, 'pomodoro', document.getElementById('pomodoroTime'));
      }
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
    ul.classList.remove('list-anim');
    void ul.offsetWidth;
    ul.classList.add('list-anim');
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
      li.querySelector('.ri-check').addEventListener('click', (ev) => {
        const k = key + '::' + item.id;
        const becameDone = !state.routineDone[k];
        if (state.routineDone[k]) delete state.routineDone[k];
        else state.routineDone[k] = true;
        saveState();
        if (becameDone) addXp(XP_REWARDS.routine, 'rotina', ev.currentTarget);
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
  addXp(XP_REWARDS.capture, 'captura', document.querySelector('#captureForm button[type="submit"]'));
  renderInbox();
  closeCapture();
}
function renderInbox() {
  document.getElementById('inboxCount').textContent = state.inbox.length;
  const ul = document.getElementById('inboxList');
  ul.innerHTML = '';
  ul.classList.remove('list-anim');
  void ul.offsetWidth;
  ul.classList.add('list-anim');
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
  document.getElementById('remindersPanel').classList.toggle('hidden', name !== 'reminders');
  document.getElementById('iaPanel').classList.toggle('hidden', name !== 'ia');
  document.getElementById('statsPanel')?.classList.toggle('hidden', name !== 'stats');
  // Em telas pequenas, esconde o relógio + agenda quando outras tabs estão ativas
  const small = window.innerWidth < 720;
  if (small) {
    document.querySelector('.time-card').classList.toggle('hidden', name !== 'agenda');
    document.querySelector('.agenda-card').classList.toggle('hidden', name !== 'agenda');
    document.querySelector('.actions-card').classList.toggle('hidden', name !== 'agenda');
  }
  // slide-in do painel ativo
  const activePanel = (name === 'agenda') ? document.querySelector('.agenda-card') : document.getElementById(name + 'Panel');
  if (activePanel) {
    activePanel.classList.remove('tab-enter');
    void activePanel.offsetWidth;
    activePanel.classList.add('tab-enter');
  }
  if (name === 'stats') renderStats();
  if (name === 'ia') renderIaHistory();
}

// ===== Reset diário das rotinas =====
function checkDailyReset() {
  const today = todayKey();
  if (state.lastResetDate !== today) {
    // limpa conclusões antigas
    Object.keys(state.routineDone).forEach(k => { if (!k.startsWith(today)) delete state.routineDone[k]; });
    Object.keys(state.taskDone).forEach(k => { if (!k.startsWith(today)) delete state.taskDone[k]; });
    state.lastResetDate = today;
    saveState();
  }
}

// ===== Lembretes =====
function dateKeyFromInput(v) {
  // v = 'YYYY-MM-DD' -> 'YYYY-MM-DD'
  return v;
}
function dateKeyToInput(dateKey) {
  return dateKey; // já no formato
}
function todayDateInput() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function formatReminderDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
}
function urgencyFor(daysLeft) {
  if (daysLeft < 0) return { cls: 'urg-far', label: 'passou' };
  if (daysLeft === 0) return { cls: 'urg-today', label: 'hoje' };
  if (daysLeft === 1) return { cls: 'urg-today', label: 'amanha' };
  if (daysLeft <= 3) return { cls: 'urg-soon', label: daysLeft + ' dias' };
  if (daysLeft <= 7) return { cls: 'urg-week', label: daysLeft + ' dias' };
  return { cls: 'urg-far', label: daysLeft + ' dias' };
}
function dayMonthLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const months = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  return { day: String(d).padStart(2,'0'), month: months[m-1] };
}

function renderReminders() {
  const ul = document.getElementById('remindersList');
  ul.innerHTML = '';
  ul.classList.remove('list-anim');
  void ul.offsetWidth;
  ul.classList.add('list-anim');
  document.getElementById('remindersCount').textContent = state.reminders.length;
  if (state.reminders.length === 0) {
    const li = document.createElement('li');
    li.className = 'reminders-empty';
    li.textContent = 'Nenhum lembrete. Toque em + Lembrete para registrar uma data.';
    ul.appendChild(li);
    return;
  }
  const sorted = [...state.reminders].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  sorted.forEach(r => {
    const today = new Date(); today.setHours(0,0,0,0);
    const [y,m,d] = r.dateKey.split('-').map(Number);
    const target = new Date(y, m-1, d); target.setHours(0,0,0,0);
    const daysLeft = Math.round((target - today) / (1000 * 60 * 60 * 24));
    const urg = urgencyFor(daysLeft);
    const dm = dayMonthLabel(r.dateKey);
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="rm-date">
        <div class="rm-day">${dm.day}</div>
        <div class="rm-month">${dm.month}</div>
      </div>
      <div class="rm-info">
        <div class="rm-title"></div>
        <div class="rm-when"></div>
      </div>
      <div class="rm-actions">
        <button class="rm-btn" data-act="task">→ Tarefa</button>
        <button class="rm-btn" data-act="ia">→ IA</button>
        <button class="rm-btn del" data-act="del">×</button>
      </div>
    `;
    li.querySelector('.rm-title').textContent = r.title;
    li.querySelector('.rm-when').innerHTML = `${formatReminderDate(r.dateKey)} <span class="urg ${urg.cls}">${urg.label}</span>`;
    li.querySelector('[data-act="task"]').addEventListener('click', () => convertReminderToTask(r.id));
    li.querySelector('[data-act="ia"]').addEventListener('click', () => askIaAboutReminder(r.id));
    li.querySelector('[data-act="del"]').addEventListener('click', () => deleteReminder(r.id));
    ul.appendChild(li);
  });
}

function openReminderModal(id) {
  const modal = document.getElementById('reminderModal');
  const title = document.getElementById('reminderModalTitle');
  const del = document.getElementById('reminderDelete');
  const form = document.getElementById('reminderForm');
  form.reset();
  if (id) {
    const r = state.reminders.find(x => x.id === id);
    if (!r) return;
    title.textContent = 'Editar lembrete';
    del.classList.remove('hidden');
    document.getElementById('reminderTitle').value = r.title;
    document.getElementById('reminderDate').value = dateKeyToInput(r.dateKey);
    document.getElementById('reminderNote').value = r.note || '';
    form.dataset.editId = id;
  } else {
    title.textContent = 'Novo lembrete';
    del.classList.add('hidden');
    document.getElementById('reminderDate').value = todayDateInput();
    form.dataset.editId = '';
  }
  modal.classList.remove('hidden');
}
function closeReminderModal() { document.getElementById('reminderModal').classList.add('hidden'); }
function saveReminderFromForm(e) {
  e.preventDefault();
  const title = document.getElementById('reminderTitle').value.trim();
  const dateKey = document.getElementById('reminderDate').value;
  const note = document.getElementById('reminderNote').value.trim();
  if (!title || !dateKey) return;
  const editId = document.getElementById('reminderForm').dataset.editId;
  if (editId) {
    const r = state.reminders.find(x => x.id === editId);
    if (r) Object.assign(r, { title, dateKey, note });
  } else {
    state.reminders.push({ id: uid(), title, dateKey, note, source: 'manual', createdAt: Date.now() });
  }
  saveState();
  closeReminderModal();
  renderAll();
}
function deleteReminderFromForm() {
  const id = document.getElementById('reminderForm').dataset.editId;
  if (!id) return;
  deleteReminder(id);
  closeReminderModal();
}
function deleteReminder(id) {
  state.reminders = state.reminders.filter(x => x.id !== id);
  saveState();
  renderAll();
}
function convertReminderToTask(id) {
  const r = state.reminders.find(x => x.id === id);
  if (!r) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const [y,m,d] = r.dateKey.split('-').map(Number);
  const target = new Date(y, m-1, d); target.setHours(0,0,0,0);
  // Se ja passou, tarefa pra hoje. Se hoje, em 5 min. Se futuro, 9h da manha do dia.
  const startDate = (target.getTime() < today.getTime()) ? new Date() :
                    (target.getTime() === today.getTime()) ? new Date(Date.now() + 5*60*1000) :
                    (function(){ const dt = new Date(target); dt.setHours(9,0,0,0); return dt; })();
  const startMin = startDate.getHours() * 60 + startDate.getMinutes();
  const dk = startDate.getFullYear() + '-' + String(startDate.getMonth()+1).padStart(2,'0') + '-' + String(startDate.getDate()).padStart(2,'0');
  state.tasks.push({
    id: uid(),
    title: r.title,
    startMinutes: startMin,
    durationMin: 30,
    category: 'pessoal',
    dateKey: dk
  });
  saveState();
  renderAll();
  setTab('agenda');
}
function askIaAboutReminder(id) {
  const r = state.reminders.find(x => x.id === id);
  if (!r) return;
  setTab('ia');
  const promptText = 'Me ajuda a me preparar para: ' + r.title + ' em ' + formatReminderDate(r.dateKey) + '.' + (r.note ? ' Contexto: ' + r.note : '');
  document.getElementById('iaPrompt').value = promptText;
  // dispara depois da troca de tab
  setTimeout(() => callIa('free', { prompt: promptText }), 100);
}

// ===== Render geral =====
function renderAll() {
  checkDailyReset();
  renderDayRing();
  renderAgenda();
  renderRoutines();
  renderInbox();
  renderReminders();
  updatePomodoroLabel();
  renderPomodoro();
  renderPlayer();
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
  // lembretes dentro de 14 dias
  const remindersUpcoming = (state.reminders || []).map(r => ({
    title: r.title,
    date: r.dateKey,
    daysLeft: daysUntilDate(r.dateKey),
    note: r.note || ''
  })).filter(r => r.daysLeft >= -1 && r.daysLeft <= 14);
  // histórico recente (memória curta entre dias)
  const recentHistory = (state.iaHistory || []).slice(-IA_HISTORY_CONTEXT).map(s => ({
    when: new Date(s.startedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    action: s.action,
    user: s.prompt,
    ia: s.reply
  }));
  // memória curta entre dias
  const memory = (state.iaMemory || []).slice(-IA_MEMORY_MAX);
  return { tasks, inbox, routinesPending, pomodoro, remindersUpcoming, recentHistory, memory };
}

function daysUntilDate(dateKey) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [y, m, d] = dateKey.split('-').map(Number);
  const target = new Date(y, m - 1, d); target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

// Resumo curto da sessão pra guardar na memória entre dias
function summarizeIaSession(action, prompt, reply) {
  // Corta o reply em até ~140 chars e prefixa com ação
  const shortReply = String(reply || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const labels = {
    now: 'o que fazer agora',
    break: 'quebra de tarefa',
    triage: 'triagem da caixa',
    reflect: 'reflexão do dia',
    free: 'pedido livre'
  };
  const label = labels[action] || action || 'conversa';
  return `[${label}] ${shortReply}${shortReply.length === 140 ? '…' : ''}`;
}

function pushIaHistory(session) {
  state.iaHistory = state.iaHistory || [];
  state.iaHistory.push(session);
  if (state.iaHistory.length > IA_HISTORY_MAX) {
    state.iaHistory = state.iaHistory.slice(-IA_HISTORY_MAX);
  }
}

function pushIaMemory(entry) {
  state.iaMemory = state.iaMemory || [];
  state.iaMemory.push(entry);
  if (state.iaMemory.length > IA_MEMORY_MAX * 2) {
    state.iaMemory = state.iaMemory.slice(-IA_MEMORY_MAX * 2);
  }
}

async function callIa(action, extra) {
  const statusEl = document.getElementById('iaStatus');
  const replyEl = document.getElementById('iaReply');
  statusEl.textContent = 'pensando';
  replyEl.classList.remove('hidden', 'error');
  replyEl.classList.add('loading');
  replyEl.textContent = 'Aguarde, pensando...';
  const sessionId = uid();
  const startedAt = Date.now();
  const promptText = (extra && (extra.prompt || extra.relato || extra.target)) || '';
  try {
    const r = await fetch('/api/ia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, context: { ...buildIaContext(), ...(extra || {}) } })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro ' + r.status);
    const reply = data.reply || '(sem resposta)';
    replyEl.classList.remove('loading');
    replyEl.textContent = reply;
    replyEl.classList.remove('appear');
    void replyEl.offsetWidth;
    replyEl.classList.add('appear');
    statusEl.textContent = 'pronto';

    // grava histórico
    pushIaHistory({
      id: sessionId,
      startedAt,
      endedAt: Date.now(),
      action,
      prompt: promptText,
      reply
    });

    // grava memória curta (só reflexões e pedidos livres com conteúdo útil)
    if (action === 'reflect' || (action === 'free' && promptText.length > 20)) {
      pushIaMemory({
        dateKey: todayKey(),
        summary: summarizeIaSession(action, promptText, reply),
        tipo: action,
        createdAt: Date.now()
      });
      if (action === 'reflect') addXp(XP_REWARDS.reflect, 'reflexão', document.querySelector('.ia-btn[data-action="reflect"]'));
    }
    saveState();
    renderIaHistory();
  } catch (e) {
    replyEl.classList.remove('loading');
    replyEl.classList.add('error');
    replyEl.textContent = 'Erro: ' + (e.message || e) + '\n\nDica: a IA só funciona depois que o app estiver publicado (HTTPS) com a chave configurada no servidor.';
    statusEl.textContent = 'erro';
  }
}

// Render: histórico + memória visíveis na aba IA
function renderIaHistory() {
  const listEl = document.getElementById('iaHistoryList');
  const emptyEl = document.getElementById('iaHistoryEmpty');
  const memEl = document.getElementById('iaMemoryList');
  const memEmpty = document.getElementById('iaMemoryEmpty');
  if (!listEl) return;

  // histórico
  listEl.innerHTML = '';
  listEl.classList.remove('list-anim');
  void listEl.offsetWidth;
  listEl.classList.add('list-anim');
  const hist = (state.iaHistory || []).slice().reverse();
  if (hist.length === 0) {
    emptyEl?.classList.remove('hidden');
  } else {
    emptyEl?.classList.add('hidden');
    hist.forEach(s => {
      const li = document.createElement('li');
      li.className = 'ia-h-item';
      const when = new Date(s.startedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const labelMap = { now: 'agora', break: 'quebrar', triage: 'triar', reflect: 'reflexão', free: 'livre' };
      const actLabel = labelMap[s.action] || s.action;
      li.innerHTML = `
        <div class="ia-h-head">
          <span class="ia-h-tag ${s.action}">${actLabel}</span>
          <span class="ia-h-when">${when}</span>
        </div>
        ${s.prompt ? `<div class="ia-h-prompt"></div>` : ''}
        <div class="ia-h-reply"></div>
      `;
      if (s.prompt) li.querySelector('.ia-h-prompt').textContent = 'Você: ' + s.prompt;
      li.querySelector('.ia-h-reply').textContent = 'IA: ' + s.reply;
      listEl.appendChild(li);
    });
  }

  // memória entre dias
  memEl.innerHTML = '';
  memEl.classList.remove('list-anim');
  void memEl.offsetWidth;
  memEl.classList.add('list-anim');
  const mem = (state.iaMemory || []).slice().reverse().slice(0, IA_MEMORY_MAX);
  if (mem.length === 0) {
    memEmpty?.classList.remove('hidden');
  } else {
    memEmpty?.classList.add('hidden');
    mem.forEach(m => {
      const li = document.createElement('li');
      li.className = 'ia-m-item';
      const when = m.dateKey || '';
      li.innerHTML = `<span class="ia-m-when">${when}</span><span class="ia-m-text"></span>`;
      li.querySelector('.ia-m-text').textContent = m.summary;
      memEl.appendChild(li);
    });
  }
}

function clearIaHistory() {
  if (!confirm('Apagar todo o histórico de conversas com a IA?')) return;
  state.iaHistory = [];
  saveState();
  renderIaHistory();
}

// ===== Estatísticas da semana =====
function getLast7Days() {
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    days.push({ key: k, date: new Date(d) });
  }
  return days;
}

function shortDayLabel(d) {
  const wd = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
  return wd[d.getDay()];
}

function computeWeekStats() {
  const days = getLast7Days();
  const dayKeys = new Set(days.map(d => d.key));

  // Planejado: soma das durações de tarefas nos últimos 7 dias
  const plannedByDay = {};
  days.forEach(d => plannedByDay[d.key] = 0);
  (state.tasks || []).forEach(t => {
    if (dayKeys.has(t.dateKey)) {
      plannedByDay[t.dateKey] = (plannedByDay[t.dateKey] || 0) + (t.durationMin || 0);
    }
  });

  // Cumprido via taskDone
  const doneByDay = {};
  days.forEach(d => doneByDay[d.key] = 0);
  Object.keys(state.taskDone || {}).forEach(k => {
    const dateKey = k.split('::')[0];
    if (dayKeys.has(dateKey)) {
      const taskId = k.split('::')[1];
      const t = (state.tasks || []).find(x => x.id === taskId);
      if (t) doneByDay[dateKey] = (doneByDay[dateKey] || 0) + (t.durationMin || 0);
    }
  });

  // Cumprido via pomodoros (apenas os que ainda não viraram taskDone)
  const focusByDay = {};
  days.forEach(d => focusByDay[d.key] = 0);
  (state.pomodoroLog || []).forEach(p => {
    if (dayKeys.has(p.dateKey)) {
      focusByDay[p.dateKey] = (focusByDay[p.dateKey] || 0) + (p.minutes || 0);
    }
  });

  // Rotinas cumpridas vs total
  const routinesByDay = days.map(d => {
    let total = 0, done = 0;
    ['morning', 'afternoon', 'evening'].forEach(period => {
      const items = state.routines[period] || [];
      items.forEach(item => {
        total++;
        if (state.routineDone[d.key + '::' + period + '::' + item.id]) done++;
      });
    });
    return { dateKey: d.key, total, done };
  });

  // Tarefas por categoria (últimos 7 dias)
  const byCategory = {};
  (state.tasks || []).forEach(t => {
    if (dayKeys.has(t.dateKey)) {
      byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    }
  });

  // % por dia (cap em 100%) — usa planejado como denominador quando houver
  const perDay = days.map(d => {
    const planned = plannedByDay[d.key] || 0;
    const done = doneByDay[d.key] || 0;
    const focus = focusByDay[d.key] || 0;
    const totalCumprido = done + focus; // soma o que veio de check + pomodoros (não cumulativo entre si)
    const pct = planned > 0 ? clamp(totalCumprido / planned, 0, 1.2) : (totalCumprido > 0 ? 1 : 0);
    return { ...d, planned, done, focus, totalCumprido, pct };
  });

  // Totais da semana
  const totalPlanned = perDay.reduce((a, b) => a + b.planned, 0);
  const totalDone = perDay.reduce((a, b) => a + b.done, 0);
  const totalFocus = perDay.reduce((a, b) => a + b.focus, 0);
  const totalCumprido = totalDone + totalFocus;
  const weekPct = totalPlanned > 0 ? clamp(totalCumprido / totalPlanned, 0, 1.2) : 0;
  const routinesDone = routinesByDay.reduce((a, b) => a + b.done, 0);
  const routinesTotal = routinesByDay.reduce((a, b) => a + b.total, 0);

  return { perDay, totalPlanned, totalDone, totalFocus, totalCumprido, weekPct, routinesDone, routinesTotal, byCategory };
}

function colorForPct(p) {
  // 0 = verde claro (vazio/baixo), 0.5 = azul, 0.8+ = amarelo, >1 = vermelho (sobrecarregado)
  if (p === 0) return 'rgba(255,255,255,0.05)';
  if (p < 0.3) return '#4ade80';
  if (p < 0.7) return '#6c8cff';
  if (p < 1) return '#fbbf24';
  return '#f87171';
}

function renderStats() {
  const panel = document.getElementById('statsPanel');
  if (!panel) return;
  const s = computeWeekStats();
  const todayK = todayKey();

  // Heatmap: 7 dias
  const heatmapHtml = s.perDay.map(d => {
    const isToday = d.key === todayK;
    const label = shortDayLabel(d.date);
    const pctLabel = d.planned > 0 ? Math.round(d.pct * 100) + '%' : (d.totalCumprido > 0 ? '+' + d.totalCumprido + 'min' : '—');
    const tooltip = `${label} ${d.key} • planejado ${d.planned}min • cumprido ${d.totalCumprido}min${d.focus ? ' (foco ' + d.focus + 'min)' : ''}`;
    return `
      <div class="stat-day${isToday ? ' today' : ''}" title="${tooltip}">
        <div class="stat-day-bar" style="background:${colorForPct(d.pct)}"></div>
        <div class="stat-day-label">${label}</div>
        <div class="stat-day-pct">${pctLabel}</div>
      </div>
    `;
  }).join('');

  // Categorias (top 5)
  const cats = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const totalCats = cats.reduce((a, b) => a + b[1], 0) || 1;
  const catsHtml = cats.length === 0
    ? '<div class="stat-empty">Sem tarefas nos últimos 7 dias.</div>'
    : cats.map(([cat, n]) => `
        <div class="stat-cat-row">
          <span class="nl-cat cat-${cat}">${cat}</span>
          <div class="stat-cat-bar"><span style="width:${(n / totalCats) * 100}%"></span></div>
          <span class="stat-cat-count">${n}</span>
        </div>
      `).join('');

  // Rotinas: total X cumpridas
  const routinesPct = s.routinesTotal > 0 ? Math.round((s.routinesDone / s.routinesTotal) * 100) : 0;

  panel.innerHTML = `
    <header class="card-head">
      <h2>Últimos 7 dias</h2>
      <span class="badge">${s.totalDone + s.totalFocus}min cumpridos</span>
    </header>

    <div class="stat-heatmap">${heatmapHtml}</div>

    <div class="stat-kpis">
      <div class="stat-kpi">
        <div class="stat-kpi-num">${Math.round(s.weekPct * 100)}%</div>
        <div class="stat-kpi-label">do planejado</div>
      </div>
      <div class="stat-kpi">
        <div class="stat-kpi-num">${s.routinesDone}/${s.routinesTotal}</div>
        <div class="stat-kpi-label">rotinas (${routinesPct}%)</div>
      </div>
      <div class="stat-kpi">
        <div class="stat-kpi-num">${s.totalDone + s.totalFocus}min</div>
        <div class="stat-kpi-label">de foco</div>
      </div>
    </div>

    <div class="stat-section">
      <h3 class="stat-section-title">Por categoria</h3>
      ${catsHtml}
    </div>

    <div class="stat-legend">
      <span class="stat-legend-item"><span class="stat-legend-dot" style="background:${colorForPct(0.1)}"></span> leve</span>
      <span class="stat-legend-item"><span class="stat-legend-dot" style="background:${colorForPct(0.5)}"></span> médio</span>
      <span class="stat-legend-item"><span class="stat-legend-dot" style="background:${colorForPct(0.85)}"></span> alto</span>
      <span class="stat-legend-item"><span class="stat-legend-dot" style="background:${colorForPct(1.1)}"></span> sobrecarregado</span>
    </div>
  `;
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

  // Lembretes
  document.getElementById('newReminderBtn').addEventListener('click', () => openReminderModal());
  document.getElementById('reminderModalClose').addEventListener('click', closeReminderModal);
  document.getElementById('reminderForm').addEventListener('submit', saveReminderFromForm);
  document.getElementById('reminderDelete').addEventListener('click', deleteReminderFromForm);

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

  document.getElementById('clearHistoryBtn')?.addEventListener('click', clearIaHistory);

  // Badges (gamificação)
  document.getElementById('badgesBtn')?.addEventListener('click', openBadgesModal);
  document.getElementById('badgesModalClose')?.addEventListener('click', closeBadgesModal);

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
  registerPresence();
  renderAll();
  renderPlayer();
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
      window.FocoAlarm.checkUpcomingReminders(state.reminders, a => window.FocoAlarm.fireAlarm(a.title, a.body, { tag: a.tag }));
    }
  }, 30 * 1000);

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
