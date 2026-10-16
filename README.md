# BookWorm — Secure, Production-Grade Social Book Review Network & PWA

**BookWorm** is an advanced, production-grade Progressive Web App (PWA) and social platform for readers and literary critics. It combines an editorial aesthetic with rigorous security hardening, offline-first resilience, and real-time social networking.

---

## 🌟 Key Features

### 📱 Progressive Web App (PWA)
- **Standalone Experience:** Behaves like a native desktop/mobile app (`display: "standalone"`, system status bar tinting).
- **Service Worker (`sw.js`):**
  - **App Shell Pre-caching:** Instant load times using cached HTML, CSS, JavaScript, icons, and fonts.
  - **Stale-While-Revalidate:** Serves static resources immediately while silently updating in the background.
  - **Network-First API Caching:** Caches the review feed for offline reading.
  - **Dedicated Offline Page:** Graceful fallback screen when completely disconnected.
  - **Offline Draft Queue & Auto-Sync:** Write reviews offline; they are queued locally and automatically published once your connection is restored.
- **In-App Install Prompts:** Desktop header button and customized mobile banner listening to `beforeinstallprompt`.
- **Adaptive Launcher Icons:** Standard 192x192, 512x512, and Android adaptive maskable icons.

### 🛡️ Security Hardening (OWASP Compliant)
- **Zero Supply-Chain Vulnerabilities:** Runs on Node.js built-ins (`node:sqlite`, `node:crypto`, `node:http`) with 0 external npm dependencies.
- **Cryptographic Password Hashing:** Uses `scrypt` (`crypto.scryptSync`) with unique 16-byte random salts per user and timing-safe comparison (`crypto.timingSafeEqual`) to prevent side-channel timing attacks.
- **Hashed Session Tokens:** Session tokens are 256-bit cryptographically secure strings (`crypto.randomBytes(32)`). Only their **SHA-256 hashes** are stored in the database.
- **SQL Injection Prevention:** 100% prepared statements with parameterized queries.
- **Strict Content Security Policy (CSP):** Restricts script, style, font, image, and network endpoints to trusted origins.
- **SSRF (Server-Side Request Forgery) Defense:** URL inputs for book covers and store links strictly block loopback (`127.0.0.1`), link-local metadata endpoints (`169.254.169.254`), and RFC 1918 private subnets.
- **Rate Limiting:** Sliding-window rate limiters prevent brute-force credential stuffing and spam attacks.
- **Broken Access Control (BAC) Prevention:** Strict server-side ownership checks ensure users can only delete their own reviews and comments.
- **Anti-XSS Sanitization:** Comprehensive character escaping across review text, author bios, quotes, and comments.

### 📚 Literary Experience & Social Features
- **Live Book Autocomplete:** Real-time search powered by Open Library API. As you type a book title, suggestions with cover thumbnails, authors, and publication years appear to auto-populate the review form.
- **Multiple Feed Perspectives:**
  - **Explore All:** Browse latest community critiques.
  - **Following Feed:** See only updates from reviewers you follow.
  - **Saved Bookshelf:** Personal reading and wishlist queue.
- **Genre Filtering:** Fiction, Sci-Fi & Fantasy, Mystery & Thriller, Non-Fiction, Classics, Philosophy, Romance, Biography, History, and Self-Help.
- **Interactive Ratings & Quotes:** Star rating picker (0.5 to 5.0) and pull-quote styling.
- **Reader Profiles:** Written reviews, liked books, follower/following counts, and follow/unfollow toggle.
- **Quick Demo Switcher:** 1-click switcher between demo personas (*Elena Vance*, *Marcus Chen*, *Clara Oswald*, *Arthur Pendelton*) to test multi-user social interactions with zero friction.

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 20.0.0

### Run the App
```bash
# Start server
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### Run Verification Test Suite
```bash
# Execute 19 integration & security tests
npm test
```

---

## 👥 Demo Accounts

All pre-seeded demo accounts share the password: `Password123!`

| Username | Name | Handle | Focus |
|---|---|---|---|
| `elena` | Elena Vance | `@elena_reads` | Literary & Speculative Fiction |
| `marcus` | Marcus Chen | `@chen_books` | Sci-Fi & World Building |
| `clara` | Clara Oswald | `@impossible_reader` | Historical Fiction & Mysteries |
| `arthur` | Arthur Pendelton | `@arthur_classics` | Philosophy & 19th-Century Classics |

---

## 📡 REST API Reference

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/health` | Service health status & metadata | No |
| `POST` | `/api/auth/register` | Register new user account | No |
| `POST` | `/api/auth/login` | Login with username/email & password | No |
| `GET` | `/api/auth/me` | Fetch active user session & stats | Yes |
| `POST` | `/api/auth/logout` | Revoke session | Yes |
| `PUT` | `/api/auth/profile` | Update user name, bio, or avatar | Yes |
| `GET` | `/api/reviews` | List reviews with `feed`, `genre`, `search` | Optional |
| `POST` | `/api/reviews` | Publish new review | Yes |
| `DELETE` | `/api/reviews/:id` | Delete review (author only) | Yes |
| `POST` | `/api/reviews/:id/like` | Toggle like on a review | Yes |
| `POST` | `/api/reviews/:id/save` | Toggle save/bookmark | Yes |
| `POST` | `/api/reviews/:id/comments` | Add comment to review | Yes |
| `DELETE` | `/api/reviews/:id/comments/:id`| Delete comment (author or post owner) | Yes |
| `GET` | `/api/users/:id` | Get user profile & reviews | Optional |
| `POST` | `/api/users/:id/follow` | Follow / Unfollow user | Yes |
| `GET` | `/api/users/suggested` | List suggested readers to follow | Optional |
| `GET` | `/api/books/search?q=:query` | Live Open Library book autocomplete | No |

---

## 📂 Project Architecture

```
f:\bookworm\
├── server.js               # Node.js HTTP & REST API server
├── package.json            # Scripts and metadata
├── test_suite.js           # Automated integration & security test suite
├── lib/
│   ├── db.js               # SQLite setup, schema migrations, and seed data
│   ├── auth.js             # scrypt hashing, timing-safe checks, token hashing
│   ├── security.js         # Security headers (CSP, X-Frame-Options), SSRF & rate limiters
│   ├── validator.js        # Strict input validation schemas
│   └── bookSearch.js       # Open Library book lookup proxy with in-memory caching
├── public/
│   ├── index.html          # Main responsive BookWorm application
│   ├── offline.html        # Graceful offline fallback page
│   ├── sw.js               # PWA Service Worker (App shell, Stale-While-Revalidate)
│   ├── manifest.webmanifest# PWA Web App Manifest
│   ├── favicon.svg         # SVG Favicon & branding
│   ├── css/
│   │   └── app.css         # Styling, animations, 3D book shadow, dark theme
│   ├── js/
│   │   ├── app.js          # Core app controller, optimistic updates, offline draft queue
│   │   └── pwa.js          # PWA registration, beforeinstallprompt, online/offline monitor
│   └── icons/
│       ├── icon-192.png    # 192x192 PWA icon
│       ├── icon-512.png    # 512x512 PWA icon
│       └── icon-maskable.png # Adaptive maskable icon for Android
└── README.md
```
