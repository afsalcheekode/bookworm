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
    featuredBook: null,
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
      this.fetchSuggestedUsers(),
      this.fetchFeaturedBook()
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
    const mobileContainer = document.getElementById('mobileGenreContainer');

    const html = genres.map(g => {
      const val = g === 'All' ? 'all' : g;
      const isActive = this.state.activeGenre === val;
      return `
        <button 
          onclick="app.setGenreFilter('${val}')"
          class="px-3 py-1.5 text-xs rounded-xl font-medium transition whitespace-nowrap shrink-0 ${
            isActive 
              ? 'bg-brand-500 text-white shadow-sm font-semibold' 
              : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
          }"
        >
          ${g}
        </button>
      `;
    }).join('');

    if (container) container.innerHTML = html;
    if (mobileContainer) mobileContainer.innerHTML = html;
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

              <!-- Review Text Body with Read more toggle for long reviews -->
              ${(() => {
                const text = post.reviewText || '';
                const isLong = text.length > 180 || (text.split('\n').length >= 3);
                if (!isLong) {
                  return `
                    <p class="text-xs sm:text-sm text-stone-700 dark:text-stone-300 leading-relaxed whitespace-pre-line">
                      ${text}
                    </p>
                  `;
                }
                return `
                  <div>
                    <p id="review-text-${post.id}" class="text-xs sm:text-sm text-stone-700 dark:text-stone-300 leading-relaxed whitespace-pre-line clamp-review">
                      ${text}
                    </p>
                    <button 
                      type="button" 
                      id="review-toggle-btn-${post.id}" 
                      onclick="app.toggleReviewExpand('${post.id}')"
                      class="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 transition-colors focus:outline-none"
                    >
                      <span id="review-toggle-text-${post.id}">... Read more</span>
                      <i id="review-toggle-icon-${post.id}" class="fa-solid fa-chevron-down text-[10px] transition-transform duration-200"></i>
                    </button>
                  </div>
                `;
              })()}
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

  // Toggle Read More / Show Less for long reviews
  toggleReviewExpand(postId) {
    const textEl = document.getElementById(`review-text-${postId}`);
    const labelEl = document.getElementById(`review-toggle-text-${postId}`);
    const iconEl = document.getElementById(`review-toggle-icon-${postId}`);
    if (!textEl) return;

    const isClamped = textEl.classList.contains('clamp-review');
    if (isClamped) {
      textEl.classList.remove('clamp-review');
      if (labelEl) labelEl.textContent = 'Show less';
      if (iconEl) iconEl.className = 'fa-solid fa-chevron-up text-[10px] transition-transform duration-200';
    } else {
      textEl.classList.add('clamp-review');
      if (labelEl) labelEl.textContent = '... Read more';
      if (iconEl) iconEl.className = 'fa-solid fa-chevron-down text-[10px] transition-transform duration-200';
    }
  },

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
      if (data.success) {
        this.fetchFeaturedBook();
      } else {
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
        this.fetchFeaturedBook();
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

      // Avatar camera edit overlay button toggle
      const avatarEditBtn = document.getElementById('modalProfileAvatarEditBtn');
      if (avatarEditBtn) {
        if (isMe) avatarEditBtn.classList.remove('hidden');
        else avatarEditBtn.classList.add('hidden');
      }

      // Action button
      const actionBtnContainer = document.getElementById('modalProfileActionBtn');
      if (isMe) {
        actionBtnContainer.innerHTML = `
          <div class="flex items-center gap-2">
            <button onclick="app.openEditProfileModal()" class="px-3.5 py-1.5 border border-stone-300 dark:border-stone-700 hover:border-brand-500 text-stone-700 dark:text-stone-200 hover:text-brand-600 rounded-full text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
              <i class="fa-solid fa-pen-to-square text-xs"></i>
              <span>Edit Profile</span>
            </button>
            <button onclick="app.closeProfileModal(); app.openCreateModal();" class="px-4 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-full text-xs font-bold transition shadow flex items-center gap-1.5">
              <i class="fa-solid fa-plus text-xs"></i>
              <span>New Review</span>
            </button>
          </div>
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

      // Tab switcher styles with privacy enforcement
      const btnRev = document.getElementById('pTabReviews');
      const btnLike = document.getElementById('pTabLiked');

      if (!isMe) {
        // Privacy: Other visitors cannot see someone's private Favorites & Likes
        if (btnLike) btnLike.classList.add('hidden');
        tab = 'reviews';
      } else {
        if (btnLike) btnLike.classList.remove('hidden');
      }

      if (tab === 'reviews') {
        btnRev.className = "pb-3 border-b-2 border-brand-500 text-brand-600 dark:text-brand-400 font-bold";
        if (btnLike) btnLike.className = "pb-3 border-b-2 border-transparent text-stone-600 dark:text-stone-400 font-semibold hover:text-stone-900";
      } else {
        if (btnLike) btnLike.className = "pb-3 border-b-2 border-brand-500 text-brand-600 dark:text-brand-400 font-bold";
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
          <div 
            onclick="app.openBookDetails('${post.id}')"
            class="p-3.5 rounded-2xl bg-stone-50 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-800 flex gap-4 items-center cursor-pointer hover:border-brand-500/60 hover:bg-stone-100/90 dark:hover:bg-stone-800/80 transition group shadow-sm"
            title="Click to view book details & complete review"
          >
            <img 
              src="${post.cover_url}" 
              class="w-12 h-16 object-cover rounded-lg shadow shrink-0 group-hover:scale-105 transition-transform" 
              alt="Cover"
              onerror="this.src='https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600'"
            />
            <div class="min-w-0 flex-1">
              <h4 class="font-serif-title font-bold text-sm text-stone-900 dark:text-stone-100 truncate group-hover:text-brand-600 transition-colors">${post.book_title}</h4>
              <p class="text-xs text-stone-600 dark:text-stone-400 truncate">by ${post.book_author}</p>
              <div class="flex items-center gap-3 mt-1.5 text-[11px] text-stone-600 dark:text-stone-400">
                <span class="text-amber-500 font-bold flex items-center gap-1"><i class="fa-solid fa-star text-[10px]"></i> ${post.rating}</span>
                <span class="flex items-center gap-1"><i class="fa-solid fa-heart text-[10px] text-rose-500"></i> ${post.likes_count || 0}</span>
                <span class="flex items-center gap-1"><i class="fa-solid fa-comment text-[10px]"></i> ${post.comments_count || 0}</span>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-xs font-semibold text-brand-600 dark:text-brand-400 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                <span>Details</span>
                <i class="fa-solid fa-chevron-right text-[10px]"></i>
              </span>
              ${post.book_link ? `
                <a href="${post.book_link}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="text-stone-400 hover:text-brand-500 p-2 text-xs rounded-lg hover:bg-stone-200 dark:hover:bg-stone-700 transition" title="Open Link">
                  <i class="fa-solid fa-arrow-up-right-from-square"></i>
                </a>
              ` : ''}
            </div>
          </div>
        `).join('');
      }

    } catch (err) {
      console.warn('Profile fetch error:', err);
    }
  },

  switchProfileTab(tab) {
    if (this.state.viewingProfileId) {
      const isMe = this.state.currentUser && this.state.currentUser.id === this.state.viewingProfileId;
      if (!isMe && tab === 'liked') tab = 'reviews';
      this.renderProfileModal(this.state.viewingProfileId, tab);
    }
  },

  // ==========================================
  // BOOK & REVIEW DETAILS MODAL
  // ==========================================
  async openBookDetails(reviewId) {
    const modal = document.getElementById('bookDetailsModal');
    const body = document.getElementById('bookModalBody');
    const headerTitle = document.getElementById('bookModalHeaderTitle');
    const headerSubtitle = document.getElementById('bookModalHeaderSubtitle');

    if (!modal || !body) return;

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');

    // Show loading skeleton while fetching
    body.innerHTML = `
      <div class="flex flex-col sm:flex-row gap-5 items-start animate-pulse">
        <div class="w-36 sm:w-44 h-56 rounded-xl bg-stone-200 dark:bg-stone-800 shrink-0 mx-auto sm:mx-0"></div>
        <div class="flex-1 space-y-3 w-full">
          <div class="h-6 w-3/4 bg-stone-200 dark:bg-stone-800 rounded"></div>
          <div class="h-4 w-1/2 bg-stone-200 dark:bg-stone-800 rounded"></div>
          <div class="h-4 w-1/3 bg-stone-200 dark:bg-stone-800 rounded"></div>
          <div class="h-24 w-full bg-stone-200 dark:bg-stone-800 rounded-xl mt-4"></div>
        </div>
      </div>
    `;

    try {
      // First check local state for instant cached data
      let post = this.state.reviews ? this.state.reviews.find(r => r.id === reviewId) : null;

      // Fetch fresh full review data from backend
      const headers = {};
      if (this.state.authToken) headers['Authorization'] = `Bearer ${this.state.authToken}`;
      const res = await fetch(`/api/reviews/${reviewId}`, { headers });
      const data = await res.json();
      if (data.success && data.review) {
        post = data.review;
      }

      if (!post) {
        body.innerHTML = `
          <div class="py-12 text-center text-stone-500">
            <i class="fa-solid fa-triangle-exclamation text-3xl mb-3 text-amber-500 block"></i>
            <p class="font-bold">Book review not found.</p>
            <button onclick="app.closeBookDetailsModal()" class="mt-4 px-4 py-2 bg-stone-200 dark:bg-stone-800 rounded-full text-xs font-semibold">Close</button>
          </div>
        `;
        return;
      }

      if (headerTitle) headerTitle.textContent = post.bookTitle;
      if (headerSubtitle) headerSubtitle.textContent = `by ${post.bookAuthor} · ${post.genre || 'Literature'}`;

      const rating = Number(post.rating) || 5;
      const fullStars = Math.floor(rating);
      const halfStar = rating % 1 >= 0.5;
      let starHTML = '';
      for (let i = 0; i < fullStars; i++) starHTML += '<i class="fa-solid fa-star text-amber-500 text-sm"></i>';
      if (halfStar) starHTML += '<i class="fa-solid fa-star-half-stroke text-amber-500 text-sm"></i>';
      const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);
      for (let i = 0; i < emptyStars; i++) starHTML += '<i class="fa-regular fa-star text-stone-300 dark:text-stone-600 text-sm"></i>';

      const currentUserId = this.state.currentUser ? this.state.currentUser.id : null;
      const likesList = post.likes || [];
      const isLiked = currentUserId ? likesList.includes(currentUserId) : false;
      const isSaved = (this.state.currentUser && this.state.currentUser.savedReviewIds)
        ? this.state.currentUser.savedReviewIds.includes(post.id)
        : (post.isSaved || false);
      const commentsList = post.comments || [];

      body.innerHTML = `
        <!-- Book Core Information -->
        <div class="flex flex-col sm:flex-row gap-6 items-start">
          <!-- Book Cover -->
          <div class="w-full sm:w-44 shrink-0 flex flex-col items-center">
            <div class="relative w-36 sm:w-full aspect-[2/3] rounded-2xl overflow-hidden book-shadow border border-stone-200 dark:border-stone-700 bg-stone-200 dark:bg-stone-800">
              <img 
                src="${post.coverUrl || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600'}" 
                alt="${post.bookTitle} Cover" 
                class="w-full h-full object-cover"
                onerror="this.src='https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600'"
              />
            </div>
            ${post.bookLink ? `
              <a 
                href="${post.bookLink}" 
                target="_blank" 
                rel="noopener noreferrer"
                class="mt-3.5 w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 hover:bg-amber-100 transition shadow-sm"
              >
                <i class="fa-solid fa-cart-shopping text-xs"></i>
                <span>Get / Read Book</span>
                <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
              </a>
            ` : ''}
          </div>

          <!-- Book & Review Info -->
          <div class="flex-1 space-y-4 min-w-0">
            <div>
              <div class="flex flex-wrap items-center gap-2 mb-1.5">
                <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-brand-50 dark:bg-brand-950/60 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-900/60">
                  ${post.genre || 'General Literature'}
                </span>
                <span class="text-[11px] text-stone-500 dark:text-stone-400">
                  Reviewed ${this.formatTime(post.createdAt)}
                </span>
              </div>
              <h3 class="font-serif-title text-2xl font-bold text-stone-900 dark:text-stone-100 leading-tight">
                ${post.bookTitle}
              </h3>
              <p class="text-sm font-medium text-stone-600 dark:text-stone-400 mt-1">
                by <span class="text-stone-800 dark:text-stone-200 font-semibold">${post.bookAuthor}</span>
              </p>
            </div>

            <!-- Star Rating -->
            <div class="flex items-center gap-2 p-2.5 rounded-xl bg-stone-50 dark:bg-stone-900/70 border border-stone-200 dark:border-stone-800">
              <div class="flex items-center gap-1">${starHTML}</div>
              <span class="text-sm font-bold text-stone-800 dark:text-stone-100">${rating.toFixed(1)}</span>
              <span class="text-xs text-stone-500">/ 5.0 Star Rating</span>
            </div>

            <!-- Reviewer Profile Card -->
            <div class="flex items-center justify-between p-3 rounded-2xl bg-stone-50 dark:bg-stone-900/70 border border-stone-200 dark:border-stone-800">
              <div class="flex items-center gap-3 cursor-pointer" onclick="app.closeBookDetailsModal(); app.openProfile('${post.author.id}')">
                <img src="${post.author.avatar}" class="w-10 h-10 rounded-full object-cover border-2 border-brand-500" alt="${post.author.name}">
                <div>
                  <h4 class="font-bold text-xs sm:text-sm text-stone-900 dark:text-stone-100 hover:underline flex items-center gap-1.5">
                    ${post.author.name}
                    <i class="fa-solid fa-circle-check text-brand-500 text-[10px]"></i>
                  </h4>
                  <p class="text-[11px] text-stone-500 dark:text-stone-400">${post.author.handle}</p>
                </div>
              </div>
              <button 
                onclick="app.closeBookDetailsModal(); app.openProfile('${post.author.id}')"
                class="px-3 py-1 text-xs font-semibold rounded-full border border-stone-300 dark:border-stone-700 hover:border-brand-500 text-stone-700 dark:text-stone-200 hover:text-brand-600 transition"
              >
                View Shelf
              </button>
            </div>
          </div>
        </div>

        <!-- Memorable Quote -->
        ${post.quote ? `
          <div class="p-4 rounded-2xl bg-brand-50/50 dark:bg-brand-950/20 border-l-4 border-brand-500 text-xs sm:text-sm italic text-stone-800 dark:text-stone-200 font-serif leading-relaxed">
            ${post.quote}
          </div>
        ` : ''}

        <!-- Full Review Text -->
        <div class="space-y-2">
          <h4 class="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Full Literary Review
          </h4>
          <div class="p-4 rounded-2xl bg-stone-50 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-800">
            <p class="text-xs sm:text-sm text-stone-800 dark:text-stone-200 leading-relaxed whitespace-pre-line">
              ${post.reviewText}
            </p>
          </div>
        </div>

        <!-- Social Interactions Bar -->
        <div class="flex items-center justify-between p-3.5 rounded-2xl bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-xs">
          <div class="flex items-center gap-4">
            <button 
              onclick="app.toggleLike('${post.id}'); app.openBookDetails('${post.id}');"
              class="flex items-center gap-1.5 font-bold transition transform active:scale-125 ${isLiked ? 'text-rose-500' : 'text-stone-600 dark:text-stone-400 hover:text-rose-500'}"
            >
              <i class="fa-heart text-base ${isLiked ? 'fa-solid' : 'fa-regular'}"></i>
              <span>${likesList.length} Likes</span>
            </button>
            <span class="text-stone-600 dark:text-stone-400 font-semibold flex items-center gap-1.5">
              <i class="fa-regular fa-comment text-base"></i>
              <span>${commentsList.length} Comments</span>
            </span>
            <button 
              onclick="app.sharePost('${post.id}')"
              class="text-stone-600 dark:text-stone-400 hover:text-brand-500 font-semibold flex items-center gap-1.5 transition"
              title="Copy link"
            >
              <i class="fa-regular fa-paper-plane text-base"></i>
              <span>Share</span>
            </button>
          </div>

          <div class="flex items-center gap-2">
            <button 
              onclick="app.toggleSavePost('${post.id}'); app.openBookDetails('${post.id}');"
              class="flex items-center gap-1 font-semibold text-stone-600 dark:text-stone-400 hover:text-brand-600 transition"
              title="Save book"
            >
              <i class="fa-bookmark text-base ${isSaved ? 'fa-solid text-brand-600' : 'fa-regular'}"></i>
              <span>${isSaved ? 'Saved' : 'Save'}</span>
            </button>
            <button 
              onclick="app.scrollToPostInFeed('${post.id}')"
              class="px-3 py-1.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs transition shadow-sm"
              title="Jump to post in feed"
            >
              Feed View
            </button>
          </div>
        </div>

        <!-- Discussion / Comments -->
        <div class="space-y-3 pt-2">
          <h4 class="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Community Discussion (${commentsList.length})
          </h4>
          <div class="space-y-2.5 max-h-48 overflow-y-auto pr-1">
            ${commentsList.length === 0 ? `
              <p class="text-xs text-stone-500 italic p-3 rounded-xl bg-stone-50 dark:bg-stone-900/60">No comments yet. Be the first to share your perspective!</p>
            ` : commentsList.map(c => `
              <div class="flex items-start gap-2.5 p-2.5 rounded-xl bg-stone-50 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-800 text-xs">
                <img src="${c.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80'}" class="w-6 h-6 rounded-full object-cover shrink-0 mt-0.5" alt="${c.name}">
                <div class="min-w-0 flex-1 leading-tight">
                  <div class="flex items-center gap-1.5">
                    <span class="font-bold text-stone-900 dark:text-stone-100 cursor-pointer hover:underline" onclick="app.closeBookDetailsModal(); app.openProfile('${c.user_id}')">
                      ${c.name}
                    </span>
                    <span class="text-[10px] text-stone-500">${this.formatTime(c.created_at)}</span>
                  </div>
                  <p class="text-stone-700 dark:text-stone-300 mt-1">${c.text}</p>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Add Comment Input -->
          <form onsubmit="app.handleAddModalComment(event, '${post.id}')" class="flex gap-2 items-center pt-1">
            <img src="${this.state.currentUser ? this.state.currentUser.avatar : 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80'}" class="w-7 h-7 rounded-full object-cover shrink-0" alt="Me">
            <div class="flex-1 relative">
              <input 
                type="text" 
                id="modalCommentInput-${post.id}" 
                placeholder="Share your thought on this book..." 
                class="w-full pl-3.5 pr-10 py-2 text-xs rounded-full bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 focus:border-brand-500 focus:outline-none transition"
              />
              <button 
                type="submit" 
                class="absolute right-1.5 top-1 w-7 h-7 rounded-full text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 flex items-center justify-center transition"
                title="Send"
              >
                <i class="fa-solid fa-arrow-up text-xs"></i>
              </button>
            </div>
          </form>
        </div>
      `;

    } catch (err) {
      console.error('Error fetching book details:', err);
      body.innerHTML = `
        <div class="py-12 text-center text-rose-500">
          <p>Failed to load book details. Please try again.</p>
        </div>
      `;
    }
  },

  closeBookDetailsModal() {
    const modal = document.getElementById('bookDetailsModal');
    if (modal) modal.classList.add('hidden');
    const profileModal = document.getElementById('profileModal');
    if (!profileModal || profileModal.classList.contains('hidden')) {
      document.body.classList.remove('overflow-hidden');
    }
  },

  scrollToPostInFeed(postId) {
    this.closeBookDetailsModal();
    this.closeProfileModal();
    const el = document.getElementById(`review-card-${postId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-4', 'ring-brand-500/50');
      setTimeout(() => el.classList.remove('ring-4', 'ring-brand-500/50'), 2500);
    }
  },

  async handleAddModalComment(e, reviewId) {
    e.preventDefault();
    const input = document.getElementById(`modalCommentInput-${reviewId}`);
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
        await this.openBookDetails(reviewId);
      } else {
        this.toast(data.message || 'Failed to post comment', 'error');
      }
    } catch {
      this.toast('Offline comment failed', 'error');
    }
  },

  // ==========================================
  // PROFILE EDITING (NAME, BIO, PHOTO)
  // ==========================================
  presetAvatars: [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=240&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=240&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=240&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=240&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=240&auto=format&fit=crop&q=80',
  ],

  openEditProfileModal() {
    const u = this.state.currentUser;
    if (!u) {
      this.openAuthModal('login');
      return;
    }

    const modal = document.getElementById('editProfileModal');
    if (!modal) return;

    document.getElementById('editProfileName').value = u.name || '';
    const bio = u.bio || '';
    document.getElementById('editProfileBio').value = bio;
    document.getElementById('editBioCharCount').textContent = `${bio.length} / 300`;
    document.getElementById('editAvatarPreview').src = u.avatar;
    document.getElementById('editAvatarUrl').value = '';
    const fileInput = document.getElementById('avatarFileInput');
    if (fileInput) fileInput.value = '';

    const usernameInput = document.getElementById('editProfileUsername');
    if (usernameInput) {
      usernameInput.value = u.username || (u.handle ? u.handle.replace(/^@/, '') : '');
    }
    const statusMsg = document.getElementById('usernameStatusMessage');
    if (statusMsg) {
      statusMsg.textContent = 'Unique username (3–24 letters, numbers, or underscores).';
      statusMsg.className = 'text-[11px] text-stone-500 dark:text-stone-400 mt-1';
    }
    const statusIcon = document.getElementById('usernameStatusIcon');
    if (statusIcon) statusIcon.classList.add('hidden');

    this.state.tempAvatarData = u.avatar;
    this.renderPresetAvatars();

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  },

  closeEditProfileModal() {
    const modal = document.getElementById('editProfileModal');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    this.state.tempAvatarData = null;
  },

  renderPresetAvatars() {
    const grid = document.getElementById('presetAvatarGrid');
    if (!grid) return;

    grid.innerHTML = this.presetAvatars.map((url, i) => `
      <img 
        src="${url}" 
        alt="Preset ${i+1}" 
        onclick="app.selectPresetAvatar('${url}')"
        class="w-10 h-10 rounded-full object-cover cursor-pointer border-2 hover:border-brand-500 hover:scale-105 transition shadow-sm ${this.state.tempAvatarData === url ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-stone-200 dark:border-stone-700'}"
      />
    `).join('');
  },

  selectPresetAvatar(url) {
    this.state.tempAvatarData = url;
    document.getElementById('editAvatarPreview').src = url;
    document.getElementById('editAvatarUrl').value = '';
    this.renderPresetAvatars();
    this.toast('Preset photo selected', 'info');
  },

  selectRandomPresetAvatar() {
    const random = this.presetAvatars[Math.floor(Math.random() * this.presetAvatars.length)];
    this.selectPresetAvatar(random);
  },

  previewAvatarUrl(val) {
    if (val && val.trim().startsWith('http')) {
      this.state.tempAvatarData = val.trim();
      document.getElementById('editAvatarPreview').src = val.trim();
    }
  },

  handleAvatarFileUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.toast('Please choose an image file (PNG, JPG, WebP)', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Create canvas to crop & resize to crisp 400x400 avatar (~40KB)
        const canvas = document.createElement('canvas');
        const size = 400;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Center crop square
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
        document.getElementById('editAvatarPreview').src = compressedDataUrl;
        document.getElementById('editAvatarUrl').value = '';
        this.state.tempAvatarData = compressedDataUrl;
        this.renderPresetAvatars();
        this.toast('Photo ready! Click Save Changes.', 'success');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  },

  usernameDebounceTimer: null,
  handleUsernameInput(val) {
    clearTimeout(this.usernameDebounceTimer);
    const clean = (val || '').trim().toLowerCase().replace(/^@/, '');
    const currentUsername = (this.state.currentUser && this.state.currentUser.username || '').toLowerCase();
    const statusMsg = document.getElementById('usernameStatusMessage');
    const statusIcon = document.getElementById('usernameStatusIcon');

    if (!clean) {
      if (statusMsg) {
        statusMsg.textContent = 'Username is required.';
        statusMsg.className = 'text-[11px] text-rose-500 mt-1';
      }
      if (statusIcon) statusIcon.classList.add('hidden');
      return;
    }

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(clean)) {
      if (statusMsg) {
        statusMsg.textContent = 'Must be 3–24 letters, numbers, or underscores.';
        statusMsg.className = 'text-[11px] text-rose-500 mt-1';
      }
      if (statusIcon) {
        statusIcon.innerHTML = '<i class="fa-solid fa-circle-xmark text-rose-500"></i>';
        statusIcon.classList.remove('hidden');
      }
      return;
    }

    if (clean === currentUsername) {
      if (statusMsg) {
        statusMsg.textContent = `Your current username (@${clean}).`;
        statusMsg.className = 'text-[11px] text-stone-500 dark:text-stone-400 mt-1';
      }
      if (statusIcon) {
        statusIcon.innerHTML = '<i class="fa-solid fa-circle-check text-stone-400"></i>';
        statusIcon.classList.remove('hidden');
      }
      return;
    }

    // Show checking spinner
    if (statusIcon) {
      statusIcon.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-stone-400"></i>';
      statusIcon.classList.remove('hidden');
    }

    this.usernameDebounceTimer = setTimeout(async () => {
      try {
        const headers = {};
        if (this.state.authToken) headers['Authorization'] = `Bearer ${this.state.authToken}`;
        const res = await fetch(`/api/auth/check-username?username=${encodeURIComponent(clean)}`, { headers });
        const data = await res.json();
        if (data.available) {
          if (statusMsg) {
            statusMsg.textContent = `@${clean} is available!`;
            statusMsg.className = 'text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1';
          }
          if (statusIcon) {
            statusIcon.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-500"></i>';
          }
        } else {
          if (statusMsg) {
            statusMsg.textContent = `@${clean} is already taken. Please pick another.`;
            statusMsg.className = 'text-[11px] text-rose-500 font-semibold mt-1';
          }
          if (statusIcon) {
            statusIcon.innerHTML = '<i class="fa-solid fa-circle-xmark text-rose-500"></i>';
          }
        }
      } catch {
        if (statusIcon) statusIcon.classList.add('hidden');
      }
    }, 280);
  },

  async handleSaveProfile(e) {
    e.preventDefault();
    const usernameInput = document.getElementById('editProfileUsername');
    const username = usernameInput ? usernameInput.value.trim().toLowerCase().replace(/^@/, '') : '';
    const name = document.getElementById('editProfileName').value.trim();
    const bio = document.getElementById('editProfileBio').value.trim();
    const urlInput = document.getElementById('editAvatarUrl').value.trim();
    const avatar = urlInput || this.state.tempAvatarData || (this.state.currentUser && this.state.currentUser.avatar);

    if (!username) {
      this.toast('Username is required', 'error');
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      this.toast('Username must be 3-24 alphanumeric characters or underscores', 'error');
      return;
    }
    if (!name) {
      this.toast('Full Name is required', 'error');
      return;
    }

    const saveBtn = document.getElementById('btnSaveProfile');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...';
    }

    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.authToken}`
        },
        body: JSON.stringify({ username, name, bio, avatar })
      });

      const data = await res.json();
      if (data.success && data.user) {
        this.setCurrentUser(data.user);
        this.closeEditProfileModal();

        // If currently viewing profile modal, update it in place
        if (this.state.viewingProfileId === data.user.id) {
          await this.renderProfileModal(data.user.id);
        }

        // Refresh feed & suggested users so new name & avatar reflect everywhere
        await Promise.all([
          this.fetchReviews(),
          this.fetchSuggestedUsers()
        ]);

        this.toast('Profile updated successfully!', 'success');
      } else {
        this.toast(data.message || 'Error updating profile', 'error');
      }
    } catch {
      this.toast('Network error updating profile', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-check text-xs"></i> <span>Save Changes</span>';
      }
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

  toggleMobileSearch() {
    const drawer = document.getElementById('mobileSearchDrawer');
    if (!drawer) return;
    const isHidden = drawer.classList.toggle('hidden');
    if (!isHidden) {
      const input = document.getElementById('mobileSearchInput');
      if (input) input.focus();
    }
  },

  handleSearch(query) {
    this.state.searchQuery = query;

    // Sync values between desktop and mobile search bars
    const desktopInput = document.getElementById('searchInput');
    const mobileInput = document.getElementById('mobileSearchInput');
    if (desktopInput && desktopInput.value !== query) desktopInput.value = query;
    if (mobileInput && mobileInput.value !== query) mobileInput.value = query;

    const clearBtn = document.getElementById('clearSearchBtn');
    const clearMobileBtn = document.getElementById('clearMobileSearchBtn');
    if (query.trim()) {
      if (clearBtn) clearBtn.classList.remove('hidden');
      if (clearMobileBtn) clearMobileBtn.classList.remove('hidden');
    } else {
      if (clearBtn) clearBtn.classList.add('hidden');
      if (clearMobileBtn) clearMobileBtn.classList.add('hidden');
    }

    clearTimeout(this.state.searchDebounceTimer);
    this.state.searchDebounceTimer = setTimeout(() => {
      this.fetchReviews();
    }, 280);
  },

  clearSearch() {
    const desktopInput = document.getElementById('searchInput');
    const mobileInput = document.getElementById('mobileSearchInput');
    if (desktopInput) desktopInput.value = '';
    if (mobileInput) mobileInput.value = '';
    this.handleSearch('');
  },

  async fetchFeaturedBook() {
    try {
      const res = await fetch('/api/books/featured');
      const data = await res.json();
      if (data.success && data.featuredBook) {
        this.state.featuredBook = data.featuredBook;
        this.renderBookOfTheWeek();
      }
    } catch (e) {
      console.warn('Featured book error:', e);
    }
  },

  renderBookOfTheWeek() {
    const book = this.state.featuredBook;
    if (!book) return;

    // Desktop sidebar card
    const container = document.getElementById('bookOfTheWeekContainer');
    if (container) {
      container.innerHTML = `
        <div class="flex items-center justify-between mb-2">
          <span class="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/50 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <i class="fa-solid fa-heart text-[9px]"></i> Most Liked Book
          </span>
          <span class="text-[10px] text-amber-600 dark:text-amber-400 font-bold" title="Total Community Likes">
            ${book.likesCount} ${book.likesCount === 1 ? 'like' : 'likes'}
          </span>
        </div>
        <div class="flex gap-3 mt-1 items-start">
          <img src="${book.coverUrl}" class="w-14 h-20 object-cover rounded-lg shadow-md shrink-0 border border-stone-200 dark:border-stone-700" alt="Book cover" onerror="this.src='https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=200'">
          <div class="min-w-0 flex-1">
            <h4 class="font-serif-title font-bold text-sm leading-tight text-stone-900 dark:text-stone-100 truncate">${book.title}</h4>
            <p class="text-xs text-stone-500 dark:text-stone-400 mt-0.5 truncate">${book.author}</p>
            <div class="flex items-center gap-1.5 text-xs mt-1.5">
              <span class="text-amber-500 font-bold text-xs flex items-center gap-0.5">
                <i class="fa-solid fa-star text-[10px]"></i> ${book.rating}
              </span>
              <span class="text-[10px] text-stone-300 dark:text-stone-700">•</span>
              <span class="text-[11px] text-rose-500 font-semibold flex items-center gap-1" title="Total Community Likes">
                <i class="fa-solid fa-heart text-[10px]"></i> ${book.likesCount}
              </span>
              <span class="text-[10px] text-stone-300 dark:text-stone-700">•</span>
              <span class="text-[11px] text-blue-500 font-semibold flex items-center gap-1" title="Total Comments">
                <i class="fa-solid fa-comment text-[10px]"></i> ${book.commentsCount}
              </span>
            </div>
            <p class="text-[10px] text-stone-400 mt-1">${book.reviewCount} ${book.reviewCount === 1 ? 'review' : 'reviews'} written</p>
          </div>
        </div>
        <a 
          href="${book.bookLink}" 
          target="_blank" 
          rel="noopener noreferrer" 
          class="mt-3 block text-center py-1.5 text-xs font-semibold rounded-xl bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-200 border border-stone-200 dark:border-stone-700 hover:border-brand-500 transition shadow-sm"
        >
          Explore Title & Links <i class="fa-solid fa-arrow-up-right-from-square ml-1 text-[10px]"></i>
        </a>
      `;
    }

    // Mobile spotlight banner
    const mobileContainer = document.getElementById('mobileBookOfTheWeekContainer');
    if (mobileContainer) {
      mobileContainer.innerHTML = `
        <div class="p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/10 via-brand-500/10 to-rose-500/10 dark:from-amber-950/40 dark:to-rose-950/30 border border-amber-200/60 dark:border-amber-900/40 flex items-center gap-3">
          <img src="${book.coverUrl}" class="w-11 h-16 object-cover rounded-lg shadow shrink-0" alt="Cover" onerror="this.src='https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=120'">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-[9px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/60 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
                <i class="fa-solid fa-heart text-[8px]"></i> Most Liked Book
              </span>
              <span class="text-[10px] text-amber-600 dark:text-amber-400 font-bold">★ ${book.rating}</span>
            </div>
            <h4 class="font-serif-title font-bold text-xs text-stone-900 dark:text-stone-100 truncate mt-0.5">${book.title}</h4>
            <p class="text-[11px] text-stone-500 truncate">${book.author}</p>
            <div class="flex items-center gap-3 text-[10px] text-stone-500 dark:text-stone-400 mt-1">
              <span class="font-bold text-rose-500"><i class="fa-solid fa-heart text-[9px] mr-1"></i>${book.likesCount} likes</span>
              <span><i class="fa-solid fa-comment text-blue-500 text-[9px] mr-1"></i>${book.commentsCount} comments</span>
            </div>
          </div>
          <a href="${book.bookLink}" target="_blank" class="p-2 text-stone-400 hover:text-brand-500" title="Read more">
            <i class="fa-solid fa-arrow-up-right-from-square text-xs"></i>
          </a>
        </div>
      `;
      mobileContainer.classList.remove('hidden');
    }
  },

  resetAllFilters() {
    this.state.activeFilter = 'all';
    this.state.activeGenre = 'all';
    this.state.searchQuery = '';
    const desktopInput = document.getElementById('searchInput');
    const mobileInput = document.getElementById('mobileSearchInput');
    if (desktopInput) desktopInput.value = '';
    if (mobileInput) mobileInput.value = '';
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
