import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { db, initDatabase } from './lib/db.js';
import { hashPassword, verifyPassword, createSession, getSessionUser, revokeSession } from './lib/auth.js';
import { applySecurityHeaders, checkRateLimit, sanitizeText, isSafeUrl, isSafeImageUrl } from './lib/security.js';
import { validateRegister, validateLogin, validateReview, validateComment } from './lib/validator.js';
import { searchBooks } from './lib/bookSearch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// Initialize database
initDatabase();

// MIME Types map
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Request Helper: Parse JSON Body
function parseJsonBody(req, maxSize = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON format'));
      }
    });
    req.on('error', reject);
  });
}

// Request Helper: Get Auth User
function authenticateRequest(req) {
  // Check Authorization header first
  const authHeader = req.headers['authorization'];
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers['cookie']) {
    // Check cookie
    const cookies = req.headers['cookie'].split(';');
    for (const c of cookies) {
      const [k, v] = c.trim().split('=');
      if (k === 'bookgram_session') {
        token = decodeURIComponent(v);
        break;
      }
    }
  }

  if (!token) return null;
  return getSessionUser(token);
}

// Response Helpers
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message, errors = []) {
  sendJson(res, statusCode, {
    success: false,
    message,
    errors
  });
}

// Main HTTP Server
const server = http.createServer(async (req, res) => {
  // Apply Security Headers to every response
  applySecurityHeaders(res);

  const ip = req.socket.remoteAddress || 'unknown';
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Rate Limiting
  const isAuthRoute = pathname.startsWith('/api/auth/login') || pathname.startsWith('/api/auth/register');
  const rateLimitCheck = checkRateLimit(ip, isAuthRoute ? 'auth' : 'general');
  if (!rateLimitCheck.allowed) {
    res.setHeader('Retry-After', rateLimitCheck.retryAfter);
    return sendError(res, 429, `Too many requests. Please try again in ${rateLimitCheck.retryAfter} seconds.`);
  }

  try {
    // ==========================================
    // API ROUTES
    // ==========================================
    if (pathname.startsWith('/api/')) {
      const user = authenticateRequest(req);

      // --- Health Check ---
      if (pathname === '/api/health' && method === 'GET') {
        return sendJson(res, 200, {
          status: 'healthy',
          app: 'BookGram',
          version: '1.0.0',
          timestamp: new Date().toISOString()
        });
      }

      // --- AUTH: Register ---
      if (pathname === '/api/auth/register' && method === 'POST') {
        const body = await parseJsonBody(req);
        const { isValid, errors } = validateRegister(body);
        if (!isValid) return sendError(res, 400, 'Validation failed', errors);

        const username = body.username.trim().toLowerCase();
        const email = body.email.trim().toLowerCase();
        const name = sanitizeText(body.name.trim());
        const handle = `@${username}`;

        // Check uniqueness
        const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
        if (existing) {
          return sendError(res, 409, 'Username or email already in use');
        }

        const userId = 'user_' + randomBytes(8).toString('hex');
        const salt = randomBytes(16).toString('hex');
        const pwdHash = hashPassword(body.password, salt);
        const avatar = `https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&auto=format&fit=crop&q=80`;

        db.prepare(`
          INSERT INTO users (id, username, email, password_hash, salt, name, handle, bio, avatar)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userId, username, email, pwdHash, salt, name, handle, 'Avid reader and reviewer.', avatar);

        const session = createSession(userId);

        res.setHeader('Set-Cookie', `bookgram_session=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
        return sendJson(res, 201, {
          success: true,
          token: session.token,
          user: { id: userId, username, email, name, handle, bio: 'Avid reader and reviewer.', avatar }
        });
      }

      // --- AUTH: Login ---
      if (pathname === '/api/auth/login' && method === 'POST') {
        const body = await parseJsonBody(req);
        const { isValid, errors } = validateLogin(body);
        if (!isValid) return sendError(res, 400, 'Validation failed', errors);

        const identifier = body.username.trim().toLowerCase();
        const row = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(identifier, identifier);

        if (!row || !verifyPassword(body.password, row.password_hash, row.salt)) {
          return sendError(res, 401, 'Invalid username or password');
        }

        const session = createSession(row.id);
        res.setHeader('Set-Cookie', `bookgram_session=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);

        return sendJson(res, 200, {
          success: true,
          token: session.token,
          user: {
            id: row.id,
            username: row.username,
            email: row.email,
            name: row.name,
            handle: row.handle,
            bio: row.bio,
            avatar: row.avatar
          }
        });
      }

      // --- AUTH: Quick Switch Demo Account ---
      if (pathname === '/api/auth/switch-demo' && method === 'POST') {
        const body = await parseJsonBody(req);
        const targetUserId = body.userId;
        const targetUser = db.prepare('SELECT id, username, email, name, handle, bio, avatar FROM users WHERE id = ?').get(targetUserId);

        if (!targetUser) return sendError(res, 404, 'Demo user not found');

        const session = createSession(targetUser.id);
        res.setHeader('Set-Cookie', `bookgram_session=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);

        return sendJson(res, 200, {
          success: true,
          token: session.token,
          user: targetUser
        });
      }

      // --- AUTH: Current User Details ---
      if (pathname === '/api/auth/me' && method === 'GET') {
        if (!user) return sendError(res, 401, 'Not authenticated');

        const followersCount = db.prepare('SELECT COUNT(*) as count FROM follows WHERE following_id = ?').get(user.id).count;
        const followingCount = db.prepare('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?').get(user.id).count;
        const reviewsCount = db.prepare('SELECT COUNT(*) as count FROM reviews WHERE user_id = ?').get(user.id).count;
        const followingRows = db.prepare('SELECT following_id FROM follows WHERE follower_id = ?').all(user.id);
        const savedRows = db.prepare('SELECT review_id FROM saves WHERE user_id = ?').all(user.id);

        return sendJson(res, 200, {
          success: true,
          user: {
            ...user,
            stats: { reviewsCount, followersCount, followingCount },
            followingIds: followingRows.map(r => r.following_id),
            savedReviewIds: savedRows.map(r => r.review_id)
          }
        });
      }

      // --- AUTH: Update Profile ---
      if (pathname === '/api/auth/profile' && method === 'PUT') {
        if (!user) return sendError(res, 401, 'Not authenticated');
        const body = await parseJsonBody(req);
        const name = body.name ? sanitizeText(body.name.trim().slice(0, 60)) : user.name;
        const bio = body.bio !== undefined ? sanitizeText(body.bio.trim().slice(0, 500)) : user.bio;
        let avatar = user.avatar;
        if (body.avatar && typeof body.avatar === 'string' && isSafeImageUrl(body.avatar.trim())) {
          avatar = body.avatar.trim();
        }

        db.prepare('UPDATE users SET name = ?, bio = ?, avatar = ? WHERE id = ?').run(name, bio, avatar, user.id);

        return sendJson(res, 200, {
          success: true,
          message: 'Profile updated successfully',
          user: { ...user, name, bio, avatar }
        });
      }

      // --- AUTH: Logout ---
      if (pathname === '/api/auth/logout' && method === 'POST') {
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
          revokeSession(authHeader.slice(7).trim());
        }
        res.setHeader('Set-Cookie', 'bookgram_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
        return sendJson(res, 200, { success: true, message: 'Logged out successfully' });
      }

      // --- REVIEWS: List / Feed ---
      if (pathname === '/api/reviews' && method === 'GET') {
        const feed = parsedUrl.searchParams.get('feed') || 'all'; // all, following, saved
        const genre = parsedUrl.searchParams.get('genre') || 'all';
        const search = parsedUrl.searchParams.get('search') || '';
        const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '50', 10), 100);
        const offset = Math.max(parseInt(parsedUrl.searchParams.get('offset') || '0', 10), 0);

        let query = `
          SELECT 
            r.id, r.user_id, r.book_title, r.book_author, r.cover_url, r.genre, 
            r.rating, r.review_text, r.quote, r.book_link, r.created_at,
            u.name as author_name, u.handle as author_handle, u.avatar as author_avatar
          FROM reviews r
          JOIN users u ON u.id = r.user_id
        `;
        const conditions = [];
        const params = [];

        // Feed Filter
        if (feed === 'following') {
          if (!user) {
            conditions.push('1 = 0'); // Empty if guest
          } else {
            conditions.push('(r.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR r.user_id = ?)');
            params.push(user.id, user.id);
          }
        } else if (feed === 'saved') {
          if (!user) {
            conditions.push('1 = 0');
          } else {
            conditions.push('r.id IN (SELECT review_id FROM saves WHERE user_id = ?)');
            params.push(user.id);
          }
        }

        // Genre Filter
        if (genre !== 'all') {
          conditions.push('r.genre = ?');
          params.push(genre);
        }

        // Search Filter
        if (search.trim()) {
          const s = `%${search.trim().toLowerCase()}%`;
          conditions.push(`(
            LOWER(r.book_title) LIKE ? OR 
            LOWER(r.book_author) LIKE ? OR 
            LOWER(r.review_text) LIKE ? OR 
            LOWER(r.genre) LIKE ? OR
            LOWER(u.name) LIKE ? OR
            LOWER(u.handle) LIKE ?
          )`);
          params.push(s, s, s, s, s, s);
        }

        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const rows = db.prepare(query).all(...params);

        // Fetch likes, saves and comments for these reviews
        const reviewsWithDetails = rows.map(r => {
          const likes = db.prepare('SELECT user_id FROM likes WHERE review_id = ?').all(r.id).map(l => l.user_id);
          const comments = db.prepare(`
            SELECT c.id, c.user_id, c.text, c.created_at, u.name, u.handle, u.avatar
            FROM comments c
            JOIN users u ON u.id = c.user_id
            WHERE c.review_id = ?
            ORDER BY c.created_at ASC
          `).all(r.id);

          return {
            id: r.id,
            userId: r.user_id,
            author: {
              id: r.user_id,
              name: r.author_name,
              handle: r.author_handle,
              avatar: r.author_avatar
            },
            bookTitle: r.book_title,
            bookAuthor: r.book_author,
            coverUrl: r.cover_url,
            genre: r.genre,
            rating: r.rating,
            reviewText: r.review_text,
            quote: r.quote,
            bookLink: r.book_link,
            createdAt: r.created_at,
            likes,
            comments
          };
        });

        return sendJson(res, 200, { success: true, count: reviewsWithDetails.length, reviews: reviewsWithDetails });
      }

      // --- REVIEWS: Create Review ---
      if (pathname === '/api/reviews' && method === 'POST') {
        if (!user) return sendError(res, 401, 'Please log in to post a review');

        const body = await parseJsonBody(req);
        const { isValid, errors } = validateReview(body);
        if (!isValid) return sendError(res, 400, 'Invalid review input', errors);

        const reviewId = 'rev_' + Date.now() + '_' + randomBytes(4).toString('hex');
        const quoteFormatted = body.quote ? `“${sanitizeText(body.quote.replace(/["“”]/g, '').trim())}”` : null;

        db.prepare(`
          INSERT INTO reviews (id, user_id, book_title, book_author, cover_url, genre, rating, review_text, quote, book_link)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          reviewId,
          user.id,
          sanitizeText(body.bookTitle.trim()),
          sanitizeText(body.bookAuthor.trim()),
          body.coverUrl.trim(),
          body.genre,
          parseFloat(body.rating),
          sanitizeText(body.reviewText.trim()),
          quoteFormatted,
          body.bookLink ? body.bookLink.trim() : null
        );

        return sendJson(res, 201, {
          success: true,
          message: 'Review published successfully',
          reviewId
        });
      }

      // --- REVIEWS: Delete Review ---
      const deleteReviewMatch = pathname.match(/^\/api\/reviews\/([^/]+)$/);
      if (deleteReviewMatch && method === 'DELETE') {
        if (!user) return sendError(res, 401, 'Not authenticated');
        const reviewId = deleteReviewMatch[1];

        const existing = db.prepare('SELECT user_id FROM reviews WHERE id = ?').get(reviewId);
        if (!existing) return sendError(res, 404, 'Review not found');

        // Authorization check: Only author can delete review
        if (existing.user_id !== user.id) {
          return sendError(res, 403, 'You are not authorized to delete this review');
        }

        db.prepare('DELETE FROM reviews WHERE id = ?').run(reviewId);
        return sendJson(res, 200, { success: true, message: 'Review deleted' });
      }

      // --- REVIEWS: Like / Unlike Toggle ---
      const likeMatch = pathname.match(/^\/api\/reviews\/([^/]+)\/like$/);
      if (likeMatch && method === 'POST') {
        if (!user) return sendError(res, 401, 'Please log in to like reviews');
        const reviewId = likeMatch[1];

        const exists = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND review_id = ?').get(user.id, reviewId);
        let isLiked = false;

        if (exists) {
          db.prepare('DELETE FROM likes WHERE user_id = ? AND review_id = ?').run(user.id, reviewId);
          isLiked = false;
        } else {
          db.prepare('INSERT INTO likes (user_id, review_id) VALUES (?, ?)').run(user.id, reviewId);
          isLiked = true;
        }

        const totalLikes = db.prepare('SELECT COUNT(*) as count FROM likes WHERE review_id = ?').get(reviewId).count;
        return sendJson(res, 200, { success: true, isLiked, totalLikes });
      }

      // --- REVIEWS: Save / Bookmark Toggle ---
      const saveMatch = pathname.match(/^\/api\/reviews\/([^/]+)\/save$/);
      if (saveMatch && method === 'POST') {
        if (!user) return sendError(res, 401, 'Please log in to save books');
        const reviewId = saveMatch[1];

        const exists = db.prepare('SELECT 1 FROM saves WHERE user_id = ? AND review_id = ?').get(user.id, reviewId);
        let isSaved = false;

        if (exists) {
          db.prepare('DELETE FROM saves WHERE user_id = ? AND review_id = ?').run(user.id, reviewId);
          isSaved = false;
        } else {
          db.prepare('INSERT INTO saves (user_id, review_id) VALUES (?, ?)').run(user.id, reviewId);
          isSaved = true;
        }

        return sendJson(res, 200, { success: true, isSaved });
      }

      // --- REVIEWS: Add Comment ---
      const commentMatch = pathname.match(/^\/api\/reviews\/([^/]+)\/comments$/);
      if (commentMatch && method === 'POST') {
        if (!user) return sendError(res, 401, 'Please log in to leave a comment');
        const reviewId = commentMatch[1];

        const reviewExists = db.prepare('SELECT id FROM reviews WHERE id = ?').get(reviewId);
        if (!reviewExists) return sendError(res, 404, 'Review not found');

        const body = await parseJsonBody(req);
        const { isValid, errors } = validateComment(body);
        if (!isValid) return sendError(res, 400, 'Invalid comment', errors);

        const commentId = 'c_' + Date.now() + '_' + randomBytes(3).toString('hex');
        const cleanText = sanitizeText(body.text.trim());

        db.prepare('INSERT INTO comments (id, review_id, user_id, text) VALUES (?, ?, ?, ?)').run(
          commentId,
          reviewId,
          user.id,
          cleanText
        );

        return sendJson(res, 201, {
          success: true,
          comment: {
            id: commentId,
            userId: user.id,
            name: user.name,
            handle: user.handle,
            avatar: user.avatar,
            text: cleanText,
            created_at: new Date().toISOString()
          }
        });
      }

      // --- REVIEWS: Delete Comment ---
      const delCommentMatch = pathname.match(/^\/api\/reviews\/([^/]+)\/comments\/([^/]+)$/);
      if (delCommentMatch && method === 'DELETE') {
        if (!user) return sendError(res, 401, 'Not authenticated');
        const [, reviewId, commentId] = delCommentMatch;

        const comment = db.prepare('SELECT c.user_id as comment_user_id, r.user_id as review_user_id FROM comments c JOIN reviews r ON r.id = c.review_id WHERE c.id = ?').get(commentId);
        if (!comment) return sendError(res, 404, 'Comment not found');

        // Only comment author OR review owner can delete
        if (comment.comment_user_id !== user.id && comment.review_user_id !== user.id) {
          return sendError(res, 403, 'Not authorized to delete this comment');
        }

        db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
        return sendJson(res, 200, { success: true, message: 'Comment deleted' });
      }

      // --- USERS: Suggested Readers ---
      if (pathname === '/api/users/suggested' && method === 'GET') {
        const currentUserId = user ? user.id : '';
        const suggested = db.prepare(`
          SELECT id, name, handle, bio, avatar,
            (SELECT COUNT(*) FROM follows WHERE following_id = users.id) as followers_count
          FROM users
          WHERE id != ?
          ORDER BY followers_count DESC
          LIMIT 8
        `).all(currentUserId);

        return sendJson(res, 200, { success: true, users: suggested });
      }

      // --- USERS: Profile Details & Reviews ---
      const userProfileMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
      if (userProfileMatch && method === 'GET') {
        const targetId = userProfileMatch[1];
        const profileUser = db.prepare('SELECT id, name, handle, bio, avatar, created_at FROM users WHERE id = ?').get(targetId);
        if (!profileUser) return sendError(res, 404, 'User not found');

        const reviewsCount = db.prepare('SELECT COUNT(*) as count FROM reviews WHERE user_id = ?').get(targetId).count;
        const followersCount = db.prepare('SELECT COUNT(*) as count FROM follows WHERE following_id = ?').get(targetId).count;
        const followingCount = db.prepare('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?').get(targetId).count;

        const isFollowing = user ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(user.id, targetId) : false;

        const userReviews = db.prepare(`
          SELECT id, book_title, book_author, cover_url, genre, rating, book_link, created_at,
            (SELECT COUNT(*) FROM likes WHERE review_id = reviews.id) as likes_count,
            (SELECT COUNT(*) FROM comments WHERE review_id = reviews.id) as comments_count
          FROM reviews
          WHERE user_id = ?
          ORDER BY created_at DESC
        `).all(targetId);

        const likedReviews = db.prepare(`
          SELECT r.id, r.book_title, r.book_author, r.cover_url, r.genre, r.rating, r.book_link, r.created_at,
            (SELECT COUNT(*) FROM likes WHERE review_id = r.id) as likes_count,
            (SELECT COUNT(*) FROM comments WHERE review_id = r.id) as comments_count
          FROM reviews r
          JOIN likes l ON l.review_id = r.id
          WHERE l.user_id = ?
          ORDER BY l.created_at DESC
        `).all(targetId);

        return sendJson(res, 200, {
          success: true,
          user: {
            ...profileUser,
            stats: { reviewsCount, followersCount, followingCount },
            isFollowing,
            reviews: userReviews,
            likedReviews
          }
        });
      }

      // --- USERS: Follow / Unfollow Toggle ---
      const followMatch = pathname.match(/^\/api\/users\/([^/]+)\/follow$/);
      if (followMatch && method === 'POST') {
        if (!user) return sendError(res, 401, 'Please log in to follow readers');
        const targetId = followMatch[1];

        if (targetId === user.id) {
          return sendError(res, 400, 'Cannot follow yourself');
        }

        const targetExists = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
        if (!targetExists) return sendError(res, 404, 'User not found');

        const existingFollow = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(user.id, targetId);
        let isFollowing = false;

        if (existingFollow) {
          db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(user.id, targetId);
          isFollowing = false;
        } else {
          db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(user.id, targetId);
          isFollowing = true;
        }

        const followersCount = db.prepare('SELECT COUNT(*) as count FROM follows WHERE following_id = ?').get(targetId).count;
        return sendJson(res, 200, { success: true, isFollowing, followersCount });
      }

      // --- BOOKS: Featured / Book of the Week ---
      if (pathname === '/api/books/featured' && method === 'GET') {
        const row = db.prepare(`
          SELECT 
            r.book_title,
            r.book_author,
            r.cover_url,
            r.genre,
            r.book_link,
            ROUND(AVG(r.rating), 1) as rating,
            COUNT(DISTINCT r.id) as review_count,
            COUNT(DISTINCT l.user_id) as total_likes,
            COUNT(DISTINCT c.id) as total_comments,
            (
              (COUNT(DISTINCT l.user_id) * 2) + 
              (COUNT(DISTINCT c.id) * 3) + 
              (AVG(r.rating) * 5) +
              COUNT(DISTINCT r.id)
            ) as engagement_score
          FROM reviews r
          LEFT JOIN likes l ON l.review_id = r.id
          LEFT JOIN comments c ON c.review_id = r.id
          GROUP BY LOWER(TRIM(r.book_title)), LOWER(TRIM(r.book_author))
          ORDER BY total_likes DESC, total_comments DESC, rating DESC
          LIMIT 1
        `).get();

        if (row) {
          return sendJson(res, 200, {
            success: true,
            featuredBook: {
              title: row.book_title,
              author: row.book_author,
              coverUrl: row.cover_url,
              genre: row.genre,
              rating: row.rating,
              reviewCount: row.review_count,
              likesCount: row.total_likes,
              commentsCount: row.total_comments,
              engagementScore: Math.round(row.engagement_score),
              bookLink: row.book_link || `https://openlibrary.org/search?q=${encodeURIComponent(row.book_title)}`
            }
          });
        } else {
          return sendJson(res, 200, {
            success: true,
            featuredBook: null
          });
        }
      }

      // --- BOOKS: Search Proxy ---
      if (pathname === '/api/books/search' && method === 'GET') {
        const query = parsedUrl.searchParams.get('q') || '';
        const results = await searchBooks(query);
        return sendJson(res, 200, { success: true, results });
      }

      // Unmatched API endpoint
      return sendError(res, 404, 'API endpoint not found');
    }

    // ==========================================
    // STATIC ASSETS & PWA FILES
    // ==========================================
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

    // Prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Access Forbidden');
    }

    // Check if file exists
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        // If requesting an unknown path, return index.html for SPA/PWA routing
        if (pathname.indexOf('.') === -1) {
          filePath = path.join(PUBLIC_DIR, 'index.html');
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('404 Not Found');
        }
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      // Cache policies: Service worker and manifest should not be heavily cached
      let cacheControl = 'public, max-age=86400'; // 1 day
      if (ext === '.webmanifest' || filePath.endsWith('sw.js')) {
        cacheControl = 'no-cache, no-store, must-revalidate';
      } else if (ext === '.html') {
        cacheControl = 'no-cache, must-revalidate';
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': cacheControl
      });

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Server error reading asset');
        }
      });
    });

  } catch (error) {
    console.error('Unhandled Server Error:', error);
    sendError(res, 500, 'Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`   BookGram PWA — Real-World Social Review Network`);
  console.log(`   Server listening securely at http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});

// Graceful termination
process.on('SIGINT', () => {
  console.log('\nShutting down BookGram server gracefully...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
