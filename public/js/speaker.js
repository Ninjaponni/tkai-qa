const socket = io();

// Extract slug from URL: /s/{slug}/speaker
const pathParts = window.location.pathname.split('/');
const slugIndex = pathParts.indexOf('s') + 1;
const slug = pathParts[slugIndex];

// Adminnøkkel: les fra ?k=, lagre i localStorage og fjern den fra adressefeltet
// (speaker-visningen vises ofte på projektor)
const keyStorage = `tkai-admin-${slug}`;
const urlKey = new URLSearchParams(window.location.search).get('k');
if (urlKey) {
  try { localStorage.setItem(keyStorage, urlKey); } catch (e) {}
  history.replaceState(null, '', window.location.pathname);
}
let adminKey = urlKey;
try { adminKey = adminKey || localStorage.getItem(keyStorage); } catch (e) {}

let allQuestions = [];
let currentFilter = 'all';
let audienceUrl = '';
let previousQuestionCount = 0;
let focusedQuestionId = null;
const baseTitle = 'TKAI QA – Foredragsholder';

// DOM elements
const sessionTitle = document.getElementById('session-title');
const speakerName = document.getElementById('speaker-name');
const speakerAvatar = document.getElementById('speaker-avatar');
const questionsList = document.getElementById('questions-list');
const questionCount = document.getElementById('question-count');
const emptyState = document.getElementById('empty-state');
const focusOverlay = document.getElementById('focus-overlay');
const focusQuestionText = document.getElementById('focus-question-text');
const focusMeta = document.getElementById('focus-meta');
const unfocusBtn = document.getElementById('unfocus-btn');
const answerBtn = document.getElementById('answer-btn');
const liveBtn = document.getElementById('live-btn');
let isLive = false;
let speakerDenied = false;

// qa.tkai.no/live peker på sesjonen som er satt live
function setLiveState(live) {
  isLive = Boolean(live);
  liveBtn.textContent = isLive ? '● Live på /live' : 'Sett som live';
  liveBtn.classList.toggle('btn-live', isLive);
  liveBtn.title = isLive ? 'Klikk for å fjerne live-markeringen' : 'Send qa.tkai.no/live hit';
}

function toggleLive() {
  socket.emit('set-live', { slug, key: adminKey, live: !isLive });
}

// Load session
async function loadSession() {
  const res = await fetch(`/api/sessions/${slug}`);
  if (!res.ok) {
    sessionTitle.textContent = 'Sesjon ikke funnet';
    return;
  }
  const session = await res.json();
  sessionTitle.textContent = session.title;
  speakerName.textContent = `av ${session.speaker}`;
  document.title = `${session.title} – Foredragsholder – TKAI QA`;

  if (session.speaker_image) {
    speakerAvatar.src = session.speaker_image;
    speakerAvatar.style.display = 'block';
  }

  // "Sett som live" gjelder bare sesjoner koblet til et TKAI-arrangement
  if (session.event_slug && !speakerDenied) {
    liveBtn.style.display = '';
    setLiveState(session.live);
  }

  // Generate QR code for audience URL
  audienceUrl = `${window.location.origin}/s/${slug}`;
  try {
    if (typeof QRious !== 'undefined') {
      new QRious({
        element: document.getElementById('qr-canvas'),
        value: audienceUrl,
        size: 200,
        foreground: '#040308',
        background: '#ffffff',
      });
    }
  } catch(e) {
    console.warn('QR code generation failed:', e);
  }
}

// Tab badge for new questions
function updateTabBadge() {
  const activeCount = allQuestions.filter(q => q.status === 'active' || q.status === 'focused').length;
  const newCount = activeCount - previousQuestionCount;
  if (newCount > 0 && document.hidden) {
    document.title = `(${newCount} nye) ${baseTitle}`;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    previousQuestionCount = allQuestions.filter(q => q.status === 'active' || q.status === 'focused').length;
    document.title = `${sessionTitle.textContent} – Foredragsholder – TKAI QA`;
  }
});

// Filter buttons
document.querySelectorAll('.btn-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelector('.btn-filter.active').classList.remove('active');
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderQuestions();
  });
});

// Track known IDs for slide-in animation
let knownIds = new Set();

