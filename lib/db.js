import { randomBytes, scryptSync } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env automatically if available
try {
  if (process.loadEnvFile) {
    process.loadEnvFile();
  }
} catch (e) {
  // .env file is optional in containerized/production environments
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '..', 'data.db');

const TURSO_URL = (process.env.TURSO_DATABASE_URL || process.env.URSO_DATABASE_URL || '').trim();
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || process.env.URSO_AUTH_TOKEN || '').trim();
export const isCloudDb = Boolean(TURSO_URL && TURSO_TOKEN);

let localSqlite = null;
if (!isCloudDb) {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    localSqlite = new DatabaseSync(DB_PATH);
    localSqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;
    `);
  } catch (err) {
    console.warn('[DB] Local SQLite driver notice:', err.message);
  }
}

// Turso Cloud HTTP Client
const tursoPipelineUrl = TURSO_URL
  ? TURSO_URL.replace('libsql://', 'https://').replace(/\/$/, '') + '/v2/pipeline'
  : null;

function formatTursoArgs(args) {
  return args.map(arg => {
    if (arg === null || arg === undefined) return { type: 'null' };
    if (typeof arg === 'number') {
      return Number.isInteger(arg)
        ? { type: 'integer', value: String(arg) }
        : { type: 'float', value: arg };
    }
    if (typeof arg === 'boolean') {
      return { type: 'integer', value: arg ? '1' : '0' };
    }
    return { type: 'text', value: String(arg) };
  });
}

function parseTursoResult(execRes) {
  if (!execRes) return { rows: [], changes: 0, lastInsertRowid: null };
  const cols = execRes.cols ? execRes.cols.map(c => c.name) : [];
  const rows = execRes.rows ? execRes.rows.map(row => {
    const obj = {};
    row.forEach((cell, i) => {
      let val = cell.value;
      if (cell.type === 'integer') val = Number(val);
      else if (cell.type === 'float') val = Number(val);
      else if (cell.type === 'null') val = null;
      obj[cols[i]] = val;
    });
    return obj;
  }) : [];

  return {
    rows,
    changes: execRes.affected_row_count || 0,
    lastInsertRowid: execRes.last_insert_rowid
  };
}

async function executeTurso(sql, args = []) {
  const formattedArgs = formatTursoArgs(args);
  const res = await fetch(tursoPipelineUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TURSO_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [
        {
          type: 'execute',
          stmt: { sql, args: formattedArgs }
        },
        { type: 'close' }
      ]
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Turso HTTP Error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const firstResult = data.results && data.results[0];
  if (!firstResult) {
    return { rows: [], changes: 0, lastInsertRowid: null };
  }
  if (firstResult.type === 'error') {
    throw new Error(`Turso SQL Error: ${firstResult.error?.message || 'Unknown error'}`);
  }

  return parseTursoResult(firstResult.response?.result);
}

export const db = {
  isCloud: isCloudDb,

  prepare(sql) {
    if (!isCloudDb) {
      const localStmt = localSqlite.prepare(sql);
      return {
        get(...args) {
          return Promise.resolve(localStmt.get(...args));
        },
        all(...args) {
          return Promise.resolve(localStmt.all(...args));
        },
        run(...args) {
          return Promise.resolve(localStmt.run(...args));
        }
      };
    }

    return {
      async get(...args) {
        const res = await executeTurso(sql, args);
        return res.rows[0] || null;
      },
      async all(...args) {
        const res = await executeTurso(sql, args);
        return res.rows;
      },
      async run(...args) {
        const res = await executeTurso(sql, args);
        return {
          changes: res.changes,
          lastInsertRowid: res.lastInsertRowid
        };
      }
    };
  },

  async exec(sql) {
    if (!isCloudDb) {
      return localSqlite.exec(sql);
    }
    const statements = sql
      .split(/;\s*[\r\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const requests = statements.map(s => ({
      type: 'execute',
      stmt: { sql: s, args: [] }
    }));
    requests.push({ type: 'close' });

    const res = await fetch(tursoPipelineUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TURSO_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requests })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Turso HTTP Error (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data;
  },

  close() {
    if (localSqlite) {
      try {
        localSqlite.close();
      } catch (e) {}
    }
  }
};

// Initialize database schema
export async function initDatabase() {
  const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      name TEXT NOT NULL,
      handle TEXT UNIQUE NOT NULL,
      bio TEXT,
      avatar TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      book_title TEXT NOT NULL,
      book_author TEXT NOT NULL,
      cover_url TEXT NOT NULL,
      genre TEXT NOT NULL,
      rating REAL NOT NULL CHECK(rating >= 0.5 AND rating <= 5.0),
      review_text TEXT NOT NULL,
      quote TEXT,
      book_link TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS likes (
      user_id TEXT NOT NULL,
      review_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, review_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS saves (
      user_id TEXT NOT NULL,
      review_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, review_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (follower_id, following_id),
      FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_reviews_genre ON reviews(genre)`,
    `CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comments_review ON comments(review_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`
  ];

  for (const stmt of schemaStatements) {
    if (!isCloudDb) {
      localSqlite.exec(stmt);
    } else {
      await executeTurso(stmt, []);
    }
  }

  // Seed default data if empty
  const userCountRow = await db.prepare('SELECT COUNT(*) as count FROM users').get();
  const userCount = userCountRow ? userCountRow.count : 0;
  if (userCount === 0) {
    await seedDatabase();
  }
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

