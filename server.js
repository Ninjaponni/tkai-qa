const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { initDb, stmts } = require('./db');
const { generateNickname } = require('./nicknames');
const { isProfane, clean } = require('./profanity');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Support base64 image uploads (up to 5MB)
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Auto-cleanup: delete sessions older than 24 hours ---
async function cleanupOldSessions() {
  const old = await stmts.getOldSessionIds.all();
  for (const { id } of old) {
    await stmts.deleteQuestionsBySession.run(id);
  }
  await stmts.deleteOldSessions.run();
}

// --- Helper: broadcast updated questions ---
async function broadcastQuestions(slug, sessionId) {
  const allQuestions = await stmts.getAllQuestions.all(sessionId);
  const questions = allQuestions.filter(q => q.status !== 'hidden');
  io.to(slug).emit('questions-updated', { questions, allQuestions });
}

// --- REST API ---

// Create a new session
app.post('/api/sessions', async (req, res) => {
  try {
    const { title, speaker, speakerImage } = req.body;
    if (!title || !speaker) {
      return res.status(400).json({ error: 'Tittel og foredragsholder er påkrevd.' });
    }
    if (title.length > 120) {
      return res.status(400).json({ error: 'Tittelen kan ikke være lengre enn 120 tegn.' });
    }
    if (speaker.length > 80) {
      return res.status(400).json({ error: 'Navnet kan ikke være lengre enn 80 tegn.' });
    }

    const base = title
      .toLowerCase()
      .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'o').replace(/[å]/g, 'aa')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Retry with longer suffix on collision
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = uuidv4().slice(0, 6 + attempt);
      const slug = `${base}-${suffix}`;
      try {
        await stmts.createSession.run(slug, title, speaker, speakerImage || null);
        await stmts.incrementSessionCount.run();
        const session = await stmts.getSessionBySlug.get(slug);
        return res.json(session);
      } catch (err) {
        if (attempt === 4) {
          return res.status(500).json({ error: 'Kunne ikke opprette sesjon.' });
        }
      }
    }
  } catch (err) {
    console.error('Error creating session:', err);
    res.status(500).json({ error: 'Serverfeil.' });
  }
});

// Get session by slug
app.get('/api/sessions/:slug', async (req, res) => {
  try {
    const session = await stmts.getSessionBySlug.get(req.params.slug);
    if (!session) {
      return res.status(404).json({ error: 'Sesjon ikke funnet.' });
    }
    res.json(session);
  } catch (err) {
    console.error('Error getting session:', err);
    res.status(500).json({ error: 'Serverfeil.' });
  }
});