// Render questions
function renderQuestions() {
  let filtered = allQuestions;
  if (currentFilter === 'active') {
    filtered = allQuestions.filter(q => q.status === 'active' || q.status === 'focused');
  } else if (currentFilter === 'answered') {
    filtered = allQuestions.filter(q => q.status === 'answered');
  } else if (currentFilter === 'hidden') {
    filtered = allQuestions.filter(q => q.status === 'hidden');
  }

  const activeCount = allQuestions.filter(q => q.status === 'active' || q.status === 'focused').length;
  questionCount.textContent = `(${activeCount})`;

  if (filtered.length === 0) {
    emptyState.style.display = 'block';
    const msgs = {
      hidden: 'Ingen skjulte spørsmål.',
      answered: 'Ingen besvarte spørsmål ennå.',
      active: 'Ingen aktive spørsmål.',
      all: 'Venter på spørsmål fra publikum...',
    };
    emptyState.textContent = msgs[currentFilter] || msgs.all;
    questionsList.innerHTML = '';
    questionsList.appendChild(emptyState);
    return;
  }

  emptyState.style.display = 'none';
  const fragment = document.createDocumentFragment();

  filtered.forEach(q => {
    const div = document.createElement('div');
    const isNew = !knownIds.has(q.id);
    knownIds.add(q.id);

    const statusClass = q.status === 'focused' ? 'question-focused'
      : q.status === 'answered' ? 'question-answered'
      : q.status === 'hidden' ? 'question-hidden' : '';

    div.className = `question-card speaker-card ${statusClass} ${isNew ? 'slide-in' : ''}`;
    div.dataset.id = q.id;

    let actions = '';
    if (q.status === 'hidden') {
      actions = `
        <button class="btn btn-action btn-restore" data-action="restore" data-id="${q.id}">Vis</button>
        <button class="btn btn-action btn-delete" data-action="delete" data-id="${q.id}">Slett</button>
      `;
    } else if (q.status === 'focused') {
      actions = `
        <button class="btn btn-action btn-answer" data-action="answer" data-id="${q.id}">Besvart</button>
        <button class="btn btn-action btn-unfocus" data-action="unfocus" data-id="${q.id}">Avslutt</button>
        <button class="btn btn-action btn-hide" data-action="hide" data-id="${q.id}">Skjul</button>
      `;
    } else if (q.status === 'answered') {
      actions = `
        <button class="btn btn-action btn-restore" data-action="restore" data-id="${q.id}">Aktiver</button>
        <button class="btn btn-action btn-delete" data-action="delete" data-id="${q.id}">Slett</button>
      `;
    } else {
      actions = `
        <button class="btn btn-action btn-focus" data-action="focus" data-id="${q.id}">Fokus</button>
        <button class="btn btn-action btn-answer" data-action="answer" data-id="${q.id}">Besvart</button>
        <button class="btn btn-action btn-hide" data-action="hide" data-id="${q.id}">Skjul</button>
        <button class="btn btn-action btn-delete" data-action="delete" data-id="${q.id}">Slett</button>
      `;
    }

    div.innerHTML = `
      <div class="question-content">
        <p class="question-text">${escapeHtml(q.text)}</p>
        <p class="question-meta">
          <span class="question-nickname">${escapeHtml(q.nickname)}</span>
          <span class="upvote-count-inline">&#9650; ${q.upvotes}</span>
          <span class="question-time">${timeAgo(q.created_at)}</span>
          <span class="status-badge status-${q.status}">${statusLabel(q.status)}</span>
        </p>
      </div>
      <div class="question-actions">${actions}</div>
    `;

    fragment.appendChild(div);
  });

  questionsList.innerHTML = '';
  questionsList.appendChild(fragment);

  // Attach action handlers
  questionsList.querySelectorAll('.btn-action').forEach(btn => {
    btn.addEventListener('click', () => {
      handleAction(btn.dataset.action, parseInt(btn.dataset.id));
    });
  });
}

// Alle speaker-handlinger sender med adminnøkkelen
function emitSpeaker(event, questionId) {
  socket.emit(event, { slug, key: adminKey, questionId });
}