async function seedDatabase() {
  const insertUser = db.prepare(`
    INSERT INTO users (id, username, email, password_hash, salt, name, handle, bio, avatar)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const demoPassword = 'Password123!';

  const demoUsers = [
    {
      id: 'user_elena',
      username: 'elena',
      email: 'elena@bookgram.net',
      name: 'Elena Vance',
      handle: '@elena_reads',
      bio: 'Literary fiction fanatic & speculative fiction enthusiast. Coffee, heavy hardcovers, and poignant endings.',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&auto=format&fit=crop&q=80'
    },
    {
      id: 'user_marcus',
      username: 'marcus',
      email: 'marcus@bookgram.net',
      name: 'Marcus Chen',
      handle: '@chen_books',
      bio: 'Sci-fi collector, Hugo awards tracker, and coffee-fueled world builder.',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=240&auto=format&fit=crop&q=80'
    },
    {
      id: 'user_clara',
      username: 'clara',
      email: 'clara@bookgram.net',
      name: 'Clara Oswald',
      handle: '@impossible_reader',
      bio: 'Historical fiction & cozy mysteries. Reviewing 100 books every year.',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=240&auto=format&fit=crop&q=80'
    },
    {
      id: 'user_arthur',
      username: 'arthur',
      email: 'arthur@bookgram.net',
      name: 'Arthur Pendelton',
      handle: '@arthur_classics',
      bio: '19th century literature critic & philosophy essayist.',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=240&auto=format&fit=crop&q=80'
    }
  ];

  for (const u of demoUsers) {
    const salt = randomBytes(16).toString('hex');
    const pwdHash = hashPassword(demoPassword, salt);
    await insertUser.run(u.id, u.username, u.email, pwdHash, salt, u.name, u.handle, u.bio, u.avatar);
  }

  // Seed Follows
  const insertFollow = db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)');
  await insertFollow.run('user_elena', 'user_marcus');
  await insertFollow.run('user_elena', 'user_clara');
  await insertFollow.run('user_marcus', 'user_elena');
  await insertFollow.run('user_clara', 'user_elena');
  await insertFollow.run('user_arthur', 'user_marcus');

  // Seed Reviews
  const insertReview = db.prepare(`
    INSERT INTO reviews (id, user_id, book_title, book_author, cover_url, genre, rating, review_text, quote, book_link, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
  `);

  await insertReview.run(
    'rev_1',
    'user_marcus',
    'Dune',
    'Frank Herbert',
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800&auto=format&fit=crop&q=80',
    'Sci-Fi & Fantasy',
    5.0,
    'Herbert crafts an unmatched tapestry of ecology, religion, and geopolitical dominance on Arrakis. Paul Atreides’ descent into an inevitable messianic mythos remains one of the finest psychological masterclasses in speculative fiction history. The desert comes alive in every sensory detail.',
    '“I must not fear. Fear is the mind-killer. Fear is the little-death that brings total obliteration.”',
    'https://www.google.com/search?q=Dune+Frank+Herbert+book',
    '-4 hours'
  );

  await insertReview.run(
    'rev_2',
    'user_elena',
    'The Seven Husbands of Evelyn Hugo',
    'Taylor Jenkins Reid',
    'https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=800&auto=format&fit=crop&q=80',
    'Fiction',
    4.5,
    'Aging and reclusive Hollywood movie icon Evelyn Hugo is finally ready to tell the truth about her glamorous and scandalous life. It is an exploration of ambition, queer identity, and the heavy sacrifices one makes for self-preservation in a brutal spotlight.',
    '“They are just husbands. But I am Evelyn Hugo.”',
    'https://www.google.com/search?q=The+Seven+Husbands+of+Evelyn+Hugo',
    '-1 day'
  );

  await insertReview.run(
    'rev_3',
    'user_clara',
    'Circe',
    'Madeline Miller',
    'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=800&auto=format&fit=crop&q=80',
    'Sci-Fi & Fantasy',
    5.0,
    'Madeline Miller breathes breathtaking humanity into the mythical witch of Aiaia. A feminist triumph about solitude, transformative grief, and defying tyrannical gods to discover authentic autonomy.',
    '“Humbling women seems to have become a chief pastime of poets. As if there can be no story unless we crawl and weep.”',
    'https://www.google.com/search?q=Circe+Madeline+Miller',
    '-2 days'
  );

  // Seed Likes
  const insertLike = db.prepare('INSERT INTO likes (user_id, review_id) VALUES (?, ?)');
  await insertLike.run('user_elena', 'rev_1');
  await insertLike.run('user_clara', 'rev_1');
  await insertLike.run('user_marcus', 'rev_2');
  await insertLike.run('user_elena', 'rev_3');

  // Seed Saves
  const insertSave = db.prepare('INSERT INTO saves (user_id, review_id) VALUES (?, ?)');
  await insertSave.run('user_elena', 'rev_1');

  // Seed Comments
  const insertComment = db.prepare(`
    INSERT INTO comments (id, review_id, user_id, text, created_at)
    VALUES (?, ?, ?, ?, datetime('now', ?))
  `);
  await insertComment.run(
    'c_1',
    'rev_1',
    'user_elena',
    'The ecological world-building holds up so shockingly well today! Brilliant review Marcus.',
    '-2 hours'
  );
  await insertComment.run(
    'c_2',
    'rev_1',
    'user_clara',
    'Herbert’s political tension in the first 100 pages is breathtaking.',
    '-1 hour'
  );
  await insertComment.run(
    'c_3',
    'rev_2',
    'user_arthur',
    'I loved the narrative structure between Monique and Evelyn. Kept turning until 3 AM.',
    '-3 hours'
  );
}
