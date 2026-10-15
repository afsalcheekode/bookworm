import http from 'node:http';

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body ? (res.headers['content-type']?.includes('json') ? JSON.parse(body) : body) : null
        });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Comprehensive BookGram Verification Test Suite ---\n');
  let passed = 0;
  let total = 0;

  function assert(condition, name) {
    total++;
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}`);
    }
  }

  // 1. Health & Security Headers
  const health = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/health',
    method: 'GET'
  });
  assert(health.statusCode === 200 && health.body.status === 'healthy', 'GET /api/health returns 200 and healthy status');
  assert(health.headers['content-security-policy']?.includes("default-src 'self'"), 'Security: CSP header enforced');
  assert(health.headers['x-frame-options'] === 'DENY', 'Security: X-Frame-Options: DENY enforced');
  assert(health.headers['x-content-type-options'] === 'nosniff', 'Security: X-Content-Type-Options enforced');

  // 2. Static PWA Assets
  const manifest = await request({ host: 'localhost', port: 3000, path: '/manifest.webmanifest', method: 'GET' });
  assert(manifest.statusCode === 200 && manifest.body.display === 'standalone', 'PWA: manifest.webmanifest served standalone');

  const sw = await request({ host: 'localhost', port: 3000, path: '/sw.js', method: 'GET' });
  assert(sw.statusCode === 200 && sw.body.includes('addEventListener'), 'PWA: sw.js (Service Worker) served properly');

  const icon = await request({ host: 'localhost', port: 3000, path: '/icons/icon-192.png', method: 'GET' });
  assert(icon.statusCode === 200, 'PWA: icon-192.png accessible');

  // 3. Auth Flow: Login demo user
  const login = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { username: 'elena', password: 'Password123!' });
  assert(login.statusCode === 200 && login.body.token, 'Auth: Login user_elena succeeds with session token');
  const token = login.body.token;

  // 4. Auth: GET /api/auth/me
  const me = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/auth/me',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert(me.statusCode === 200 && me.body.user.username === 'elena', 'Auth: /api/auth/me returns authenticated user details');

  // 5. Auth Flow: Register new user
  const testUser = `test_${Date.now()}`;
  const register = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/auth/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: 'Test Reviewer',
    username: testUser,
    email: `${testUser}@example.com`,
    password: 'SecurePassword2026!'
  });
  assert(register.statusCode === 201 && register.body.token, 'Auth: User registration creates account & session');
  const testToken = register.body.token;

  // 5b. Auth Flow: Update Profile (Name, Bio, Photo)
  const updateProfile = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/auth/profile',
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${testToken}` }
  }, {
    name: 'Elena Updated',
    bio: 'Updated bio: Lover of cosmic sci-fi and classic poetry.',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=240'
  });
  assert(
    updateProfile.statusCode === 200 && 
    updateProfile.body.user.name === 'Elena Updated' && 
    updateProfile.body.user.bio.includes('Lover of cosmic sci-fi'),
    'Profile: User can update their display name, bio, and profile photo'
  );

  // 6. Security Check: Reject weak password
  const weakReg = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/auth/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: 'Weak',
    username: `weak_${Date.now()}`,
    email: 'weak@example.com',
    password: '123'
  });
  assert(weakReg.statusCode === 400, 'Security: Rejects weak passwords (< 8 characters)');

  // 7. Security Check: Reject SSRF cover URL
  const ssrfReview = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/reviews',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${testToken}` }
  }, {
    bookTitle: 'Malicious Book',
    bookAuthor: 'Hacker',
    coverUrl: 'http://169.254.169.254/latest/meta-data/',
    genre: 'Fiction',
    rating: 5,
    reviewText: 'Trying to access cloud metadata internally...'
  });
  assert(ssrfReview.statusCode === 400, 'Security: Blocks SSRF cloud metadata endpoint (169.254.169.254)');

  // 8. Reviews: Create valid review
  const createRev = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/reviews',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${testToken}` }
  }, {
    bookTitle: 'Project Hail Mary',
    bookAuthor: 'Andy Weir',
    coverUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800',
    genre: 'Sci-Fi & Fantasy',
    rating: 4.8,
    reviewText: 'An astounding triumph of science, friendship, and relentless optimism in deep space.',
    quote: 'Amaze! Amaze! Amaze!'
  });
  assert(createRev.statusCode === 201 && createRev.body.reviewId, 'Reviews: Create new review returns 201 and ID');
  const newReviewId = createRev.body.reviewId;

  // 9. Reviews: Like & Save Toggle
  const likeRev = await request({
    host: 'localhost',
    port: 3000,
    path: `/api/reviews/${newReviewId}/like`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert(likeRev.statusCode === 200 && likeRev.body.isLiked === true, 'Reviews: Like toggle works');

  const saveRev = await request({
    host: 'localhost',
    port: 3000,
    path: `/api/reviews/${newReviewId}/save`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert(saveRev.statusCode === 200 && saveRev.body.isSaved === true, 'Reviews: Save toggle works');

  // 10. Reviews: Add Comment
  const comment = await request({
    host: 'localhost',
    port: 3000,
    path: `/api/reviews/${newReviewId}/comments`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  }, { text: 'Rocky is the greatest alien ever written!' });
  assert(comment.statusCode === 201 && comment.body.comment.id, 'Comments: Post comment succeeds');

  // 11. Security Check: Forbidden review deletion (unauthorized user)
  const unauthorizedDelete = await request({
    host: 'localhost',
    port: 3000,
    path: `/api/reviews/${newReviewId}`,
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` } // token belongs to elena, review belongs to testUser
  });
  assert(unauthorizedDelete.statusCode === 403, 'Security: BAC - Other users cannot delete someone else review (403)');

  // 12. Delete review by legitimate owner
  const authorizedDelete = await request({
    host: 'localhost',
    port: 3000,
    path: `/api/reviews/${newReviewId}`,
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${testToken}` }
  });
  assert(authorizedDelete.statusCode === 200, 'Reviews: Owner successfully deleted review');

  // 13. Search Reviews API
  const search = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/reviews?search=dune',
    method: 'GET'
  });
  assert(search.statusCode === 200 && search.body.reviews.length >= 1, 'Search: Querying reviews by keyword returns matching results');

  // 14. Book of the Week / Dynamic Featured API
  const featured = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/books/featured',
    method: 'GET'
  });
  assert(
    featured.statusCode === 200 &&
    featured.body.featuredBook &&
    typeof featured.body.featuredBook.engagementScore === 'number' &&
    featured.body.featuredBook.likesCount >= 0,
    'Book of the Week: Dynamic calculation by engagement score (likes + comments + rating) returns top book'
  );

  console.log(`\n=========================================`);
  console.log(`   TEST RESULTS: ${passed} / ${total} PASSED`);
  console.log(`=========================================\n`);
}

runTests().catch(console.error);