// Stats – total sessions ever created
app.get('/api/stats', async (req, res) => {
  try {
    const row = await stmts.getSessionCount.get();
    res.json({ totalSessions: row ? row.value : 0 });
  } catch (err) {
    console.error('Error getting stats:', err);
    res.status(500).json({ error: 'Serverfeil.' });
  }
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
  socket.on('join-session', async (slug) => {
    socket.join(slug);
    const session = await stmts.getSessionBySlug.get(slug);
    if (session) {
      const allQuestions = await stmts.getAllQuestions.all(session.id);
      const questions = allQuestions.filter(q => q.status !== 'hidden');
      socket.emit('questions-updated', { questions, allQuestions });
    }
  });

  socket.on('new-question', async ({ slug, text, visitorId, nickname }) => {
    const session = await stmts.getSessionBySlug.get(slug);
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
    await stmts.createQuestion.run(session.id, text.trim(), nick, visitorId || null);

    await broadcastQuestions(slug, session.id);
    socket.emit('nickname-assigned', nick);
  });

  socket.on('upvote', async ({ slug, questionId, visitorId }) => {
    const question = await stmts.getQuestion.get(questionId);
    if (!question) return;

    const already = await stmts.hasVoted.get(questionId, visitorId);
    if (already) {
      socket.emit('error-message', 'Du har allerede stemt på dette spørsmålet.');
      return;
    }

    await stmts.addVote.run(questionId, visitorId);
    await stmts.upvoteQuestion.run(questionId);

    const session = await stmts.getSessionBySlug.get(slug);
    if (!session) return;
    await broadcastQuestions(slug, session.id);
  });

  socket.on('focus-question', async ({ slug, questionId }) => {
    const question = await stmts.getQuestion.get(questionId);
    if (!question) return;

    await stmts.unfocusAll.run(question.session_id);
    await stmts.setQuestionStatus.run('focused', questionId);

    const session = await stmts.getSessionBySlug.get(slug);
    if (!session) return;

    await broadcastQuestions(slug, session.id);
    const focused = await stmts.getQuestion.get(questionId);
    io.to(slug).emit('question-focused', focused);
  });

  socket.on('unfocus-question', async ({ slug, questionId }) => {
    const question = await stmts.getQuestion.get(questionId);
    if (!question) return;

    await stmts.setQuestionStatus.run('active', questionId);

    const session = await stmts.getSessionBySlug.get(slug);
    if (!session) return;

    await broadcastQuestions(slug, session.id);
    io.to(slug).emit('question-unfocused');
  });

  socket.on('answer-question', async ({ slug, questionId }) => {
    const question = await stmts.getQuestion.get(questionId);
    if (!question) return;

    await stmts.setQuestionStatus.run('answered', questionId);

    const session = await stmts.getSessionBySlug.get(slug);
    if (!session) return;

    await broadcastQuestions(slug, session.id);
    io.to(slug).emit('question-unfocused');
  });

  socket.on('hide-question', async ({ slug, questionId }) => {
    const question = await stmts.getQuestion.get(questionId);
    if (!question) return;

    await stmts.setQuestionStatus.run('hidden', questionId);

    const session = await stmts.getSessionBySlug.get(slug);
    if (!session) return;
    await broadcastQuestions(slug, session.id);
  });

  socket.on('edit-question', async ({ slug, questionId, newText, visitorId }) => {
    const question = await stmts.getQuestion.get(questionId);
    if (!question) return;

    if (!visitorId || question.visitor_id !== visitorId) {
      socket.emit('error-message', 'Du kan bare redigere dine egne spørsmål.');
      return;
    }

    if (!newText || newText.trim().length === 0) {
      socket.emit('error-message', 'Spørsmålet kan ikke være tomt.');
      return;
    }

    if (newText.trim().length > 500) {
      socket.emit('error-message', 'Spørsmålet er for langt (maks 500 tegn).');
      return;
    }

    if (isProfane(newText)) {
      socket.emit('error-message', 'Spørsmålet inneholder upassende språk. Vennligst omformuler.');
      return;
    }

    await stmts.updateQuestionText.run(newText.trim(), questionId);
    await stmts.resetVotes.run(questionId);
    await stmts.deleteVotesForQuestion.run(questionId);

    const session = await stmts.getSessionBySlug.get(slug);
    if (!session) return;
    await broadcastQuestions(slug, session.id);
  });

  socket.on('delete-own-question', async ({ slug, questionId, visitorId }) => {
    const question = await stmts.getQuestion.get(questionId);
    if (!question) return;

    if (!visitorId || question.visitor_id !== visitorId) {
      socket.emit('error-message', 'Du kan bare slette dine egne spørsmål.');
      return;
    }

    await stmts.deleteVotesForQuestion.run(questionId);
    await stmts.deleteQuestion.run(questionId);

    const session = await stmts.getSessionBySlug.get(slug);
    if (!session) return;
    await broadcastQuestions(slug, session.id);
  });

  socket.on('delete-question', async ({ slug, questionId }) => {
    await stmts.deleteVotesForQuestion.run(questionId);
    await stmts.deleteQuestion.run(questionId);

    const session = await stmts.getSessionBySlug.get(slug);
    if (!session) return;
    await broadcastQuestions(slug, session.id);
  });
});

// --- Startup ---
const PORT = process.env.PORT || 3000;

async function main() {
  await initDb();
  console.log('Database initialized');

  // Cleanup old sessions every hour
  setInterval(cleanupOldSessions, 60 * 60 * 1000);
  await cleanupOldSessions();

  server.listen(PORT, () => {
    console.log(`TKAI QA kjører på http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
