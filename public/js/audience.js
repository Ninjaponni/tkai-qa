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

// Swipe state
let hasShownSwipeHint = localStorage.getItem('tkai-swipe-hint-shown') === 'true';
let editingQuestionId = null;

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

  let hintShownThisRender = false;

  activeQuestions.forEach(q => {
    const isOwn = nickname && q.nickname === nickname;
    const isNew = !knownQuestionIds.has(q.id);
    const statusClass = q.status === 'focused' ? 'question-focused' : q.status === 'answered' ? 'question-answered' : '';
    const hasVoted = votedQuestions.includes(q.id);
    const answeredBadge = q.status === 'answered' ? '<span class="answered-check">&#10003; Besvart</span>' : '';

    // If currently editing this question, render edit mode
    if (editingQuestionId === q.id && isOwn) {
      const editWrapper = document.createElement('div');
      editWrapper.className = `question-card ${statusClass}`;
      editWrapper.dataset.id = q.id;
      editWrapper.classList.add('editing');
      editWrapper.innerHTML = `
        <div class="question-content">
          <textarea class="edit-area" maxlength="500">${escapeHtml(q.text)}</textarea>
          <div class="edit-actions">
            <button class="btn btn-primary btn-edit-save" data-id="${q.id}">Lagre</button>
            <button class="btn btn-secondary btn-edit-cancel" data-id="${q.id}">Avbryt</button>
          </div>
          <p class="edit-vote-warning">Stemmer nullstilles ved redigering</p>
        </div>
      `;
      fragment.appendChild(editWrapper);
      return;
    }

    const div = document.createElement('div');
    div.className = `question-card ${statusClass} ${isNew ? 'slide-in' : ''}`;
    div.dataset.id = q.id;
    knownQuestionIds.add(q.id);

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

    // Wrap own questions in swipe container
    if (isOwn && q.status === 'active') {
      const wrapper = document.createElement('div');
      wrapper.className = 'swipe-wrapper';
      wrapper.innerHTML = `
        <div class="swipe-bg swipe-bg-edit"><span>Rediger</span></div>
        <div class="swipe-bg swipe-bg-delete"><span>Slett</span></div>
      `;
      wrapper.appendChild(div);
      fragment.appendChild(wrapper);

      // Show hint for first own question (once)
      if (!hasShownSwipeHint && !hintShownThisRender) {
        hintShownThisRender = true;
        const hint = document.createElement('p');
        hint.className = 'swipe-hint';
        hint.innerHTML = '<span class="hint-arrows">&larr; &rarr;</span> Sveip for å redigere eller slette';
        fragment.appendChild(hint);
        hasShownSwipeHint = true;
        localStorage.setItem('tkai-swipe-hint-shown', 'true');
      }
    } else {
      fragment.appendChild(div);
    }
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

  // Attach edit save/cancel handlers
  questionsList.querySelectorAll('.btn-edit-save').forEach(btn => {
    btn.addEventListener('click', () => {
      const qId = parseInt(btn.dataset.id);
      const textarea = btn.closest('.question-card').querySelector('.edit-area');
      const newText = textarea.value.trim();
      if (!newText) return;
      socket.emit('edit-question', { slug, questionId: qId, newText, nickname });
      editingQuestionId = null;
    });
  });

  questionsList.querySelectorAll('.btn-edit-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      editingQuestionId = null;
      renderQuestions(lastQuestions);
    });
  });

  // Attach swipe handlers
  initSwipeHandlers();

  // Focus the edit textarea if in edit mode
  const editArea = questionsList.querySelector('.edit-area');
  if (editArea) {
    editArea.focus();
    editArea.setSelectionRange(editArea.value.length, editArea.value.length);
  }
}

// Store last questions for re-render
let lastQuestions = [];

// Swipe touch handling
function initSwipeHandlers() {
  const wrappers = questionsList.querySelectorAll('.swipe-wrapper');

  wrappers.forEach(wrapper => {
    const card = wrapper.querySelector('.question-card');
    const bgDelete = wrapper.querySelector('.swipe-bg-delete');
    const bgEdit = wrapper.querySelector('.swipe-bg-edit');
    const qId = parseInt(card.dataset.id);

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isDragging = false;
    let isHorizontal = null;
    const THRESHOLD = 100;

    card.addEventListener('touchstart', (e) => {
      if (editingQuestionId) return;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      currentX = 0;
      isDragging = true;
      isHorizontal = null;
      card.classList.remove('snapping');
      card.style.transition = 'none';
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const touch = e.touches[0];
      const diffX = touch.clientX - startX;
      const diffY = touch.clientY - startY;

      // Determine direction on first significant movement
      if (isHorizontal === null && (Math.abs(diffX) > 8 || Math.abs(diffY) > 8)) {
        isHorizontal = Math.abs(diffX) > Math.abs(diffY);
        if (!isHorizontal) {
          isDragging = false;
          return;
        }
      }

      if (!isHorizontal) return;

      e.preventDefault();
      currentX = diffX;

      // Apply dampened transform
      const damped = currentX * 0.55;
      card.style.transform = `translateX(${damped}px)`;

      // Show appropriate background with progressive opacity
      const progress = Math.min(Math.abs(damped) / THRESHOLD, 1);
      if (currentX < 0) {
        bgDelete.style.opacity = progress;
        bgEdit.style.opacity = 0;
      } else {
        bgEdit.style.opacity = progress;
        bgDelete.style.opacity = 0;
      }
    }, { passive: false });

    card.addEventListener('touchend', () => {
      if (!isDragging || !isHorizontal) {
        isDragging = false;
        return;
      }
      isDragging = false;

      const damped = currentX * 0.55;

      if (Math.abs(damped) >= THRESHOLD) {
        // Action triggered
        if (currentX < 0) {
          // Delete
          card.classList.add('swiped-away');
          card.style.transform = `translateX(${-window.innerWidth}px)`;
          setTimeout(() => {
            socket.emit('delete-own-question', { slug, questionId: qId, nickname });
          }, 300);
        } else {
          // Edit
          card.classList.add('snapping');
          card.style.transform = 'translateX(0)';
          bgEdit.style.opacity = 0;
          editingQuestionId = qId;
          renderQuestions(lastQuestions);
        }
      } else {
        // Snap back with spring
        card.classList.add('snapping');
        card.style.transform = 'translateX(0)';
        bgDelete.style.opacity = 0;
        bgEdit.style.opacity = 0;
      }
    });
  });
}

// Socket events
socket.on('connect', () => {
  socket.emit('join-session', slug);
});

socket.on('questions-updated', ({ questions }) => {
  lastQuestions = questions;
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
