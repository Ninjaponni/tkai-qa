const socket = io();

// Extract slug from URL: /s/{slug}/speaker
const pathParts = window.location.pathname.split('/');
const slugIndex = pathParts.indexOf('s') + 1;
const slug = pathParts[slugIndex];

let allQuestions = [];
let currentFilter = 'all';

// DOM elements
const sessionTitle = document.getElementById('session-title');
const speakerName = document.getElementById('speaker-name');
const questionsList = document.getElementById('questions-list');
const questionCount = document.getElementById('question-count');
const emptyState = document.getElementById('empty-state');
const focusOverlay = document.getElementById('focus-overlay');
const focusQuestionText = document.getElementById('focus-question-text');
const focusMeta = document.getElementById('focus-meta');
const unfocusBtn = document.getElementById('unfocus-btn');

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
}

// Filter buttons
document.querySelectorAll('.btn-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelector('.btn-filter.active').classList.remove('active');
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderQuestions();
  });
});

// Render questions
function renderQuestions() {
  let filtered = allQuestions;
  if (currentFilter === 'active') {
    filtered = allQuestions.filter(q => q.status === 'active' || q.status === 'focused');
  } else if (currentFilter === 'hidden') {
    filtered = allQuestions.filter(q => q.status === 'hidden');
  }

  const activeCount = allQuestions.filter(q => q.status !== 'hidden').length;
  questionCount.textContent = `(${activeCount})`;

  if (filtered.length === 0) {
    emptyState.style.display = 'block';
    emptyState.textContent = currentFilter === 'hidden'
      ? 'Ingen skjulte spørsmål.'
      : 'Venter på spørsmål fra publikum...';
    questionsList.innerHTML = '';
    questionsList.appendChild(emptyState);
    return;
  }

  emptyState.style.display = 'none';
  const fragment = document.createDocumentFragment();

  filtered.forEach(q => {
    const div = document.createElement('div');
    div.className = `question-card speaker-card ${q.status === 'focused' ? 'question-focused' : ''} ${q.status === 'hidden' ? 'question-hidden' : ''} fade-in`;
    div.dataset.id = q.id;

    let actions = '';
    if (q.status === 'hidden') {
      actions = `
        <button class="btn btn-action btn-restore" data-action="restore" data-id="${q.id}" title="Gjenopprett">Vis</button>
        <button class="btn btn-action btn-delete" data-action="delete" data-id="${q.id}" title="Slett permanent">Slett</button>
      `;
    } else if (q.status === 'focused') {
      actions = `
        <button class="btn btn-action btn-unfocus" data-action="unfocus" data-id="${q.id}">Avslutt fokus</button>
        <button class="btn btn-action btn-hide" data-action="hide" data-id="${q.id}">Skjul</button>
      `;
    } else {
      actions = `
        <button class="btn btn-action btn-focus" data-action="focus" data-id="${q.id}">Fokus</button>
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
      const action = btn.dataset.action;
      const qId = parseInt(btn.dataset.id);
      handleAction(action, qId);
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
    case 'hide':
      socket.emit('hide-question', { slug, questionId });
      break;
    case 'restore':
      socket.emit('unfocus-question', { slug, questionId }); // resets to active
      break;
    case 'delete':
      if (confirm('Er du sikker på at du vil slette dette spørsmålet permanent?')) {
        socket.emit('delete-question', { slug, questionId });
      }
      break;
  }
}

// Focus overlay
unfocusBtn.addEventListener('click', () => {
  const focused = allQuestions.find(q => q.status === 'focused');
  if (focused) {
    socket.emit('unfocus-question', { slug, questionId: focused.id });
  }
});

// Socket events
socket.on('connect', () => {
  socket.emit('join-session', slug);
});

socket.on('questions-updated', (data) => {
  allQuestions = data.allQuestions;
  renderQuestions();
});

socket.on('question-focused', (question) => {
  focusOverlay.style.display = 'flex';
  focusQuestionText.textContent = question.text;
  focusMeta.textContent = `${question.nickname} · ▲ ${question.upvotes}`;
});

socket.on('question-unfocused', () => {
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
    case 'hidden': return 'Skjult';
    default: return 'Aktiv';
  }
}

// Init
loadSession();
