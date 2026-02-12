const socket = io();

// Extract slug from URL: /s/{slug}
const slug = window.location.pathname.split('/s/')[1];

// Visitor ID for vote tracking (fallback for non-HTTPS contexts)
function generateId() {
  try { return crypto.randomUUID(); } catch(e) {}
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}
let visitorId = localStorage.getItem('tkai-visitor-id');
if (!visitorId) {
  visitorId = generateId();
  localStorage.setItem('tkai-visitor-id', visitorId);
}

// Nickname (per session)
let nickname = localStorage.getItem(`tkai-nick-${slug}`);
const votedQuestions = JSON.parse(localStorage.getItem(`tkai-votes-${slug}`) || '[]');

// Track known question IDs for animation
let knownQuestionIds = new Set();

// DOM elements
const sessionTitle = document.getElementById('session-title');
const speakerName = document.getElementById('speaker-name');
const speakerAvatar = document.getElementById('speaker-avatar');
const questionForm = document.getElementById('question-form');
const questionText = document.getElementById('question-text');
const charCount = document.getElementById('char-count');
const questionsList = document.getElementById('questions-list');
const questionCount = document.getElementById('question-count');
const emptyState = document.getElementById('empty-state');
const nicknameDisplay = document.getElementById('nickname-display');
const myNickname = document.getElementById('my-nickname');
const errorMessage = document.getElementById('error-message');
const focusedSection = document.getElementById('focused-section');
const focusedText = document.getElementById('focused-text');
const focusedAuthor = document.getElementById('focused-author');

// Load session info
async function loadSession() {
  const res = await fetch(`/api/sessions/${slug}`);
  if (!res.ok) {
    sessionTitle.textContent = 'Sesjon ikke funnet';
    questionForm.style.display = 'none';
    return;
  }
  const session = await res.json();
  sessionTitle.textContent = session.title;
  speakerName.textContent = `av ${session.speaker}`;
  document.title = `${session.title} – TKAI QA`;

  if (session.speaker_image) {
    speakerAvatar.src = session.speaker_image;
    speakerAvatar.style.display = 'block';
  }
}

// Show nickname if we have one
function updateNicknameDisplay() {
  if (nickname) {
    myNickname.textContent = nickname;
    nicknameDisplay.style.display = 'block';
  }
}

// Char counter
questionText.addEventListener('input', () => {
  charCount.textContent = questionText.value.length;
});

// Submit question
questionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = questionText.value.trim();
  if (!text) return;

  // Get nickname if we don't have one
  if (!nickname) {
    const res = await fetch('/api/nickname');
    const data = await res.json();
    nickname = data.nickname;
    localStorage.setItem(`tkai-nick-${slug}`, nickname);
    updateNicknameDisplay();
  }

  socket.emit('new-question', { slug, text, visitorId, nickname });
  questionText.value = '';
  charCount.textContent = '0';
});

// Render questions
function renderQuestions(questions) {
  const activeQuestions = questions.filter(q => q.status !== 'hidden');
  questionCount.textContent = `(${activeQuestions.filter(q => q.status !== 'answered').length})`;

  if (activeQuestions.length === 0) {
    emptyState.style.display = 'block';
    questionsList.innerHTML = '';
    questionsList.appendChild(emptyState);
    return;
  }

  emptyState.style.display = 'none';
  const fragment = document.createDocumentFragment();

  activeQuestions.forEach(q => {
    const div = document.createElement('div');
    const isNew = !knownQuestionIds.has(q.id);
    const statusClass = q.status === 'focused' ? 'question-focused' : q.status === 'answered' ? 'question-answered' : '';
    div.className = `question-card ${statusClass} ${isNew ? 'slide-in' : ''}`;
    div.dataset.id = q.id;
    knownQuestionIds.add(q.id);

    const hasVoted = votedQuestions.includes(q.id);
    const answeredBadge = q.status === 'answered' ? '<span class="answered-check">&#10003; Besvart</span>' : '';

    div.innerHTML = `
      <div class="question-content">
        <p class="question-text">${escapeHtml(q.text)}</p>
        <p class="question-meta">
          <span class="question-nickname">${escapeHtml(q.nickname)}</span>
          ${answeredBadge}
          <span class="question-time">${timeAgo(q.created_at)}</span>
        </p>
      </div>
      <button class="upvote-btn ${hasVoted ? 'upvoted' : ''}" data-id="${q.id}" ${hasVoted ? 'disabled' : ''}>
        <span class="upvote-icon">&#9650;</span>
        <span class="upvote-count">${q.upvotes}</span>
      </button>
    `;

    fragment.appendChild(div);
  });

  questionsList.innerHTML = '';
  questionsList.appendChild(fragment);

  // Attach vote handlers
  questionsList.querySelectorAll('.upvote-btn:not(.upvoted)').forEach(btn => {
    btn.addEventListener('click', () => {
      const qId = parseInt(btn.dataset.id);
      socket.emit('upvote', { slug, questionId: qId, visitorId });
      votedQuestions.push(qId);
      localStorage.setItem(`tkai-votes-${slug}`, JSON.stringify(votedQuestions));
      btn.classList.add('upvoted');
      btn.disabled = true;
    });
  });
}

// Socket events
socket.on('connect', () => {
  socket.emit('join-session', slug);
});

socket.on('questions-updated', ({ questions }) => {
  renderQuestions(questions);
});

socket.on('nickname-assigned', (nick) => {
  if (!localStorage.getItem(`tkai-nick-${slug}`)) {
    nickname = nick;
    localStorage.setItem(`tkai-nick-${slug}`, nickname);
    updateNicknameDisplay();
  }
});

socket.on('question-focused', (question) => {
  focusedSection.style.display = 'block';
  focusedText.textContent = question.text;
  focusedAuthor.textContent = `– ${question.nickname}`;
});

socket.on('question-unfocused', () => {
  focusedSection.style.display = 'none';
});

socket.on('error-message', (msg) => {
  errorMessage.textContent = msg;
  errorMessage.style.display = 'block';
  setTimeout(() => {
    errorMessage.style.display = 'none';
  }, 4000);
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

// Init
loadSession();
updateNicknameDisplay();
