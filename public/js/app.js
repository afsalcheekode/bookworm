/**
 * BookGram Core Application Client
 * Real-world Production PWA Architecture with REST API & Offline Draft Sync
 */

import { PWA } from './pwa.js';

export const app = {
  state: {
    currentUser: null,
    authToken: null,
    reviews: [],
    suggestedUsers: [],
    activeFilter: 'all', // 'all', 'following', 'saved'
    activeGenre: 'all',
    searchQuery: '',
    viewingProfileId: null,
    searchDebounceTimer: null,
    bookLookupDebounceTimer: null,
  },

  async init() {
    // 1. Initialize PWA Service Worker & Install Monitor
    PWA.init();

    // 2. Load theme
    this.initTheme();

    // 3. Load or restore session
    await this.restoreAuthSession();

    // 4. Render shell components
    this.renderGenres();
    
    // 5. Fetch initial data from server
    await Promise.all([
      this.fetchReviews(),
      this.fetchSuggestedUsers()
    ]);

    // 6. Sync any pending offline reviews
    this.syncOfflineQueue();
  },

  // ==========================================
  // THEME MANAGEMENT
  // ==========================================
  initTheme() {
    const savedTheme = localStorage.getItem('bookgram_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = savedTheme ? savedTheme === 'dark' : prefersDark;

    if (shouldBeDark) {
      document.documentElement.classList.add('dark');
      const icon = document.getElementById('themeIcon');
      if (icon) icon.classList.replace('fa-moon', 'fa-sun');
    }
  },

  toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    const icon = document.getElementById('themeIcon');
    if (isDark) {
      if (icon) icon.classList.replace('fa-moon', 'fa-sun');
      localStorage.setItem('bookgram_theme', 'dark');
      this.toast('Dark mode activated', 'info');
    } else {
      if (icon) icon.classList.replace('fa-sun', 'fa-moon');
      localStorage.setItem('bookgram_theme', 'light');
      this.toast('Light mode activated', 'info');
    }
  },

  // ==========================================
  // AUTHENTICATION & DEMO ACCOUNTS
  // ==========================================
  async restoreAuthSession() {
    const token = localStorage.getItem('bookgram_token');
    if (!token) {
      // Default to Elena Vance as the active demo user session for zero-friction exploration
      await this.quickSwitchDemo('user_elena', false);
      return;
    }

    this.state.authToken = token;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.user) {
        this.setCurrentUser(data.user);
      } else {
        await this.quickSwitchDemo('user_elena', false);
      }
    } catch {
      // If offline, use cached user profile from localStorage
      const cached = localStorage.getItem('bookgram_cached_user');
      if (cached) {
        this.setCurrentUser(JSON.parse(cached));
      } else {
        await this.quickSwitchDemo('user_elena', false);
      }
    }
  },

  setCurrentUser(user) {
    this.state.currentUser = user;
    localStorage.setItem('bookgram_cached_user', JSON.stringify(user));
    this.updateUserUI();
  },

  updateUserUI() {
    const u = this.state.currentUser;
    if (!u) return;

    // Desktop header
    const navName = document.getElementById('navUserName');
    const navAvatar = document.getElementById('navUserAvatar');
    if (navName) navName.textContent = u.name;
    if (navAvatar) navAvatar.src = u.avatar;

    // Sidebar
    const sAvatar = document.getElementById('sidebarAvatar');
    const sName = document.getElementById('sidebarName');
    const sHandle = document.getElementById('sidebarHandle');
    if (sAvatar) sAvatar.src = u.avatar;
    if (sName) sName.textContent = u.name;
    if (sHandle) sHandle.textContent = u.handle;

    // Counters
    const revCount = document.getElementById('sidebarReviewCount');
    const followersCount = document.getElementById('sidebarFollowersCount');
    const followingCount = document.getElementById('sidebarFollowingCount');

    if (revCount && u.stats) revCount.textContent = u.stats.reviewsCount || 0;
    if (followersCount && u.stats) followersCount.textContent = u.stats.followersCount || 0;
    if (followingCount && u.stats) followingCount.textContent = u.stats.followingCount || 0;

    const bFollow = document.getElementById('badgeFollowingCount');
    const bSaved = document.getElementById('badgeSavedCount');
    if (bFollow && u.followingIds) bFollow.textContent = u.followingIds.length;
    if (bSaved && u.savedReviewIds) bSaved.textContent = u.savedReviewIds.length;
  },

  async quickSwitchDemo(userId, notify = true) {
    try {
      const res = await fetch('/api/auth/switch-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      if (data.success) {
        this.state.authToken = data.token;
        localStorage.setItem('bookgram_token', data.token);
        this.setCurrentUser(data.user);
        await this.fetchReviews();
        await this.fetchSuggestedUsers();
        if (notify) this.toast(`Switched account to ${data.user.name}`, 'success');
      }
    } catch (err) {
      console.error('Switch demo error:', err);
    }
  },

  openAuthModal(mode = 'login') {
    this.switchAuthTab(mode);
    document.getElementById('authModal').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  },

  closeAuthModal() {
    document.getElementById('authModal').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  },

  switchAuthTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const tabLogin = document.getElementById('tabAuthLogin');
    const tabReg = document.getElementById('tabAuthRegister');

    if (tab === 'login') {
      loginForm.classList.remove('hidden');
      registerForm.classList.add('hidden');
      tabLogin.className = 'pb-2 border-b-2 border-brand-500 text-brand-600 dark:text-brand-400 font-bold';
      tabReg.className = 'pb-2 border-b-2 border-transparent text-stone-600 dark:text-stone-400 font-medium hover:text-stone-900';
    } else {
      loginForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
      tabReg.className = 'pb-2 border-b-2 border-brand-500 text-brand-600 dark:text-brand-400 font-bold';
      tabLogin.className = 'pb-2 border-b-2 border-transparent text-stone-600 dark:text-stone-400 font-medium hover:text-stone-900';
    }
  },

  async handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.success) {
        this.state.authToken = data.token;
        localStorage.setItem('bookgram_token', data.token);
        this.setCurrentUser(data.user);
        this.closeAuthModal();
        await this.fetchReviews();
        this.toast(`Welcome back, ${data.user.name}!`, 'success');
      } else {
        this.toast(data.message || 'Login failed', 'error');
      }
    } catch {
      this.toast('Connection error during login', 'error');
    }
  },

  async handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('regName').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, email, password })
      });
      const data = await res.json();
      if (data.success) {
        this.state.authToken = data.token;
        localStorage.setItem('bookgram_token', data.token);
        this.setCurrentUser(data.user);
        this.closeAuthModal();
        await this.fetchReviews();
        this.toast(`Welcome to BookGram, ${data.user.name}!`, 'success');
      } else {
        const errorMsg = data.errors ? data.errors.join(' ') : data.message;
        this.toast(errorMsg || 'Registration failed', 'error');
      }
    } catch {
      this.toast('Connection error during registration', 'error');
    }
  },

  async handleLogout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.state.authToken}` }
      });
    } catch (e) {
      console.warn(e);
    }
    localStorage.removeItem('bookgram_token');
    localStorage.removeItem('bookgram_cached_user');
    this.toast('Logged out successfully', 'info');
    await this.restoreAuthSession();
  },

  // ==========================================
  // REVIEWS & FEED API
  // ==========================================
  async fetchReviews() {
    const { activeFilter, activeGenre, searchQuery, authToken } = this.state;
    const params = new URLSearchParams();
    if (activeFilter !== 'all') params.set('feed', activeFilter);
    if (activeGenre !== 'all') params.set('genre', activeGenre);
    if (searchQuery.trim()) params.set('search', searchQuery.trim());

    try {
      const headers = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch(`/api/reviews?${params.toString()}`, { headers });
      const data = await res.json();
      if (data.success) {
        this.state.reviews = data.reviews || [];
        this.renderPosts();
        
        const badgeTotal = document.getElementById('badgeTotalReviews');
        if (badgeTotal) badgeTotal.textContent = this.state.reviews.length;
      }
    } catch (err) {
      console.warn('Failed to fetch reviews online:', err);
    }
  },

  async fetchSuggestedUsers() {
    try {
      const headers = {};
      if (this.state.authToken) headers['Authorization'] = `Bearer ${this.state.authToken}`;

      const res = await fetch('/api/users/suggested', { headers });
      const data = await res.json();
      if (data.success) {
        this.state.suggestedUsers = data.users || [];
        this.renderSuggestedUsers();
      }
    } catch (err) {
      console.warn('Suggested users fetch error:', err);
    }
  },

  renderGenres() {
    const genres = [
      'All', 'Fiction', 'Sci-Fi & Fantasy', 'Mystery & Thriller', 
      'Non-Fiction', 'Classics', 'Philosophy', 'Romance', 'Biography', 'History'
    ];
    const container = document.getElementById('genreContainer');
    if (!container) return;

    container.innerHTML = genres.map(g => {
      const val = g === 'All' ? 'all' : g;
      const isActive = this.state.activeGenre === val;
      return `
        <button 
          onclick="app.setGenreFilter('${val}')"
          class="px-3 py-1.5 text-xs rounded-xl font-medium transition ${
            isActive 
              ? 'bg-brand-500 text-white shadow-sm font-semibold' 
              : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
          }"
        >
          ${g}
        </button>
      `;
    }).join('');
  },

  renderSuggestedUsers() {
    const container = document.getElementById('suggestedUsersContainer');
    if (!container) return;

    const currentUserId = this.state.currentUser ? this.state.currentUser.id : '';
    const followingIds = this.state.currentUser && this.state.currentUser.followingIds ? this.state.currentUser.followingIds : [];

    container.innerHTML = this.state.suggestedUsers.map(user => {
      const isFollowing = followingIds.includes(user.id);
      return `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2.5 cursor-pointer min-w-0" onclick="app.openProfile('${user.id}')">
            <img src="${user.avatar}" class="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-stone-200 dark:ring-stone-700" alt="${user.name}">
            <div class="truncate">
              <h4 class="text-xs font-bold text-stone-800 dark:text-stone-200 hover:text-brand-500 truncate">${user.name}</h4>
              <p class="text-[11px] text-stone-600 dark:text-stone-400 truncate">${user.handle}</p>
            </div>
          </div>
          <button 
            onclick="app.toggleFollow('${user.id}')"
            class="ml-2 px-3 py-1 text-xs font-semibold rounded-full transition shrink-0 ${
              isFollowing 
                ? 'border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:border-red-500 hover:text-red-500' 
                : 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 hover:opacity-90'
            }"
          >
            ${isFollowing ? 'Following' : 'Follow'}
          </button>
        </div>
      `;
    }).join('');
  },

  renderPosts() {
    const stream = document.getElementById('postsStream');
    const emptyState = document.getElementById('emptyFeedState');
    const filterBanner = document.getElementById('filterBanner');
    const bannerText = document.getElementById('filterBannerText');
    if (!stream) return;

    const { activeFilter, activeGenre, searchQuery, reviews } = this.state;

    // Filter indicator banner
    if (activeFilter !== 'all' || activeGenre !== 'all' || searchQuery.trim()) {
      filterBanner.classList.remove('hidden');
      filterBanner.classList.add('flex');
      let text = 'Filtering by: ';
      if (activeFilter !== 'all') text += `[Feed: ${activeFilter}] `;
      if (activeGenre !== 'all') text += `[Genre: ${activeGenre}] `;
      if (searchQuery.trim()) text += `[Query: "${searchQuery}"] `;
      bannerText.innerHTML = `<i class="fa-solid fa-filter mr-1.5"></i> ${text}`;
    } else {
      filterBanner.classList.add('hidden');
      filterBanner.classList.remove('flex');
    }

    if (reviews.length === 0) {
      stream.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    stream.innerHTML = reviews.map(post => this.createPostCardHTML(post)).join('');
  },

  createPostCardHTML(post) {
    const currentUserId = this.state.currentUser ? this.state.currentUser.id : '';
    const isLiked = post.likes && post.likes.includes(currentUserId);
    const isSaved = this.state.currentUser && this.state.currentUser.savedReviewIds && this.state.currentUser.savedReviewIds.includes(post.id);
    const isMyPost = post.userId === currentUserId;
    const isFollowingAuthor = this.state.currentUser && this.state.currentUser.followingIds && this.state.currentUser.followingIds.includes(post.userId);

    // Star rating
    const rating = typeof post.rating === 'number' ? post.rating : 5;
    const fullStars = Math.floor(rating);
    const hasHalf = rating % 1 !== 0;
    let starHTML = '';
    for (let i = 1; i <= 5; i++) {
      if (i <= fullStars) {
        starHTML += '<i class="fa-solid fa-star text-amber-400 text-xs"></i>';
      } else if (i === fullStars + 1 && hasHalf) {
        starHTML += '<i class="fa-solid fa-star-half-stroke text-amber-400 text-xs"></i>';
      } else {
        starHTML += '<i class="fa-regular fa-star text-amber-300 dark:text-stone-600 text-xs"></i>';
      }
    }

    const comments = post.comments || [];
    const likesCount = post.likes ? post.likes.length : 0;

    return `
      <article class="bg-white dark:bg-[#161922] border border-stone-200 dark:border-stone-800 rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-shadow" id="review-card-${post.id}">
        
        <!-- Post Header -->
        <div class="p-4 sm:p-5 flex items-center justify-between border-b border-stone-100 dark:border-stone-800/60">
          <div class="flex items-center gap-3">
            <img 
              src="${post.author.avatar}" 
              onclick="app.openProfile('${post.author.id}')"
              class="w-10 h-10 rounded-full object-cover cursor-pointer hover:ring-2 hover:ring-brand-500 transition" 
              alt="${post.author.name}"
            />
            <div>
              <div class="flex items-center gap-2">
                <h3 onclick="app.openProfile('${post.author.id}')" class="font-bold text-sm text-stone-900 dark:text-stone-100 cursor-pointer hover:text-brand-600">
                  ${post.author.name}
                </h3>
                ${!isMyPost ? `
                  <span class="text-stone-300 dark:text-stone-700">•</span>
                  <button 
                    onclick="app.toggleFollow('${post.author.id}')" 
                    class="text-xs font-semibold ${isFollowingAuthor ? 'text-stone-400 hover:text-red-500' : 'text-brand-600 hover:underline'}"
                  >
                    ${isFollowingAuthor ? 'Following' : 'Follow'}
                  </button>
                ` : ''}
              </div>
              <div class="flex items-center gap-1.5 text-[11px] text-stone-600 dark:text-stone-400">
                <span>${post.author.handle}</span>
                <span>•</span>
                <span>${this.formatTime(post.createdAt || post.created_at)}</span>
              </div>
            </div>
          </div>

          <!-- Top right: Genre & Owner Delete -->
          <div class="flex items-center gap-2">
            ${isMyPost ? `
              <button onclick="app.deleteReview('${post.id}')" class="text-stone-400 hover:text-red-500 p-1.5 text-xs transition" title="Delete Review">
                <i class="fa-regular fa-trash-can"></i>
              </button>
            ` : ''}
            <span class="px-2.5 py-1 text-[11px] font-semibold bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 rounded-full">
              ${post.genre}
            </span>
          </div>
        </div>

        <!-- Post Body -->
        <div class="p-4 sm:p-6 space-y-4">
          <div class="flex flex-col sm:flex-row gap-5 items-start">
            
            <!-- Book Cover -->
            <div class="w-full sm:w-44 shrink-0 flex flex-col items-center">
              <div class="relative group w-36 sm:w-full max-w-[180px] aspect-[2/3] rounded-xl overflow-hidden book-shadow border border-stone-200 dark:border-stone-700 bg-stone-200 dark:bg-stone-800">
                <img 
                  src="${post.coverUrl}" 
                  alt="${post.bookTitle} Cover" 
                  class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                  onerror="this.src='https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600'"
                />
                <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2.5">
                  <span class="text-[10px] text-white font-medium">Cover Page</span>
                </div>
              </div>

              <!-- Purchase / Web Link -->
              ${post.bookLink ? `
                <a 
                  href="${post.bookLink}" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  class="mt-3.5 w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 hover:bg-amber-100 transition shadow-sm"
                >
                  <i class="fa-solid fa-cart-shopping text-[11px]"></i>
                  <span>Get / Read Book</span>
                  <i class="fa-solid fa-arrow-up-right-from-square text-[9px] opacity-75"></i>
                </a>
              ` : ''}
            </div>

            <!-- Review Meta & Analysis -->
            <div class="flex-1 space-y-3 min-w-0">
              <div>
                <h2 class="font-serif-title text-xl sm:text-2xl font-bold text-stone-900 dark:text-stone-50 leading-tight">
                  ${post.bookTitle}
                </h2>
                <p class="text-xs sm:text-sm font-medium text-stone-600 dark:text-stone-400 mt-0.5">
                  by <span class="text-stone-800 dark:text-stone-200 font-semibold">${post.bookAuthor}</span>
                </p>
              </div>

              <!-- Star Rating Bar -->
              <div class="flex items-center gap-2">
                <div class="flex items-center gap-0.5">
                  ${starHTML}
                </div>
                <span class="text-xs font-bold text-stone-700 dark:text-stone-300">${rating.toFixed(1)}</span>
                <span class="text-[11px] text-stone-600 dark:text-stone-400">/ 5.0</span>
              </div>

              <!-- Optional Memorable Quote -->
              ${post.quote ? `
                <div class="p-3 rounded-2xl bg-stone-50 dark:bg-stone-900/90 border-l-4 border-brand-500 italic text-xs text-stone-700 dark:text-stone-300 leading-relaxed font-serif">
                  ${post.quote}
                </div>
              ` : ''}

              <!-- Review Text Body -->
              <p class="text-xs sm:text-sm text-stone-700 dark:text-stone-300 leading-relaxed whitespace-pre-line">
                ${post.reviewText}
              </p>
            </div>
          </div>
        </div>

        <!-- Post Action Bar -->
        <div class="px-4 sm:px-6 py-3 bg-stone-50/60 dark:bg-stone-900/40 border-t border-b border-stone-100 dark:border-stone-800 flex items-center justify-between text-xs">
          <div class="flex items-center gap-5">
            <!-- Like Button -->
            <button 
              onclick="app.toggleLike('${post.id}')" 
              class="flex items-center gap-1.5 font-semibold group transition transform active:scale-125"
            >
              <i class="fa-heart text-base ${isLiked ? 'fa-solid text-rose-500 animate-heart' : 'fa-regular text-stone-500 group-hover:text-rose-500'}"></i>
              <span class="${isLiked ? 'text-rose-600 font-bold' : 'text-stone-600 dark:text-stone-400'}">
                ${likesCount}
              </span>
            </button>

            <!-- Comment Button -->
            <button 
              onclick="app.focusCommentInput('${post.id}')" 
              class="flex items-center gap-1.5 font-semibold text-stone-600 dark:text-stone-400 hover:text-brand-500 transition"
            >
              <i class="fa-regular fa-comment text-base"></i>
              <span>${comments.length}</span>
            </button>

            <!-- Share Link Button -->
            <button 
              onclick="app.sharePost('${post.id}')" 
              class="flex items-center gap-1.5 font-semibold text-stone-600 dark:text-stone-400 hover:text-brand-500 transition"
              title="Copy review link"
            >
              <i class="fa-regular fa-paper-plane text-base"></i>
            </button>
          </div>

          <!-- Bookmark / Save Button -->
          <button 
            onclick="app.toggleSavePost('${post.id}')" 
            class="flex items-center gap-1 text-stone-500 hover:text-brand-600 transition"
            title="Save to your bookshelf"
          >
            <i class="fa-bookmark text-base ${isSaved ? 'fa-solid text-brand-600' : 'fa-regular'}"></i>
          </button>
        </div>

        <!-- Comments Section -->
        <div class="p-4 sm:p-6 bg-white dark:bg-[#161922] space-y-3">
          <div class="space-y-2.5 max-h-48 overflow-y-auto pr-1" id="commentList-${post.id}">
            ${comments.length === 0 ? `
              <p class="text-xs text-stone-600 dark:text-stone-400 italic">No thoughts shared yet. Start the literary discussion!</p>
            ` : comments.map(c => {
              const canDeleteComment = (c.user_id === currentUserId) || isMyPost;
              return `
                <div class="flex items-start justify-between gap-2 p-2 rounded-xl bg-stone-50 dark:bg-stone-900/60 group">
                  <div class="flex items-start gap-2.5 min-w-0">
                    <img src="${c.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80'}" class="w-6 h-6 rounded-full object-cover shrink-0 mt-0.5" alt="${c.name}">
                    <div class="text-xs leading-tight">
                      <span class="font-bold text-stone-900 dark:text-stone-100 mr-1.5 cursor-pointer hover:underline" onclick="app.openProfile('${c.user_id}')">
                        ${c.name}
                      </span>
                      <span class="text-stone-700 dark:text-stone-300">${c.text}</span>
                      <span class="text-[10px] text-stone-600 dark:text-stone-400 block mt-1">${this.formatTime(c.created_at)}</span>
                    </div>
                  </div>
                  ${canDeleteComment ? `
                    <button 
                      onclick="app.deleteComment('${post.id}', '${c.id}')" 
                      class="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-red-500 p-1 text-[11px] transition" 
                      title="Delete comment"
                    >
                      <i class="fa-solid fa-trash-can"></i>
                    </button>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>

          <!-- Add Comment Input Form -->
          <form onsubmit="app.handleAddComment(event, '${post.id}')" class="flex gap-2 items-center pt-2">
            <img src="${this.state.currentUser ? this.state.currentUser.avatar : 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80'}" class="w-7 h-7 rounded-full object-cover shrink-0" alt="Me">
            <div class="flex-1 relative">
              <input 
                type="text" 
                id="commentInput-${post.id}" 
                placeholder="Add to discussion or ask reviewer..." 
                class="w-full pl-3 pr-10 py-2 text-xs rounded-full bg-stone-100 dark:bg-stone-900 border border-transparent focus:border-brand-500 focus:outline-none transition"
              />
              <button 
                type="submit" 
                class="absolute right-1.5 top-1 w-7 h-7 rounded-full text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 flex items-center justify-center transition"
              >
                <i class="fa-solid fa-arrow-up text-xs"></i>
              </button>
            </div>
          </form>
        </div>

      </article>
    `;
  },

  // ==========================================
  // INTERACTIONS: LIKES, SAVES, COMMENTS
  // ==========================================
  async toggleLike(reviewId) {
    const post = this.state.reviews.find(r => r.id === reviewId);
    if (!post) return;

    const myId = this.state.currentUser ? this.state.currentUser.id : null;
    if (!myId) {
      this.openAuthModal('login');
      return;
    }

    if (!post.likes) post.likes = [];
    const index = post.likes.indexOf(myId);

    // Optimistic UI update
    if (index > -1) {
      post.likes.splice(index, 1);
    } else {
      post.likes.push(myId);
    }
    this.renderPosts();

    try {
      const res = await fetch(`/api/reviews/${reviewId}/like`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.state.authToken}` }
      });
      const data = await res.json();
      if (!data.success) {
        // Revert on error
        await this.fetchReviews();
      }
    } catch {
      console.warn('Offline like queued');
    }
  },

  async toggleSavePost(reviewId) {
    const u = this.state.currentUser;
    if (!u) {
      this.openAuthModal('login');
      return;
    }

    if (!u.savedReviewIds) u.savedReviewIds = [];
    const idx = u.savedReviewIds.indexOf(reviewId);

    // Optimistic update
    if (idx > -1) {
      u.savedReviewIds.splice(idx, 1);
      this.toast('Removed from saved list', 'info');
    } else {
      u.savedReviewIds.push(reviewId);
      this.toast('Saved to your bookshelf!', 'success');
    }
    this.updateUserUI();
    this.renderPosts();

    try {
      await fetch(`/api/reviews/${reviewId}/save`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.state.authToken}` }
      });
    } catch {
      console.warn('Offline save toggle');
    }
  },

  async handleAddComment(e, reviewId) {
    e.preventDefault();
    const input = document.getElementById(`commentInput-${reviewId}`);
    const text = input ? input.value.trim() : '';
    if (!text) return;

    if (!this.state.currentUser) {
      this.openAuthModal('login');
      return;
    }

    try {
      const res = await fetch(`/api/reviews/${reviewId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.authToken}`
        },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      if (data.success) {
        input.value = '';
        await this.fetchReviews();
        this.toast('Comment posted', 'success');
      } else {
        this.toast(data.message || 'Error posting comment', 'error');
      }
    } catch {
      this.toast('Network error. Unable to post comment.', 'error');
    }
  },

  async deleteComment(reviewId, commentId) {
    try {
      const res = await fetch(`/api/reviews/${reviewId}/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.state.authToken}` }
      });
      const data = await res.json();
      if (data.success) {
        await this.fetchReviews();
        this.toast('Comment deleted', 'info');
      } else {
        this.toast(data.message || 'Cannot delete comment', 'error');
      }
    } catch {
      this.toast('Connection error', 'error');
    }
  },

  async deleteReview(reviewId) {
    if (!confirm('Are you sure you want to permanently delete this book review?')) {
      return;
    }

    try {
      const res = await fetch(`/api/reviews/${reviewId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.state.authToken}` }
      });
      const data = await res.json();
      if (data.success) {
        this.state.reviews = this.state.reviews.filter(r => r.id !== reviewId);
        this.renderPosts();
        if (this.state.currentUser && this.state.currentUser.stats) {
          this.state.currentUser.stats.reviewsCount = Math.max(0, this.state.currentUser.stats.reviewsCount - 1);
          this.updateUserUI();
        }
        this.toast('Review deleted successfully', 'info');
      } else {
        this.toast(data.message || 'Could not delete review', 'error');
      }
    } catch {
      this.toast('Connection error', 'error');
    }
  },

  async toggleFollow(targetUserId) {
    if (!this.state.currentUser) {
      this.openAuthModal('login');
      return;
    }

    try {
      const res = await fetch(`/api/users/${targetUserId}/follow`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.state.authToken}` }
      });
      const data = await res.json();
      if (data.success) {
        const u = this.state.currentUser;
        if (!u.followingIds) u.followingIds = [];
        
        if (data.isFollowing) {
          if (!u.followingIds.includes(targetUserId)) u.followingIds.push(targetUserId);
          this.toast('Followed reader!', 'success');
        } else {
          u.followingIds = u.followingIds.filter(id => id !== targetUserId);
          this.toast('Unfollowed reader', 'info');
        }

        if (u.stats) u.stats.followingCount = u.followingIds.length;
        this.updateUserUI();
        this.renderSuggestedUsers();
        this.renderPosts();

        if (this.state.viewingProfileId === targetUserId) {
          this.renderProfileModal(targetUserId);
        }
      } else {
        this.toast(data.message || 'Could not update follow status', 'error');
      }
    } catch {
      this.toast('Connection error', 'error');
    }
  },

  // ==========================================
  // REVIEW CREATION & LIVE BOOK LOOKUP
  // ==========================================
  openCreateModal() {
    if (!this.state.currentUser) {
      this.openAuthModal('login');
      return;
    }
    document.getElementById('createModal').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  },

  closeCreateModal() {
    document.getElementById('createModal').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    const autoList = document.getElementById('bookAutocompleteList');
    if (autoList) autoList.classList.add('hidden');
  },

  setRating(val) {
    document.getElementById('inputRating').value = val;
    document.getElementById('ratingDisplayNumber').textContent = `${val.toFixed(1)} / 5`;
    const stars = document.getElementById('starPicker').children;
    for (let i = 0; i < stars.length; i++) {
      if (i < val) {
        stars[i].className = 'fa-solid fa-star cursor-pointer transition hover:scale-110 text-amber-400';
      } else {
        stars[i].className = 'fa-regular fa-star cursor-pointer transition hover:scale-110 text-stone-300 dark:text-stone-600';
      }
    }
  },

  // Live Book Autocomplete Search
  handleBookTitleInput(query) {
    clearTimeout(this.state.bookLookupDebounceTimer);
    const list = document.getElementById('bookAutocompleteList');
    if (!list) return;

    if (!query || query.trim().length < 2) {
      list.classList.add('hidden');
      return;
    }

    this.state.bookLookupDebounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/books/search?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        if (data.success && data.results && data.results.length > 0) {
          list.innerHTML = data.results.map(b => `
            <div 
              onclick='app.selectSuggestedBook(${JSON.stringify(b).replace(/'/g, "&#39;")})'
              class="p-2.5 flex items-center gap-3 hover:bg-brand-50 dark:hover:bg-brand-950/40 cursor-pointer border-b border-stone-100 dark:border-stone-800 last:border-none transition"
            >
              <img src="${b.coverUrl}" class="w-8 h-11 object-cover rounded shadow-sm shrink-0" alt="Cover">
              <div class="min-w-0 flex-1">
                <p class="font-bold text-xs text-stone-900 dark:text-stone-100 truncate">${b.title}</p>
                <p class="text-[11px] text-stone-600 dark:text-stone-400 truncate">${b.author} ${b.year ? `(${b.year})` : ''}</p>
              </div>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 shrink-0 font-medium">${b.genre}</span>
            </div>
          `).join('');
          list.classList.remove('hidden');
        } else {
          list.classList.add('hidden');
        }
      } catch {
        list.classList.add('hidden');
      }
    }, 320);
  },

  selectSuggestedBook(book) {
    document.getElementById('inputTitle').value = book.title || '';
    document.getElementById('inputAuthor').value = book.author || '';
    document.getElementById('inputCover').value = book.coverUrl || '';
    if (book.bookLink) document.getElementById('inputBookLink').value = book.bookLink;
    if (book.genre) document.getElementById('inputGenre').value = book.genre;

    const list = document.getElementById('bookAutocompleteList');
    if (list) list.classList.add('hidden');

    this.toast(`Selected "${book.title}"`, 'info');
  },

  insertPresetCover() {
    const sampleCovers = [
      'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=800&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=800&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1532012164546-f432f2e3777f?w=800&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800&auto=format&fit=crop&q=80',
    ];
    const random = sampleCovers[Math.floor(Math.random() * sampleCovers.length)];
    document.getElementById('inputCover').value = random;
    this.toast('Sample cover added', 'info');
  },

  async handleCreateReview(e) {
    e.preventDefault();
    const title = document.getElementById('inputTitle').value.trim();
    const author = document.getElementById('inputAuthor').value.trim();
    const cover = document.getElementById('inputCover').value.trim();
    const genre = document.getElementById('inputGenre').value;
    const rating = parseFloat(document.getElementById('inputRating').value) || 5;
    const bookLink = document.getElementById('inputBookLink').value.trim();
    const text = document.getElementById('inputReviewText').value.trim();
    const quote = document.getElementById('inputQuote').value.trim();

    if (!title || !author || !cover || !text) {
      this.toast('Please fill in all required fields', 'error');
      return;
    }

    const payload = {
      bookTitle: title,
      bookAuthor: author,
      coverUrl: cover,
      genre,
      rating,
      reviewText: text,
      quote,
      bookLink
    };

    // Check if offline: queue review
    if (!navigator.onLine) {
      this.queueOfflineReview(payload);
      this.closeCreateModal();
      e.target.reset();
      this.setRating(5);
      this.toast('Offline: review saved to draft queue. Will publish when online!', 'info');
      return;
    }

    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.authToken}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        this.closeCreateModal();
        e.target.reset();
        this.setRating(5);
        await this.fetchReviews();
        this.toast('Review published to BookGram!', 'success');
      } else {
        const errorMsg = data.errors ? data.errors.join(' ') : data.message;
        this.toast(errorMsg || 'Could not publish review', 'error');
      }
    } catch (err) {
      this.queueOfflineReview(payload);
      this.closeCreateModal();
      this.toast('Network error: review saved to offline queue', 'info');
    }
  },

  // Offline Draft Queue
  queueOfflineReview(reviewData) {
    const queue = JSON.parse(localStorage.getItem('bookgram_offline_reviews') || '[]');
    queue.push({ ...reviewData, queuedAt: Date.now() });
    localStorage.setItem('bookgram_offline_reviews', JSON.stringify(queue));
  },

  async syncOfflineQueue() {
    if (!navigator.onLine) return;
    const queue = JSON.parse(localStorage.getItem('bookgram_offline_reviews') || '[]');
    if (queue.length === 0) return;

    this.toast(`Syncing ${queue.length} offline review(s)...`, 'info');
    const remaining = [];

    for (const item of queue) {
      try {
        const res = await fetch('/api/reviews', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.state.authToken}`
          },
          body: JSON.stringify(item)
        });
        const data = await res.json();
        if (!data.success) remaining.push(item);
      } catch {
        remaining.push(item);
      }
    }

    localStorage.setItem('bookgram_offline_reviews', JSON.stringify(remaining));
    if (remaining.length === 0) {
      this.toast('All offline reviews synchronized!', 'success');
      await this.fetchReviews();
    }
  },

  // ==========================================
  // PROFILE MODAL
  // ==========================================
  async openProfile(userId) {
    this.state.viewingProfileId = userId;
    document.getElementById('profileModal').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    await this.renderProfileModal(userId, 'reviews');
  },

  closeProfileModal() {
    document.getElementById('profileModal').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    this.state.viewingProfileId = null;
  },

  async renderProfileModal(userId, tab = 'reviews') {
    try {
      const headers = {};
      if (this.state.authToken) headers['Authorization'] = `Bearer ${this.state.authToken}`;

      const res = await fetch(`/api/users/${userId}`, { headers });
      const data = await res.json();
      if (!data.success || !data.user) return;

      const user = data.user;
      const isMe = this.state.currentUser && user.id === this.state.currentUser.id;

      document.getElementById('modalProfileAvatar').src = user.avatar;
      document.getElementById('modalProfileName').textContent = user.name;
      document.getElementById('modalProfileHandle').textContent = user.handle;
      document.getElementById('modalProfileBio').textContent = user.bio || 'Book enthusiast sharing literary observations.';

      document.getElementById('modalStatReviews').textContent = user.stats.reviewsCount || 0;
      document.getElementById('modalStatFollowers').textContent = user.stats.followersCount || 0;
      document.getElementById('modalStatFollowing').textContent = user.stats.followingCount || 0;

      // Action button
      const actionBtnContainer = document.getElementById('modalProfileActionBtn');
      if (isMe) {
        actionBtnContainer.innerHTML = `
          <button onclick="app.closeProfileModal(); app.openCreateModal();" class="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-full text-xs font-bold transition shadow">
            <i class="fa-solid fa-plus mr-1"></i> New Review
          </button>
        `;
      } else {
        actionBtnContainer.innerHTML = `
          <button 
            onclick="app.toggleFollow('${user.id}')"
            class="px-5 py-2 text-xs font-bold rounded-full transition shadow-sm ${
              user.isFollowing 
                ? 'border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:text-red-500 hover:border-red-500' 
                : 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
            }"
          >
            ${user.isFollowing ? 'Following' : 'Follow'}
          </button>
        `;
      }

      // Tab switcher styles
      const btnRev = document.getElementById('pTabReviews');
      const btnLike = document.getElementById('pTabLiked');
      if (tab === 'reviews') {
        btnRev.className = "pb-3 border-b-2 border-brand-500 text-brand-600 dark:text-brand-400 font-bold";
        btnLike.className = "pb-3 border-b-2 border-transparent text-stone-600 dark:text-stone-400 font-semibold hover:text-stone-900";
      } else {
        btnLike.className = "pb-3 border-b-2 border-brand-500 text-brand-600 dark:text-brand-400 font-bold";
        btnRev.className = "pb-3 border-b-2 border-transparent text-stone-600 dark:text-stone-400 font-semibold hover:text-stone-900";
      }

      // Render items
      const postsContainer = document.getElementById('modalProfilePosts');
      const displayList = tab === 'reviews' ? (user.reviews || []) : (user.likedReviews || []);

      if (displayList.length === 0) {
        postsContainer.innerHTML = `
          <div class="py-12 text-center text-stone-400 text-xs">
            <i class="fa-solid fa-book text-2xl mb-2 opacity-50 block"></i>
            No reviews in this shelf tab yet.
          </div>
        `;
      } else {
        postsContainer.innerHTML = displayList.map(post => `
          <div class="p-3.5 rounded-2xl bg-stone-50 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-800 flex gap-4 items-center">
            <img src="${post.cover_url}" class="w-12 h-16 object-cover rounded-lg shadow shrink-0" alt="Cover">
            <div class="min-w-0 flex-1">
              <h4 class="font-serif-title font-bold text-sm text-stone-900 dark:text-stone-100 truncate">${post.book_title}</h4>
              <p class="text-xs text-stone-600 dark:text-stone-400 truncate">by ${post.book_author}</p>
              <div class="flex items-center gap-3 mt-1 text-[11px] text-stone-600 dark:text-stone-400">
                <span class="text-amber-500 font-bold"><i class="fa-solid fa-star text-[10px]"></i> ${post.rating}</span>
                <span><i class="fa-solid fa-heart text-[10px] text-rose-500"></i> ${post.likes_count || 0}</span>
                <span><i class="fa-solid fa-comment text-[10px]"></i> ${post.comments_count || 0}</span>
              </div>
            </div>
            ${post.book_link ? `
              <a href="${post.book_link}" target="_blank" rel="noopener noreferrer" class="text-stone-400 hover:text-brand-500 p-2 text-xs" title="Open Link">
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
              </a>
            ` : ''}
          </div>
        `).join('');
      }

    } catch (err) {
      console.warn('Profile fetch error:', err);
    }
  },

  switchProfileTab(tab) {
    if (this.state.viewingProfileId) {
      this.renderProfileModal(this.state.viewingProfileId, tab);
    }
  },

  // ==========================================
  // FILTERS & SEARCH
  // ==========================================
  setFeedFilter(filter) {
    this.state.activeFilter = filter;

    const tabs = ['all', 'following', 'saved'];
    tabs.forEach(t => {
      const el = document.getElementById(`tab-feed-${t}`);
      if (el) {
        if (t === filter) {
          el.className = "flex items-center justify-between px-3 py-2 text-sm rounded-xl font-medium text-brand-600 bg-brand-50 dark:bg-brand-950/40 transition font-bold";
        } else {
          el.className = "flex items-center justify-between px-3 py-2 text-sm rounded-xl font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 transition";
        }
      }
      const mEl = document.getElementById(`m-tab-${t}`);
      if (mEl) {
        if (t === filter) {
          mEl.className = "flex-1 py-2 rounded-xl text-center font-bold bg-brand-500 text-white shadow-sm";
        } else {
          mEl.className = "flex-1 py-2 rounded-xl text-center text-stone-600 dark:text-stone-300";
        }
      }
    });

    this.fetchReviews();
  },

  setGenreFilter(genre) {
    this.state.activeGenre = genre;
    this.renderGenres();
    this.fetchReviews();
  },

  handleSearch(query) {
    this.state.searchQuery = query;
    const clearBtn = document.getElementById('clearSearchBtn');
    if (query.trim()) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }

    clearTimeout(this.state.searchDebounceTimer);
    this.state.searchDebounceTimer = setTimeout(() => {
      this.fetchReviews();
    }, 280);
  },

  clearSearch() {
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    this.handleSearch('');
  },

  resetAllFilters() {
    this.state.activeFilter = 'all';
    this.state.activeGenre = 'all';
    this.state.searchQuery = '';
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    this.setFeedFilter('all');
    this.renderGenres();
  },

  showFeed() {
    this.resetAllFilters();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  sharePost(reviewId) {
    const post = this.state.reviews.find(r => r.id === reviewId);
    if (!post) return;

    const url = `${window.location.origin}/#review-${reviewId}`;
    if (navigator.share) {
      navigator.share({
        title: `${post.bookTitle} — Review by ${post.author.name}`,
        text: `Read this critique of ${post.bookTitle} on BookGram:`,
        url
      }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      this.toast(`Link to "${post.bookTitle}" review copied!`, 'success');
    } else {
      this.toast(`Review link: ${url}`, 'info');
    }
  },

  focusCommentInput(reviewId) {
    const input = document.getElementById(`commentInput-${reviewId}`);
    if (input) input.focus();
  },

  formatTime(dateString) {
    if (!dateString) return 'recently';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; // fallback to preformatted string if relative

    const now = new Date();
    const diffSec = Math.floor((now - date) / 1000);
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  },

  toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    let bg = 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900';
    let icon = '<i class="fa-solid fa-circle-info mr-2 text-brand-500"></i>';

    if (type === 'success') {
      icon = '<i class="fa-solid fa-circle-check mr-2 text-emerald-500"></i>';
    } else if (type === 'error') {
      icon = '<i class="fa-solid fa-circle-exclamation mr-2 text-rose-500"></i>';
    }

    toast.className = `${bg} px-4 py-2.5 rounded-2xl shadow-xl text-xs font-semibold flex items-center transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto`;
    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    });

    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }
};

// Bind to window for HTML event handlers
window.app = app;
window.PWA = PWA;

window.addEventListener('DOMContentLoaded', () => {
  app.init();
});
