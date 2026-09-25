const { createClient } = require('@libsql/client');

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:tkai.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Hjelpefunksjoner som matcher better-sqlite3 semantikk (.run / .get / .all)
function makeRun(sql) {
  return async (...args) => client.execute({ sql, args });
}

function makeGet(sql) {
  return async (...args) => {
    const result = await client.execute({ sql, args });
    return result.rows[0]; // undefined hvis tom
  };
}

function makeAll(sql) {
  return async (...args) => {
    const result = await client.execute({ sql, args });
    return result.rows;
  };
}

// Prepared statements — samme nøkler som før, nå async
const stmts = {
  createSession: { run: makeRun(
    'INSERT INTO sessions (slug, title, speaker, speaker_image, admin_key, event_slug) VALUES (?, ?, ?, ?, ?, ?)'
  )},
  getSessionBySlug: { get: makeGet(
    'SELECT * FROM sessions WHERE slug = ?'
  )},
  createQuestion: { run: makeRun(
    'INSERT INTO questions (session_id, text, nickname, visitor_id) VALUES (?, ?, ?, ?)'
  )},
  getAllQuestions: { all: makeAll(
    `SELECT * FROM questions WHERE session_id = ?
     ORDER BY CASE status WHEN 'focused' THEN 0 WHEN 'active' THEN 1 WHEN 'answered' THEN 2 ELSE 3 END, upvotes DESC, created_at DESC`
  )},
  getQuestion: { get: makeGet(
    'SELECT * FROM questions WHERE id = ?'
  )},
  upvoteQuestion: { run: makeRun(
    'UPDATE questions SET upvotes = upvotes + 1 WHERE id = ?'
  )},
  addVote: { run: makeRun(
    'INSERT OR IGNORE INTO votes (question_id, visitor_id) VALUES (?, ?)'
  )},
  hasVoted: { get: makeGet(
    'SELECT 1 FROM votes WHERE question_id = ? AND visitor_id = ?'
  )},
  setQuestionStatus: { run: makeRun(
    'UPDATE questions SET status = ? WHERE id = ?'
  )},
  unfocusAll: { run: makeRun(
    `UPDATE questions SET status = 'active' WHERE session_id = ? AND status = 'focused'`
  )},
  updateQuestionText: { run: makeRun(
    'UPDATE questions SET text = ? WHERE id = ?'
  )},
  resetVotes: { run: makeRun(
    'UPDATE questions SET upvotes = 0 WHERE id = ?'
  )},
  deleteQuestion: { run: makeRun(
    'DELETE FROM questions WHERE id = ?'
  )},
  deleteVotesForQuestion: { run: makeRun(
    'DELETE FROM votes WHERE question_id = ?'
  )},
  // Sesjoner koblet til et TKAI-arrangement (event_slug) arkiveres og slettes aldri
  deleteOldSessions: { run: makeRun(
    `DELETE FROM sessions WHERE event_slug IS NULL AND created_at < datetime('now', '-24 hours')`
  )},
  getOldSessionIds: { all: makeAll(
    `SELECT id FROM sessions WHERE event_slug IS NULL AND created_at < datetime('now', '-24 hours')`
  )},
  deleteQuestionsBySession: { run: makeRun(
    'DELETE FROM questions WHERE session_id = ?'
  )},
  // /live: sesjonen som er satt live siste 12 t, ellers nyeste TKAI-sesjon siste 12 t
  getLiveSession: { get: makeGet(
    `SELECT slug FROM sessions
     WHERE is_live = 1 AND event_slug IS NOT NULL AND live_at > datetime('now', '-12 hours')
     ORDER BY live_at DESC LIMIT 1`
  )},
  getLatestEventSession: { get: makeGet(
    `SELECT slug FROM sessions
     WHERE event_slug IS NOT NULL AND created_at > datetime('now', '-12 hours')
     ORDER BY created_at DESC, id DESC LIMIT 1`
  )},
  getOtherLiveSlugs: { all: makeAll(
    `SELECT slug FROM sessions WHERE event_slug = ? AND is_live = 1 AND id != ?`
  )},
  // Bare én live-sesjon per arrangement: nullstill de andre og sett denne i samme transaksjon
  setLive: { run: async (sessionId, eventSlug) => client.batch([
    { sql: 'UPDATE sessions SET is_live = 0 WHERE event_slug = ? AND id != ?', args: [eventSlug, sessionId] },
    { sql: `UPDATE sessions SET is_live = 1, live_at = datetime('now'), last_activity_at = datetime('now') WHERE id = ?`, args: [sessionId] },
  ], 'write') },
  // Siste aktivitet (nytt spørsmål, stemme, satt live) styrer når et arkiv blir skrivebeskyttet
  touchActivity: { run: makeRun(
    `UPDATE sessions SET last_activity_at = datetime('now') WHERE id = ?`
  )},
  unsetLive: { run: makeRun(
    'UPDATE sessions SET is_live = 0 WHERE id = ?'
  )},
  getSessionCount: { get: makeGet(
    `SELECT value FROM counters WHERE key = 'total_sessions'`
  )},
  incrementSessionCount: { run: makeRun(
    `UPDATE counters SET value = value + 1 WHERE key = 'total_sessions'`
  )},
};

