const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { stmts } = require('./db');
const { generateNickname } = require('./nicknames');
const { isProfane, clean } = require('./profanity');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- REST API ---

// Create a new session
app.post('/api/sessions', (req, res) => {
  const { title, speaker } = req.body;
  if (!title || !speaker) {
    return res.status(400).json({ error: 'Tittel og foredragsholder er påkrevd.' });
  }

  // Generate slug from title
  const base = title
    .toLowerCase()
    .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'o').replace(/[å]/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const slug = `${base}-${uuidv4().slice(0, 6)}`;

  try {
    stmts.createSession.run(slug, title, speaker);
    const session = stmts.getSessionBySlug.get(slug);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: 'Kunne ikke opprette sesjon.' });
  }
});

// Get session by slug
app.get('/api/sessions/:slug', (req, res) => {
  const session = stmts.getSessionBySlug.get(req.params.slug);
  if (!session) {
    return res.status(404).json({ error: 'Sesjon ikke funnet.' });
  }
  res.json(session);
});

// Generate a nickname
app.get('/api/nickname', (req, res) => {
  res.json({ nickname: generateNickname() });
});

// Serve audience page
app.get('/s/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'audience.html'));
});

// Serve speaker page
app.get('/s/:slug/speaker', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'speaker.html'));
});

// --- Socket.io ---

io.on('connection', (socket) => {
  socket.on('join-session', (slug) => {
    socket.join(slug);
  });

  socket.on('new-question', ({ slug, text, visitorId, nickname }) => {
    const session = stmts.getSessionBySlug.get(slug);
    if (!session) return;

    if (!text || text.trim().length === 0) {
      socket.emit('error-message', 'Spørsmålet kan ikke være tomt.');
      return;
    }

    if (text.trim().length > 500) {
      socket.emit('error-message', 'Spørsmålet er for langt (maks 500 tegn).');
      return;
    }

    if (isProfane(text)) {
      socket.emit('error-message', 'Spørsmålet inneholder upassende språk. Vennligst omformuler.');
      return;
    }

    const nick = nickname || generateNickname();
    stmts.createQuestion.run(session.id, text.trim(), nick);

    // Send questions to audience (excludes hidden)
    const questions = stmts.getQuestions.all(session.id);
    const allQuestions = stmts.getAllQuestions.all(session.id);

    io.to(slug).emit('questions-updated', { questions, allQuestions, nickname: nick });
  });

  socket.on('upvote', ({ slug, questionId, visitorId }) => {
    const question = stmts.getQuestion.get(questionId);
    if (!question) return;

    const already = stmts.hasVoted.get(questionId, visitorId);
    if (already) {
      socket.emit('error-message', 'Du har allerede stemt på dette spørsmålet.');
      return;
    }

    stmts.addVote.run(questionId, visitorId);
    stmts.upvoteQuestion.run(questionId);

    const session = stmts.getSessionBySlug.get(slug);
    if (!session) return;

    const questions = stmts.getQuestions.all(session.id);
    const allQuestions = stmts.getAllQuestions.all(session.id);
    io.to(slug).emit('questions-updated', { questions, allQuestions });
  });

  socket.on('focus-question', ({ slug, questionId }) => {
    const question = stmts.getQuestion.get(questionId);
    if (!question) return;

    // Unfocus all others first
    stmts.unfocusAll.run(question.session_id);
    stmts.setQuestionStatus.run('focused', questionId);

    const session = stmts.getSessionBySlug.get(slug);
    if (!session) return;

    const questions = stmts.getQuestions.all(session.id);
    const allQuestions = stmts.getAllQuestions.all(session.id);
    io.to(slug).emit('questions-updated', { questions, allQuestions });
    io.to(slug).emit('question-focused', stmts.getQuestion.get(questionId));
  });

  socket.on('unfocus-question', ({ slug, questionId }) => {
    const question = stmts.getQuestion.get(questionId);
    if (!question) return;

    stmts.setQuestionStatus.run('active', questionId);

    const session = stmts.getSessionBySlug.get(slug);
    if (!session) return;

    const questions = stmts.getQuestions.all(session.id);
    const allQuestions = stmts.getAllQuestions.all(session.id);
    io.to(slug).emit('questions-updated', { questions, allQuestions });
    io.to(slug).emit('question-unfocused');
  });

  socket.on('hide-question', ({ slug, questionId }) => {
    const question = stmts.getQuestion.get(questionId);
    if (!question) return;

    stmts.setQuestionStatus.run('hidden', questionId);

    const session = stmts.getSessionBySlug.get(slug);
    if (!session) return;

    const questions = stmts.getQuestions.all(session.id);
    const allQuestions = stmts.getAllQuestions.all(session.id);
    io.to(slug).emit('questions-updated', { questions, allQuestions });
  });

  socket.on('delete-question', ({ slug, questionId }) => {
    stmts.deleteVotesForQuestion.run(questionId);
    stmts.deleteQuestion.run(questionId);

    const session = stmts.getSessionBySlug.get(slug);
    if (!session) return;

    const questions = stmts.getQuestions.all(session.id);
    const allQuestions = stmts.getAllQuestions.all(session.id);
    io.to(slug).emit('questions-updated', { questions, allQuestions });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`TKAI QA kjører på http://localhost:${PORT}`);
});
