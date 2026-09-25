const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
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
  try {
    const old = await stmts.getOldSessionIds.all();
    for (const { id } of old) {
      await stmts.deleteQuestionsBySession.run(id);
    }
    await stmts.deleteOldSessions.run();
  } catch (err) {
    console.error('Cleanup failed:', err);
  }
}

// --- Adminnøkkel for speaker ---
function generateAdminKey() {
  return crypto.randomBytes(24).toString('base64url'); // 32 tegn
}

// Gamle sesjoner uten nøkkel godtas som før
function keyMatches(session, key) {
  if (!session.admin_key) return true;
  if (typeof key !== 'string') return false;
  const a = Buffer.from(session.admin_key);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Sesjon slik den kan vises offentlig (uten admin_key)
function publicSession(session) {
  const { admin_key, ...rest } = session;
  return rest;
}

// Speakere med gyldig nøkkel ligger i et eget rom og får også skjulte spørsmål
function speakerRoom(slug) {
  return `${slug}:speaker`;
}

// --- Helper: broadcast updated questions ---
async function broadcastQuestions(slug, sessionId) {
  const allQuestions = await stmts.getAllQuestions.all(sessionId);
  const questions = allQuestions.filter(q => q.status !== 'hidden');
  io.to(slug).except(speakerRoom(slug)).emit('questions-updated', { questions });
  io.to(speakerRoom(slug)).emit('questions-updated', { questions, allQuestions });
}

// Henter sesjon og (valgfritt) spørsmål, og sjekker at spørsmålet hører til sesjonen
async function getSessionAndQuestion(slug, questionId) {
  const session = await stmts.getSessionBySlug.get(slug);
  if (!session) return null;
  if (questionId === undefined) return { session };
  const question = await stmts.getQuestion.get(questionId);
  if (!question || question.session_id !== session.id) return null;
  return { session, question };
}

// Som over, men krever gyldig adminnøkkel. Avviser stille med error-message.
async function getSpeakerContext(socket, { slug, key, questionId }) {
  const session = await stmts.getSessionBySlug.get(slug);
  if (!session) return null;
  if (!keyMatches(session, key)) {
    socket.emit('error-message', 'Du har ikke tilgang til å styre denne sesjonen.');
    return null;
  }
  if (questionId === undefined) return { session };
  const question = await stmts.getQuestion.get(questionId);
  if (!question || question.session_id !== session.id) return null;
  return { session, question };
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
        await stmts.createSession.run(slug, title, speaker, speakerImage || null, generateAdminKey());
        await stmts.incrementSessionCount.run();
        // Bare den som oppretter sesjonen får nøkkelen
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
    res.json(publicSession(session));
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
  // Publikum sender slug som streng, speaker sender { slug, key, role: 'speaker' }
  socket.on('join-session', async (payload) => {
    try {
      const { slug, key, role } = typeof payload === 'string' ? { slug: payload } : (payload || {});
      if (typeof slug !== 'string') return;
      socket.join(slug);
      const session = await stmts.getSessionBySlug.get(slug);
      if (!session) return;

      const isSpeaker = role === 'speaker' && keyMatches(session, key);
      if (isSpeaker) {
        socket.join(speakerRoom(slug));
      } else if (role === 'speaker') {
        socket.emit('speaker-denied');
      }

      const allQuestions = await stmts.getAllQuestions.all(session.id);
      const questions = allQuestions.filter(q => q.status !== 'hidden');
      socket.emit('questions-updated', isSpeaker ? { questions, allQuestions } : { questions });
    } catch (err) {
      console.error('Error in join-session:', err);
    }
  });

  socket.on('new-question', async ({ slug, text, visitorId, nickname }) => {
    try {
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
    } catch (err) {
      console.error('Error in new-question:', err);
      socket.emit('error-message', 'Noe gikk galt. Prøv igjen.');
    }
  });

  socket.on('upvote', async ({ slug, questionId, visitorId }) => {
    try {
      const ctx = await getSessionAndQuestion(slug, questionId);
      if (!ctx) return;

      const already = await stmts.hasVoted.get(questionId, visitorId);
      if (already) {
        socket.emit('error-message', 'Du har allerede stemt på dette spørsmålet.');
        return;
      }

      await stmts.addVote.run(questionId, visitorId);
      await stmts.upvoteQuestion.run(questionId);

      await broadcastQuestions(slug, ctx.session.id);
    } catch (err) {
      console.error('Error in upvote:', err);
    }
  });

  socket.on('focus-question', async ({ slug, key, questionId }) => {
    try {
      const ctx = await getSpeakerContext(socket, { slug, key, questionId });
      if (!ctx) return;

      await stmts.unfocusAll.run(ctx.session.id);
      await stmts.setQuestionStatus.run('focused', questionId);

      await broadcastQuestions(slug, ctx.session.id);
      const focused = await stmts.getQuestion.get(questionId);
      io.to(slug).emit('question-focused', focused);
    } catch (err) {
      console.error('Error in focus-question:', err);
    }
  });

  socket.on('unfocus-question', async ({ slug, key, questionId }) => {
    try {
      const ctx = await getSpeakerContext(socket, { slug, key, questionId });
      if (!ctx) return;

      await stmts.setQuestionStatus.run('active', questionId);

      await broadcastQuestions(slug, ctx.session.id);
      io.to(slug).emit('question-unfocused');
    } catch (err) {
      console.error('Error in unfocus-question:', err);
    }
  });

  socket.on('answer-question', async ({ slug, key, questionId }) => {
    try {
      const ctx = await getSpeakerContext(socket, { slug, key, questionId });
      if (!ctx) return;

      await stmts.setQuestionStatus.run('answered', questionId);

      await broadcastQuestions(slug, ctx.session.id);
      io.to(slug).emit('question-unfocused');
    } catch (err) {
      console.error('Error in answer-question:', err);
    }
  });

  socket.on('hide-question', async ({ slug, key, questionId }) => {
    try {
      const ctx = await getSpeakerContext(socket, { slug, key, questionId });
      if (!ctx) return;

      await stmts.setQuestionStatus.run('hidden', questionId);

      await broadcastQuestions(slug, ctx.session.id);
    } catch (err) {
      console.error('Error in hide-question:', err);
    }
  });

  socket.on('edit-question', async ({ slug, questionId, newText, visitorId }) => {
    try {
      const ctx = await getSessionAndQuestion(slug, questionId);
      if (!ctx) return;
      const { question } = ctx;

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

      await broadcastQuestions(slug, ctx.session.id);
    } catch (err) {
      console.error('Error in edit-question:', err);
      socket.emit('error-message', 'Noe gikk galt. Prøv igjen.');
    }
  });

  socket.on('delete-own-question', async ({ slug, questionId, visitorId }) => {
    try {
      const ctx = await getSessionAndQuestion(slug, questionId);
      if (!ctx) return;

      if (!visitorId || ctx.question.visitor_id !== visitorId) {
        socket.emit('error-message', 'Du kan bare slette dine egne spørsmål.');
        return;
      }

      await stmts.deleteVotesForQuestion.run(questionId);
      await stmts.deleteQuestion.run(questionId);

      await broadcastQuestions(slug, ctx.session.id);
    } catch (err) {
      console.error('Error in delete-own-question:', err);
      socket.emit('error-message', 'Noe gikk galt. Prøv igjen.');
    }
  });

  socket.on('delete-question', async ({ slug, key, questionId }) => {
    try {
      const ctx = await getSpeakerContext(socket, { slug, key, questionId });
      if (!ctx) return;

      await stmts.deleteVotesForQuestion.run(questionId);
      await stmts.deleteQuestion.run(questionId);

      await broadcastQuestions(slug, ctx.session.id);
    } catch (err) {
      console.error('Error in delete-question:', err);
    }
  });
});

// Ugyldig payload (f.eks. null) kaster i destructuring før try/catch. Ikke la det ta ned serveren.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
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