function handleAction(action, questionId) {
  switch (action) {
    case 'focus':
      emitSpeaker('focus-question', questionId);
      break;
    case 'unfocus':
      emitSpeaker('unfocus-question', questionId);
      break;
    case 'answer':
      emitSpeaker('answer-question', questionId);
      break;
    case 'hide':
      emitSpeaker('hide-question', questionId);
      break;
    case 'restore':
      emitSpeaker('unfocus-question', questionId);
      break;
    case 'delete':
      if (confirm('Er du sikker på at du vil slette dette spørsmålet permanent?')) {
        emitSpeaker('delete-question', questionId);
      }
      break;
  }
}

// Focus overlay buttons
unfocusBtn.addEventListener('click', () => {
  if (focusedQuestionId) {
    emitSpeaker('unfocus-question', focusedQuestionId);
  }
});

answerBtn.addEventListener('click', () => {
  if (focusedQuestionId) {
    emitSpeaker('answer-question', focusedQuestionId);
  }
});

// Socket events
socket.on('connect', () => {
  socket.emit('join-session', { slug, key: adminKey, role: 'speaker' });
});

// Uten gyldig nøkkel får siden bare se det publikum ser
socket.on('live-changed', ({ live }) => setLiveState(live));

socket.on('speaker-denied', () => {
  speakerDenied = true;
  document.body.classList.add('speaker-no-key');
  liveBtn.style.display = 'none';
  showSpeakerWarning('Denne lenken mangler gyldig adminnøkkel. Du kan se spørsmålene, men ikke styre dem. Be den som opprettet sesjonen om speaker-lenken.');
  document.getElementById('copy-speaker-btn').style.display = 'none';
});

socket.on('error-message', (msg) => {
  showSpeakerWarning(msg);
});

function showSpeakerWarning(msg) {
  const el = document.getElementById('speaker-warning');
  el.textContent = msg;
  el.style.display = 'block';
}

socket.on('questions-updated', (data) => {
  allQuestions = data.allQuestions || data.questions;
  renderQuestions();
  updateTabBadge();
});

socket.on('question-focused', (question) => {
  focusedQuestionId = question.id;
  focusOverlay.style.display = 'flex';
  focusMeta.textContent = `${question.nickname} · ▲ ${question.upvotes}`;
  typewriter(focusQuestionText, question.text, 30);
});

// Typewriter effect
function typewriter(el, text, speed) {
  el.innerHTML = '';
  let i = 0;
  const cursor = document.createElement('span');
  cursor.className = 'typewriter-cursor';
  el.appendChild(cursor);

  function type() {
    if (i < text.length) {
      el.insertBefore(document.createTextNode(text[i]), cursor);
      i++;
      setTimeout(type, speed);
    } else {
      // Remove cursor after a short delay
      setTimeout(() => cursor.remove(), 1500);
    }
  }
  type();
}

socket.on('question-unfocused', () => {
  focusedQuestionId = null;
  focusOverlay.style.display = 'none';
});

// Helpers
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function timeAgo(dateStr) {
  const now = new Date();
  const then = new Date(dateStr + 'Z');
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'nå';
  if (diff < 3600) return `${Math.floor(diff / 60)} min siden`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} t siden`;
  return `${Math.floor(diff / 86400)} d siden`;
}

function statusLabel(status) {
  switch (status) {
    case 'focused': return 'Fokusert';
    case 'answered': return 'Besvart';
    case 'hidden': return 'Skjult';
    default: return 'Aktiv';
  }
}

// Kopier lenke til clipboard og vis "Kopiert!" en kort stund
function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text);
  const label = btn.textContent;
  btn.textContent = 'Kopiert!';
  setTimeout(() => btn.textContent = label, 2000);
}

// Kopier publikumslenke (fallback hvis QR ikke fungerer)
function copyAudienceLink() {
  if (!audienceUrl) return;
  copyToClipboard(audienceUrl, document.getElementById('copy-link-btn'));
}

// Kopier speaker-lenke med nøkkel, for å sende til foredragsholderen
function copySpeakerLink() {
  const url = `${window.location.origin}/s/${slug}/speaker` + (adminKey ? `?k=${encodeURIComponent(adminKey)}` : '');
  copyToClipboard(url, document.getElementById('copy-speaker-btn'));
}

// Init
loadSession();
