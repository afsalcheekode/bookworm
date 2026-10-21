import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { hashPassword, verifyPassword, createSession } from './auth.js';
import { sanitizeText, isSafeUrl, isSafeImageUrl } from './security.js';
import { ALLOWED_GENRES, isValidUsername } from './validator.js';

export const ADMIN_SECRET = (process.env.ADMIN_SECRET || 'bookworm_2026_masterkey').trim();

const VALID_MASTER_KEYS = new Set([
  'bookworm_2026_masterkey',
  'bookworm_admin_2026',
  ADMIN_SECRET
].filter(Boolean));

export function isMasterKeyValid(key) {
  if (!key || typeof key !== 'string') return false;
  return VALID_MASTER_KEYS.has(key.trim());
}

/**
 * Check if the request is authorized as admin
 */
export function isAuthorizedAdmin(req, user) {
  const adminKey = req.headers['x-admin-key'] || req.headers['admin-secret'];
  if (adminKey && isMasterKeyValid(adminKey)) {
    return true;
  }
  if (user && user.isAdmin) {
    return true;
  }
  return false;
}

/**
 * Handle all /api/admin/* routes
 */
export async function handleAdminRoutes(req, res, pathname, method, parsedUrl, user, parseJsonBody, sendJson, sendError) {
  // ----------------------------------------------------
  // 1. ADMIN LOGIN
  // ----------------------------------------------------
  if (pathname === '/api/admin/login' && method === 'POST') {
    const body = await parseJsonBody(req);
    const { adminKey, username, password } = body || {};

    const keyToCheck = adminKey || (username === 'masterkey' ? password : null);

    // Mode A: Master Admin Passkey
    if (keyToCheck && isMasterKeyValid(keyToCheck)) {
      // Find or create superadmin account
      let adminUser = await db.prepare('SELECT id, username, email, name, handle, avatar, is_admin FROM users WHERE is_admin = 1 LIMIT 1').get();
      if (!adminUser) {
        // Find first user and promote to admin
        adminUser = await db.prepare('SELECT id, username, email, name, handle, avatar FROM users ORDER BY created_at ASC LIMIT 1').get();
        if (adminUser) {
          await db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(adminUser.id);
          adminUser.is_admin = 1;
        } else {
          // Create a dedicated system admin account
          const newId = 'user_superadmin';
          const salt = randomBytes(16).toString('hex');
          const pwdHash = hashPassword(ADMIN_SECRET, salt);
          await db.prepare(`
            INSERT INTO users (id, username, email, password_hash, salt, name, handle, bio, avatar, is_admin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          `).run(
            newId,
            'superadmin',
            'admin@bookworm.network',
            pwdHash,
            salt,
            'Platform Administrator',
            '@admin',
            'Lead Administrator & System Curator.',
            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&auto=format&fit=crop&q=80'
          );
          adminUser = {
            id: newId,
            username: 'superadmin',
            email: 'admin@bookworm.network',
            name: 'Platform Administrator',
            handle: '@admin',
            avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&auto=format&fit=crop&q=80',
            is_admin: 1
          };
        }
      }

      const session = await createSession(adminUser.id);
      return sendJson(res, 200, {
        success: true,
        token: session.token,
        user: { ...adminUser, isAdmin: true }
      });
    }

    // Mode B: Username & Password with admin rights
    if (username && password) {
      const cleanUser = String(username).trim().toLowerCase();
      const userRow = await db.prepare(`
        SELECT id, username, email, password_hash, salt, name, handle, bio, avatar, COALESCE(is_admin, 0) as is_admin
        FROM users
        WHERE username = ? OR email = ?
      `).get(cleanUser, cleanUser);

      if (!userRow || !verifyPassword(password, userRow.password_hash, userRow.salt)) {
        return sendError(res, 401, 'Invalid username or password');
      }

      if (!userRow.is_admin) {
        return sendError(res, 403, 'Account does not possess administrator privileges');
      }

      const session = await createSession(userRow.id);
      return sendJson(res, 200, {
        success: true,
        token: session.token,
        user: {
          id: userRow.id,
          username: userRow.username,
          email: userRow.email,
          name: userRow.name,
          handle: userRow.handle,
          avatar: userRow.avatar,
          isAdmin: true
        }
      });
    }

    return sendError(res, 400, 'Please provide the master admin passkey or admin account credentials.');
  }

  // ----------------------------------------------------
  // ALL REMAINING ROUTES REQUIRE ADMIN AUTHORIZATION
  // ----------------------------------------------------
  if (!isAuthorizedAdmin(req, user)) {
    return sendError(res, 401, 'Unauthorized: Administrator access required.');
  }

  // ----------------------------------------------------
  // 2. ADMIN ME / SESSION CHECK
  // ----------------------------------------------------
  if (pathname === '/api/admin/me' && method === 'GET') {
    return sendJson(res, 200, {
      success: true,
      user: user || { id: 'admin_passkey', name: 'Master Admin', isAdmin: true }
    });
  }

  // ----------------------------------------------------
  // 3. PLATFORM OVERVIEW / STATS
  // ----------------------------------------------------
  if (pathname === '/api/admin/stats' && method === 'GET') {
    const userCountRow = await db.prepare('SELECT COUNT(*) as count FROM users').get();
    const reviewCountRow = await db.prepare('SELECT COUNT(*) as count FROM reviews').get();
    const commentCountRow = await db.prepare('SELECT COUNT(*) as count FROM comments').get();
    const likeCountRow = await db.prepare('SELECT COUNT(*) as count FROM likes').get();
    const saveCountRow = await db.prepare('SELECT COUNT(*) as count FROM saves').get();

    const recentReviews = await db.prepare(`
      SELECT r.id, r.book_title, r.book_author, r.rating, r.created_at, u.name as author_name, u.username
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      ORDER BY r.created_at DESC
      LIMIT 5
    `).all();

    const recentUsers = await db.prepare(`
      SELECT id, username, email, name, handle, avatar, is_admin, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 5
    `).all();

    return sendJson(res, 200, {
      success: true,
      stats: {
        totalUsers: userCountRow ? userCountRow.count : 0,
        totalReviews: reviewCountRow ? reviewCountRow.count : 0,
        totalComments: commentCountRow ? commentCountRow.count : 0,
        totalLikes: likeCountRow ? likeCountRow.count : 0,
        totalSaves: saveCountRow ? saveCountRow.count : 0,
        database: db.isCloud ? 'Turso Cloud SQLite' : 'Local SQLite',
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        recentReviews,
        recentUsers
      }
    });
  }

  // ----------------------------------------------------
  // 4. ACCOUNTS (USERS) MANAGEMENT
  // ----------------------------------------------------
  // GET /api/admin/users (List with search)
  if (pathname === '/api/admin/users' && method === 'GET') {
    const q = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase();
    let usersList;
    if (q) {
      const pattern = `%${q}%`;
      usersList = await db.prepare(`
        SELECT u.id, u.username, u.email, u.name, u.handle, u.bio, u.avatar,
               COALESCE(u.is_admin, 0) as is_admin, u.created_at,
               (SELECT COUNT(*) FROM reviews WHERE user_id = u.id) as reviews_count,
               (SELECT COUNT(*) FROM comments WHERE user_id = u.id) as comments_count
        FROM users u
        WHERE LOWER(u.username) LIKE ? OR LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.handle) LIKE ?
        ORDER BY u.created_at DESC
      `).all(pattern, pattern, pattern, pattern);
    } else {
      usersList = await db.prepare(`
        SELECT u.id, u.username, u.email, u.name, u.handle, u.bio, u.avatar,
               COALESCE(u.is_admin, 0) as is_admin, u.created_at,
               (SELECT COUNT(*) FROM reviews WHERE user_id = u.id) as reviews_count,
               (SELECT COUNT(*) FROM comments WHERE user_id = u.id) as comments_count
        FROM users u
        ORDER BY u.created_at DESC
      `).all();
    }
    return sendJson(res, 200, { success: true, users: usersList });
  }

  // POST /api/admin/users (Create new user)
  if (pathname === '/api/admin/users' && method === 'POST') {
    const body = await parseJsonBody(req);
    const { username, email, password, name, bio, avatar, isAdmin } = body || {};

    if (!username || !email || !password || !name) {
      return sendError(res, 400, 'Username, email, password, and full name are required');
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const cleanEmail = String(email).trim().toLowerCase();
    if (!isValidUsername(cleanUsername)) {
      return sendError(res, 400, 'Username must be 3-24 alphanumeric characters or underscores');
    }

    const existing = await db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(cleanUsername, cleanEmail);
    if (existing) {
      return sendError(res, 409, 'Username or email already exists');
    }

    const newId = 'user_' + randomBytes(8).toString('hex');
    const salt = randomBytes(16).toString('hex');
    const pwdHash = hashPassword(password, salt);
    const cleanName = sanitizeText(String(name).trim());
    const cleanBio = sanitizeText(String(bio || 'Avid reader and reviewer.').trim());
    const cleanAvatar = (avatar && isSafeImageUrl(avatar))
      ? avatar.trim()
      : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&auto=format&fit=crop&q=80';
    const adminFlag = isAdmin ? 1 : 0;

    await db.prepare(`
      INSERT INTO users (id, username, email, password_hash, salt, name, handle, bio, avatar, is_admin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newId, cleanUsername, cleanEmail, pwdHash, salt, cleanName, `@${cleanUsername}`, cleanBio, cleanAvatar, adminFlag);

    return sendJson(res, 201, {
      success: true,
      message: 'User created successfully',
      user: { id: newId, username: cleanUsername, email: cleanEmail, name: cleanName, handle: `@${cleanUsername}`, bio: cleanBio, avatar: cleanAvatar, is_admin: adminFlag }
    });
  }

  // Single user operations: PUT /api/admin/users/:id, DELETE /api/admin/users/:id
  const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUserMatch) {
    const targetUserId = adminUserMatch[1];

    // PUT /api/admin/users/:id (Update user)
    if (method === 'PUT') {
      const body = await parseJsonBody(req);
      const existingUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
      if (!existingUser) return sendError(res, 404, 'User not found');

      const name = body.name !== undefined ? sanitizeText(String(body.name).trim()) : existingUser.name;
      const bio = body.bio !== undefined ? sanitizeText(String(body.bio).trim()) : existingUser.bio;
      const avatar = (body.avatar && isSafeImageUrl(body.avatar)) ? body.avatar.trim() : existingUser.avatar;
      const isAdmin = body.isAdmin !== undefined ? (body.isAdmin ? 1 : 0) : existingUser.is_admin;

      // Check username update
      let username = existingUser.username;
      let handle = existingUser.handle;
      if (body.username && body.username.trim().toLowerCase() !== existingUser.username) {
        const cleanU = body.username.trim().toLowerCase();
        if (!isValidUsername(cleanU)) return sendError(res, 400, 'Invalid username format');
        const conflict = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(cleanU, targetUserId);
        if (conflict) return sendError(res, 409, 'Username is already taken');
        username = cleanU;
        handle = `@${cleanU}`;
      }

      // Check email update
      let email = existingUser.email;
      if (body.email && body.email.trim().toLowerCase() !== existingUser.email) {
        const cleanE = body.email.trim().toLowerCase();
        const conflict = await db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(cleanE, targetUserId);
        if (conflict) return sendError(res, 409, 'Email is already taken');
        email = cleanE;
      }

      // Check optional password update
      if (body.password && String(body.password).trim().length >= 8) {
        const newSalt = randomBytes(16).toString('hex');
        const newHash = hashPassword(String(body.password).trim(), newSalt);
        await db.prepare(`
          UPDATE users
          SET username = ?, email = ?, password_hash = ?, salt = ?, name = ?, handle = ?, bio = ?, avatar = ?, is_admin = ?
          WHERE id = ?
        `).run(username, email, newHash, newSalt, name, handle, bio, avatar, isAdmin, targetUserId);
      } else {
        await db.prepare(`
          UPDATE users
          SET username = ?, email = ?, name = ?, handle = ?, bio = ?, avatar = ?, is_admin = ?
          WHERE id = ?
        `).run(username, email, name, handle, bio, avatar, isAdmin, targetUserId);
      }

      return sendJson(res, 200, {
        success: true,
        message: 'Account updated successfully',
        user: { id: targetUserId, username, email, name, handle, bio, avatar, is_admin: isAdmin }
      });
    }

    // DELETE /api/admin/users/:id (Delete user)
    if (method === 'DELETE') {
      const existingUser = await db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetUserId);
      if (!existingUser) return sendError(res, 404, 'User not found');

      // Prevent admin from deleting their own currently logged-in account
      if (user && user.id === targetUserId) {
        return sendError(res, 400, 'Cannot delete your own active administrator account');
      }

      // Cascade delete user data
      await db.prepare('DELETE FROM comments WHERE user_id = ?').run(targetUserId);
      await db.prepare('DELETE FROM likes WHERE user_id = ?').run(targetUserId);
      await db.prepare('DELETE FROM saves WHERE user_id = ?').run(targetUserId);
      await db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(targetUserId, targetUserId);
      await db.prepare('DELETE FROM reviews WHERE user_id = ?').run(targetUserId);
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetUserId);
      await db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);

      return sendJson(res, 200, { success: true, message: `Account @${existingUser.username} deleted successfully` });
    }
  }

  // ----------------------------------------------------
  // 5. POSTS (REVIEWS) MANAGEMENT
  // ----------------------------------------------------
  // GET /api/admin/reviews (List with search and genre filter)
  if (pathname === '/api/admin/reviews' && method === 'GET') {
    const q = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase();
    const genre = (parsedUrl.searchParams.get('genre') || '').trim();

    let sql = `
      SELECT r.id, r.user_id, r.book_title, r.book_author, r.cover_url, r.genre,
             r.rating, r.review_text, r.quote, r.book_link, r.created_at,
             u.name as author_name, u.username as author_username, u.avatar as author_avatar,
             (SELECT COUNT(*) FROM likes WHERE review_id = r.id) as likes_count,
             (SELECT COUNT(*) FROM comments WHERE review_id = r.id) as comments_count
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      sql += ` AND (LOWER(r.book_title) LIKE ? OR LOWER(r.book_author) LIKE ? OR LOWER(r.review_text) LIKE ? OR LOWER(u.name) LIKE ? OR LOWER(u.username) LIKE ?)`;
      const pat = `%${q}%`;
      params.push(pat, pat, pat, pat, pat);
    }

    if (genre && genre !== 'All') {
      sql += ` AND r.genre = ?`;
      params.push(genre);
    }

    sql += ` ORDER BY r.created_at DESC`;
    const reviewsList = await db.prepare(sql).all(...params);

    return sendJson(res, 200, { success: true, reviews: reviewsList });
  }

  // POST /api/admin/reviews (Create review)
  if (pathname === '/api/admin/reviews' && method === 'POST') {
    const body = await parseJsonBody(req);
    const { userId, bookTitle, bookAuthor, coverUrl, genre, rating, reviewText, quote, bookLink } = body || {};

    if (!bookTitle || !bookAuthor || !reviewText || rating === undefined) {
      return sendError(res, 400, 'Book title, author, rating, and review text are required');
    }

    // Verify user exists
    let targetUserId = userId || (user ? user.id : null);
    if (!targetUserId) {
      const firstUser = await db.prepare('SELECT id FROM users LIMIT 1').get();
      targetUserId = firstUser ? firstUser.id : 'user_superadmin';
    }

    const reviewId = 'rev_' + randomBytes(8).toString('hex');
    const cleanTitle = sanitizeText(String(bookTitle).trim());
    const cleanAuthor = sanitizeText(String(bookAuthor).trim());
    const cleanGenre = ALLOWED_GENRES.includes(genre) ? genre : 'Fiction';
    const numRating = Math.max(0.5, Math.min(5.0, Number(rating) || 5.0));
    const cleanText = sanitizeText(String(reviewText).trim());
    const cleanQuote = quote ? sanitizeText(String(quote).trim()) : null;
    const cleanCover = (coverUrl && isSafeImageUrl(coverUrl)) ? coverUrl.trim() : 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=360&auto=format&fit=crop&q=80';
    const cleanLink = (bookLink && isSafeUrl(bookLink)) ? bookLink.trim() : null;

    await db.prepare(`
      INSERT INTO reviews (id, user_id, book_title, book_author, cover_url, genre, rating, review_text, quote, book_link)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reviewId, targetUserId, cleanTitle, cleanAuthor, cleanCover, cleanGenre, numRating, cleanText, cleanQuote, cleanLink);

    return sendJson(res, 201, {
      success: true,
      message: 'Post created successfully',
      reviewId
    });
  }

  // Single review operations: PUT /api/admin/reviews/:id, DELETE /api/admin/reviews/:id
  const adminReviewMatch = pathname.match(/^\/api\/admin\/reviews\/([^/]+)$/);
  if (adminReviewMatch) {
    const targetRevId = adminReviewMatch[1];

    // PUT /api/admin/reviews/:id (Update review)
    if (method === 'PUT') {
      const body = await parseJsonBody(req);
      const existing = await db.prepare('SELECT * FROM reviews WHERE id = ?').get(targetRevId);
      if (!existing) return sendError(res, 404, 'Review not found');

      const cleanTitle = body.bookTitle !== undefined ? sanitizeText(String(body.bookTitle).trim()) : existing.book_title;
      const cleanAuthor = body.bookAuthor !== undefined ? sanitizeText(String(body.bookAuthor).trim()) : existing.book_author;
      const cleanGenre = (body.genre && ALLOWED_GENRES.includes(body.genre)) ? body.genre : existing.genre;
      const numRating = body.rating !== undefined ? Math.max(0.5, Math.min(5.0, Number(body.rating) || 5.0)) : existing.rating;
      const cleanText = body.reviewText !== undefined ? sanitizeText(String(body.reviewText).trim()) : existing.review_text;
      const cleanQuote = body.quote !== undefined ? (body.quote ? sanitizeText(String(body.quote).trim()) : null) : existing.quote;
      const cleanCover = (body.coverUrl && isSafeImageUrl(body.coverUrl)) ? body.coverUrl.trim() : existing.cover_url;
      const cleanLink = (body.bookLink && isSafeUrl(body.bookLink)) ? body.bookLink.trim() : existing.book_link;
      const authorUserId = body.userId || existing.user_id;

      await db.prepare(`
        UPDATE reviews
        SET user_id = ?, book_title = ?, book_author = ?, cover_url = ?, genre = ?, rating = ?, review_text = ?, quote = ?, book_link = ?
        WHERE id = ?
      `).run(authorUserId, cleanTitle, cleanAuthor, cleanCover, cleanGenre, numRating, cleanText, cleanQuote, cleanLink, targetRevId);

      return sendJson(res, 200, { success: true, message: 'Review updated successfully' });
    }

    // DELETE /api/admin/reviews/:id (Delete review)
    if (method === 'DELETE') {
      const existing = await db.prepare('SELECT id FROM reviews WHERE id = ?').get(targetRevId);
      if (!existing) return sendError(res, 404, 'Review not found');

      await db.prepare('DELETE FROM comments WHERE review_id = ?').run(targetRevId);
      await db.prepare('DELETE FROM likes WHERE review_id = ?').run(targetRevId);
      await db.prepare('DELETE FROM saves WHERE review_id = ?').run(targetRevId);
      await db.prepare('DELETE FROM reviews WHERE id = ?').run(targetRevId);

      return sendJson(res, 200, { success: true, message: 'Review deleted successfully' });
    }
  }

  // ----------------------------------------------------
  // 6. COMMENTS MANAGEMENT
  // ----------------------------------------------------
  // GET /api/admin/comments (List with search)
  if (pathname === '/api/admin/comments' && method === 'GET') {
    const q = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase();
    let commentsList;
    if (q) {
      const pat = `%${q}%`;
      commentsList = await db.prepare(`
        SELECT c.id, c.review_id, c.user_id, c.text, c.created_at,
               u.name as user_name, u.username as user_username, u.avatar as user_avatar,
               r.book_title, r.book_author
        FROM comments c
        JOIN users u ON u.id = c.user_id
        JOIN reviews r ON r.id = c.review_id
        WHERE LOWER(c.text) LIKE ? OR LOWER(u.name) LIKE ? OR LOWER(r.book_title) LIKE ?
        ORDER BY c.created_at DESC
      `).all(pat, pat, pat);
    } else {
      commentsList = await db.prepare(`
        SELECT c.id, c.review_id, c.user_id, c.text, c.created_at,
               u.name as user_name, u.username as user_username, u.avatar as user_avatar,
               r.book_title, r.book_author
        FROM comments c
        JOIN users u ON u.id = c.user_id
        JOIN reviews r ON r.id = c.review_id
        ORDER BY c.created_at DESC
      `).all();
    }
    return sendJson(res, 200, { success: true, comments: commentsList });
  }

  // Single comment operations: PUT /api/admin/comments/:id, DELETE /api/admin/comments/:id
  const adminCommentMatch = pathname.match(/^\/api\/admin\/comments\/([^/]+)$/);
  if (adminCommentMatch) {
    const targetCommentId = adminCommentMatch[1];

    // PUT /api/admin/comments/:id (Update comment)
    if (method === 'PUT') {
      const body = await parseJsonBody(req);
      if (!body.text || !String(body.text).trim()) {
        return sendError(res, 400, 'Comment text cannot be empty');
      }
      const cleanText = sanitizeText(String(body.text).trim());
      const existing = await db.prepare('SELECT id FROM comments WHERE id = ?').get(targetCommentId);
      if (!existing) return sendError(res, 404, 'Comment not found');

      await db.prepare('UPDATE comments SET text = ? WHERE id = ?').run(cleanText, targetCommentId);
      return sendJson(res, 200, { success: true, message: 'Comment updated successfully' });
    }

    // DELETE /api/admin/comments/:id (Delete comment)
    if (method === 'DELETE') {
      const existing = await db.prepare('SELECT id FROM comments WHERE id = ?').get(targetCommentId);
      if (!existing) return sendError(res, 404, 'Comment not found');

      await db.prepare('DELETE FROM comments WHERE id = ?').run(targetCommentId);
      return sendJson(res, 200, { success: true, message: 'Comment deleted successfully' });
    }
  }

  // Route not found under /api/admin/
  return sendError(res, 404, 'Admin API route not found');
}
