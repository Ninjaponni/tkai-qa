const socket = io();

// Extract slug from URL: /s/{slug}/speaker
const pathParts = window.location.pathname.split('/');
const slugIndex = pathParts.indexOf('s') + 1;
const slug = pathParts[slugIndex];

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

function handleAction(action, questionId) {
  switch (action) {
    case 'focus':
      socket.emit('focus-question', { slug, questionId });
      break;
    case 'unfocus':
      socket.emit('unfocus-question', { slug, questionId });
      break;
    case 'answer':
      socket.emit('answer-question', { slug, questionId });
      break;
    case 'hide':
      socket.emit('hide-question', { slug, questionId });
      break;
    case 'restore':
      socket.emit('unfocus-question', { slug, questionId });
      break;
    case 'delete':
      if (confirm('Er du sikker på at du vil slette dette spørsmålet permanent?')) {
        socket.emit('delete-question', { slug, questionId });
      }
      break;
  }
}

// Focus overlay buttons
unfocusBtn.addEventListener('click', () => {
  if (focusedQuestionId) {
    socket.emit('unfocus-question', { slug, questionId: focusedQuestionId });
  }
});

answerBtn.addEventListener('click', () => {
  if (focusedQuestionId) {
    socket.emit('answer-question', { slug, questionId: focusedQuestionId });
  }
});

// Socket events
socket.on('connect', () => {
  socket.emit('join-session', slug);
});

socket.on('questions-updated', (data) => {
  allQuestions = data.allQuestions;
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

// Kopier publikumslenke til clipboard (fallback hvis QR ikke fungerer)
function copyAudienceLink() {
  if (!audienceUrl) return;
  navigator.clipboard.writeText(audienceUrl);
  const btn = document.getElementById('copy-link-btn');
  btn.textContent = 'Kopiert!';
  setTimeout(() => btn.textContent = 'Kopier lenke', 2000);
}

// Init
loadSession();