// Kjøres ved oppstart — oppretter tabeller og indekser
async function initDb() {
  await client.execute('PRAGMA foreign_keys = ON');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      speaker TEXT NOT NULL,
      speaker_image TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      nickname TEXT NOT NULL,
      visitor_id TEXT,
      upvotes INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      visitor_id TEXT NOT NULL,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
      UNIQUE(question_id, visitor_id)
    )
  `);

  await client.execute('CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id, status)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_questions_created ON questions(created_at)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_sessions_slug ON sessions(slug)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at)');

  // Migrasjon: legg til visitor_id hvis den mangler
  try {
    await client.execute('ALTER TABLE questions ADD COLUMN visitor_id TEXT');
  } catch (e) {
    // Kolonnen finnes allerede
  }

  // Migrasjon: adminnøkkel for speaker-handlinger (NULL for gamle sesjoner)
  try {
    await client.execute('ALTER TABLE sessions ADD COLUMN admin_key TEXT');
  } catch (e) {
    // Kolonnen finnes allerede
  }

  // Migrasjon: kobling til TKAI-arrangement, f.eks. 'tkai-7' (NULL = vanlig sesjon)
  try {
    await client.execute('ALTER TABLE sessions ADD COLUMN event_slug TEXT');
  } catch (e) {
    // Kolonnen finnes allerede
  }
  await client.execute('CREATE INDEX IF NOT EXISTS idx_sessions_event ON sessions(event_slug)');

  // Migrasjon: hvilken sesjon /live peker på ("Sett som live" i speaker-visningen)
  try {
    await client.execute('ALTER TABLE sessions ADD COLUMN is_live INTEGER DEFAULT 0');
  } catch (e) {
    // Kolonnen finnes allerede
  }
  try {
    await client.execute('ALTER TABLE sessions ADD COLUMN live_at TEXT');
  } catch (e) {
    // Kolonnen finnes allerede
  }

  // Migrasjon: siste aktivitet (NULL = bruk created_at)
  try {
    await client.execute('ALTER TABLE sessions ADD COLUMN last_activity_at TEXT');
  } catch (e) {
    // Kolonnen finnes allerede
  }

  // Persistent teller for totalt antall sesjoner
  await client.execute(`
    CREATE TABLE IF NOT EXISTS counters (
      key TEXT PRIMARY KEY,
      value INTEGER DEFAULT 0
    )
  `);
  await client.execute({
    sql: `INSERT OR IGNORE INTO counters (key, value) VALUES ('total_sessions', 78)`,
    args: [],
  });
}

module.exports = { initDb, stmts };
