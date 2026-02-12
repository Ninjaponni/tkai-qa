const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'tkai.db'));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    speaker TEXT NOT NULL,
    speaker_image TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    nickname TEXT NOT NULL,
    upvotes INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    visitor_id TEXT NOT NULL,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    UNIQUE(question_id, visitor_id)
  );
`);

// Prepared statements
const stmts = {
  createSession: db.prepare(
    'INSERT INTO sessions (slug, title, speaker, speaker_image) VALUES (?, ?, ?, ?)'
  ),
  getSessionBySlug: db.prepare(
    'SELECT * FROM sessions WHERE slug = ?'
  ),
  createQuestion: db.prepare(
    'INSERT INTO questions (session_id, text, nickname) VALUES (?, ?, ?)'
  ),
  getQuestions: db.prepare(
    `SELECT * FROM questions WHERE session_id = ? AND status NOT IN ('hidden', 'answered')
     ORDER BY CASE status WHEN 'focused' THEN 0 ELSE 1 END, upvotes DESC, created_at DESC`
  ),
  getQuestionsWithAnswered: db.prepare(
    `SELECT * FROM questions WHERE session_id = ? AND status != 'hidden'
     ORDER BY CASE status WHEN 'focused' THEN 0 WHEN 'active' THEN 1 WHEN 'answered' THEN 2 ELSE 3 END, upvotes DESC, created_at DESC`
  ),
  getAllQuestions: db.prepare(
    `SELECT * FROM questions WHERE session_id = ?
     ORDER BY CASE status WHEN 'focused' THEN 0 WHEN 'active' THEN 1 WHEN 'answered' THEN 2 ELSE 3 END, upvotes DESC, created_at DESC`
  ),
  getQuestion: db.prepare(
    'SELECT * FROM questions WHERE id = ?'
  ),
  upvoteQuestion: db.prepare(
    'UPDATE questions SET upvotes = upvotes + 1 WHERE id = ?'
  ),
  addVote: db.prepare(
    'INSERT OR IGNORE INTO votes (question_id, visitor_id) VALUES (?, ?)'
  ),
  hasVoted: db.prepare(
    'SELECT 1 FROM votes WHERE question_id = ? AND visitor_id = ?'
  ),
  setQuestionStatus: db.prepare(
    'UPDATE questions SET status = ? WHERE id = ?'
  ),
  unfocusAll: db.prepare(
    `UPDATE questions SET status = 'active' WHERE session_id = ? AND status = 'focused'`
  ),
  updateQuestionText: db.prepare(
    'UPDATE questions SET text = ? WHERE id = ?'
  ),
  resetVotes: db.prepare(
    'UPDATE questions SET upvotes = 0 WHERE id = ?'
  ),
  deleteQuestion: db.prepare(
    'DELETE FROM questions WHERE id = ?'
  ),
  deleteVotesForQuestion: db.prepare(
    'DELETE FROM votes WHERE question_id = ?'
  ),
  deleteOldSessions: db.prepare(
    `DELETE FROM sessions WHERE created_at < datetime('now', '-24 hours')`
  ),
  getOldSessionIds: db.prepare(
    `SELECT id FROM sessions WHERE created_at < datetime('now', '-24 hours')`
  ),
  deleteQuestionsBySession: db.prepare(
    'DELETE FROM questions WHERE session_id = ?'
  ),
};

module.exports = { db, stmts };
