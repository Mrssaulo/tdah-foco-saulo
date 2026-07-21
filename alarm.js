// alarm.js - notificacoes, som, vibracao e agendamento
// Usado pelo app para todos os alertas (Pomodoro, tarefas, rotinas)

const ALARM_SOUND_URL = 'assets/alarm.wav';

// Solicita permissao de notificacao. Retorna true se concedida.
async function ensureNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const r = await Notification.requestPermission();
  return r === 'granted';
}

// Toca o som de alarme (pre-carregado, sem delay)
let alarmAudio = null;
function getAlarmAudio() {
  if (!alarmAudio) {
    alarmAudio = new Audio(ALARM_SOUND_URL);
    alarmAudio.preload = 'auto';
  }
  return alarmAudio;
}

function playAlarm() {
  try {
    const a = getAlarmAudio();
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {}
}

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch (e) {}
}

// Funcao principal: dispara alarme completo (som + vibracao longa + notificacao)
async function fireAlarm(title, body, opts = {}) {
  vibrate(opts.vibrate || [300, 150, 300, 150, 600]);
  playAlarm();
  await ensureNotificationPermission();
  if (Notification.permission === 'granted') {
    const n = new Notification(title, {
      body,
      tag: opts.tag || 'foco-alarme',
      requireInteraction: opts.persistent !== false, // fica ate o usuario dispensar
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      silent: false
    });
    n.onclick = () => { window.focus(); n.close(); };
    return n;
  }
  return null;
}

// Agenda um alarme para daqui a X ms
function scheduleAlarm(delayMs, title, body, opts = {}) {
  if (delayMs <= 0) {
    fireAlarm(title, body, opts);
    return null;
  }
  return setTimeout(() => fireAlarm(title, body, opts), delayMs);
}

// ===== Verificador periodico (chamado a cada 30s pelo app) =====
// Detecta:
//  - tarefa que comeca em <= 5 min e ainda nao avisou
//  - rotinas pendentes nos horarios definidos
const ALERTED_KEY = 'foco-tdah-alerted-v1';
let alerted = {};
try { alerted = JSON.parse(localStorage.getItem(ALERTED_KEY) || '{}'); } catch (e) { alerted = {}; }
function saveAlerted() { try { localStorage.setItem(ALERTED_KEY, JSON.stringify(alerted)); } catch (e) {} }
function wasAlerted(key) { return !!alerted[key]; }
function markAlerted(key) { alerted[key] = Date.now(); saveAlerted(); }
function cleanOldAlerts() {
  // limpa alertas com mais de 24h
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  Object.keys(alerted).forEach(k => { if (alerted[k] < cutoff) delete alerted[k]; });
  saveAlerted();
}

// Horarios das rotinas: manha 8h, tarde 14h, noite 21h
const ROUTINE_TIMES = { morning: 8 * 60, afternoon: 14 * 60, evening: 21 * 60 };

function checkUpcomingTasks(tasks, onAlarm) {
  const now = Date.now();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const todayK = todayKey();
  tasks.filter(t => t.dateKey === todayK).forEach(t => {
    const lead = 5; // minutos antes
    const startMin = t.startMinutes;
    const diff = startMin - nowMin;
    const key = `task-${todayK}-${t.id}-${lead}min`;
    if (diff > 0 && diff <= lead && !wasAlerted(key)) {
      markAlerted(key);
      onAlarm({
        title: 'Tarefa em ' + diff + ' min',
        body: t.title + ' comeca as ' + formatMin(t.startMinutes),
        tag: key
      });
    }
  });
}

function checkRoutines(routines, routineDone, onAlarm) {
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const todayK = todayKey();
  Object.entries(ROUTINE_TIMES).forEach(([period, target]) => {
    // dispara 5 min apos o horario, pra dar tempo da pessoa acordar/ver
    if (nowMin >= target + 5 && nowMin < target + 30) {
      const items = routines[period] || [];
      const pending = items.filter(item => !routineDone[todayK + '::' + period + '::' + item.id]);
      if (pending.length === 0) return;
      const key = `routine-${todayK}-${period}`;
      if (wasAlerted(key)) return;
      markAlerted(key);
      onAlarm({
        title: 'Rotina da ' + (period === 'morning' ? 'manhã' : period === 'afternoon' ? 'tarde' : 'noite') + ' pendente',
        body: pending.length + ' item(s): ' + pending.map(p => p.text).join(', '),
        tag: key
      });
    }
  });
}

function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function formatMin(mins) {
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

window.FocoAlarm = {
  ensureNotificationPermission,
  fireAlarm,
  scheduleAlarm,
  playAlarm,
  vibrate,
  checkUpcomingTasks,
  checkRoutines,
  cleanOldAlerts
};
