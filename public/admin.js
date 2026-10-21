/**
 * BookWorm — Administrator Client Controller
 */

// State
let currentAdminUser = null;
let activeTab = 'overview';
let cachedUsers = [];
let userSearchTimer = null;
let postSearchTimer = null;
let commentSearchTimer = null;

// DOM Elements
const adminLoginView = document.getElementById('adminLoginView');
const adminDashboardView = document.getElementById('adminDashboardView');
const toastContainer = document.getElementById('toastContainer');

// -------------------------------------------------------------------
// 1. API HELPER WITH HEADERS
// -------------------------------------------------------------------
function getAdminAuthHeaders() {
  const token = localStorage.getItem('bookworm_admin_token') || localStorage.getItem('bookworm_token');
  const masterKey = sessionStorage.getItem('bookworm_admin_key');
  const headers = { 'Content-Type': 'application/json' };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (masterKey) {
    headers['x-admin-key'] = masterKey;
  }
  return headers;
}

async function apiCall(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: getAdminAuthHeaders()
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(endpoint, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMsg = data.message || `HTTP ${response.status}: Action failed`;
    throw new Error(errorMsg);
  }
  return data;
}

// -------------------------------------------------------------------
// 2. TOAST NOTIFICATIONS
// -------------------------------------------------------------------
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  const isErr = type === 'error';
  toast.className = `p-3.5 rounded-xl text-xs font-semibold shadow-xl border flex items-center gap-2.5 transition-all transform duration-300 pointer-events-auto ${
    isErr 
      ? 'bg-rose-950/90 text-rose-200 border-rose-800' 
      : 'bg-emerald-950/90 text-emerald-200 border-emerald-800'
  }`;
  
  toast.innerHTML = `
    <i class="fa-solid ${isErr ? 'fa-circle-xmark text-rose-400' : 'fa-circle-check text-emerald-400'} text-sm"></i>
    <span>${escapeHtml(message)}</span>
  `;

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// -------------------------------------------------------------------
// 3. AUTHENTICATION & LOGIN FLOWS
// -------------------------------------------------------------------
function switchLoginMode(mode) {
  const tabMaster = document.getElementById('tabMasterKeyBtn');
  const tabAccount = document.getElementById('tabAccountBtn');
  const formMaster = document.getElementById('masterKeyForm');
  const formAccount = document.getElementById('accountLoginForm');

  if (mode === 'master') {
    tabMaster.className = 'py-2 rounded-lg bg-brand-600 text-white transition';
    tabAccount.className = 'py-2 rounded-lg text-slate-400 hover:text-white transition';
    formMaster.classList.remove('hidden');
    formAccount.classList.add('hidden');
  } else {
    tabAccount.className = 'py-2 rounded-lg bg-brand-600 text-white transition';
    tabMaster.className = 'py-2 rounded-lg text-slate-400 hover:text-white transition';
    formAccount.classList.remove('hidden');
    formMaster.classList.add('hidden');
  }
}

async function handleMasterKeyLogin(e) {
  e.preventDefault();
  const input = document.getElementById('adminSecretKeyInput');
  const adminKey = input.value.trim();
  if (!adminKey) return;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminKey })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Invalid Master Passkey');
    }

    sessionStorage.setItem('bookworm_admin_key', adminKey);
    if (data.token) localStorage.setItem('bookworm_admin_token', data.token);
    currentAdminUser = data.user;
    showToast('Authenticated as Administrator!');
    showDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleAccountLogin(e) {
  e.preventDefault();
  const username = document.getElementById('adminUsernameInput').value.trim();
  const password = document.getElementById('adminPasswordInput').value;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Login failed');
    }

    if (data.token) localStorage.setItem('bookworm_admin_token', data.token);
    currentAdminUser = data.user;
    showToast(`Welcome back, ${data.user.name}!`);
    showDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function handleAdminLogout() {
  localStorage.removeItem('bookworm_admin_token');
  sessionStorage.removeItem('bookworm_admin_key');
  currentAdminUser = null;
  adminDashboardView.classList.add('hidden');
  adminLoginView.classList.remove('hidden');
  showToast('Logged out of Admin Console');
}

async function checkExistingAuth() {
  try {
    const res = await apiCall('/api/admin/me');
    if (res && res.success) {
      currentAdminUser = res.user;
      showDashboard();
      return;
    }
  } catch (err) {
    // Session not active, show login
  }
  adminDashboardView.classList.add('hidden');
  adminLoginView.classList.remove('hidden');
}

function showDashboard() {
  adminLoginView.classList.add('hidden');
  adminDashboardView.classList.remove('hidden');
  setActiveTab('overview');
}

// -------------------------------------------------------------------
// 4. NAVIGATION & TABS
// -------------------------------------------------------------------
function setActiveTab(tab) {
  activeTab = tab;
  ['overview', 'users', 'posts', 'comments'].forEach(t => {
    const btn = document.getElementById(`tabBtn-${t}`);
    const content = document.getElementById(`tabContent-${t}`);
    if (t === tab) {
      btn.className = 'tab-btn px-4 py-3 border-b-2 border-brand-500 text-white flex items-center gap-2 transition whitespace-nowrap';
      content.classList.remove('hidden');
    } else {
      btn.className = 'tab-btn px-4 py-3 border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2 transition whitespace-nowrap';
      content.classList.add('hidden');
    }
  });

  if (tab === 'overview') loadAdminStats();
  if (tab === 'users') loadAdminUsers();
  if (tab === 'posts') loadAdminReviews();
  if (tab === 'comments') loadAdminComments();
}

// -------------------------------------------------------------------
// 5. OVERVIEW & STATS
// -------------------------------------------------------------------
async function loadAdminStats() {
  try {
    const data = await apiCall('/api/admin/stats');
    const { stats } = data;

    document.getElementById('statTotalUsers').textContent = stats.totalUsers || 0;
    document.getElementById('statTotalReviews').textContent = stats.totalReviews || 0;
    document.getElementById('statTotalComments').textContent = stats.totalComments || 0;
    document.getElementById('statTotalLikes').textContent = stats.totalLikes || 0;
    document.getElementById('statDatabase').textContent = stats.database || 'Cloud Database';
    document.getElementById('statNodeVersion').textContent = stats.nodeVersion || 'Node.js';

    const hours = Math.floor(stats.uptimeSeconds / 3600);
    const mins = Math.floor((stats.uptimeSeconds % 3600) / 60);
    document.getElementById('statUptime').textContent = `${hours}h ${mins}m active`;

    document.getElementById('usersCountBadge').textContent = stats.totalUsers || 0;
    document.getElementById('postsCountBadge').textContent = stats.totalReviews || 0;
    document.getElementById('commentsCountBadge').textContent = stats.totalComments || 0;

    // Render Recent Reviews
    const recentRevContainer = document.getElementById('recentReviewsList');
    if (!stats.recentReviews || stats.recentReviews.length === 0) {
      recentRevContainer.innerHTML = '<div class="text-xs text-slate-500 py-4 text-center">No reviews yet.</div>';
    } else {
      recentRevContainer.innerHTML = stats.recentReviews.map(r => `
        <div class="p-3 bg-black/40 rounded-xl border border-borderDark flex items-center justify-between gap-3 text-xs">
          <div class="truncate">
            <span class="font-bold text-white block truncate">${escapeHtml(r.book_title)}</span>
            <span class="text-slate-400 text-[11px]">by ${escapeHtml(r.book_author)} • Review by ${escapeHtml(r.author_name)}</span>
          </div>
          <div class="text-amber-400 font-bold whitespace-nowrap">★ ${r.rating}</div>
        </div>
      `).join('');
    }

    // Render Recent Users
    const recentUsersContainer = document.getElementById('recentUsersList');
    if (!stats.recentUsers || stats.recentUsers.length === 0) {
      recentUsersContainer.innerHTML = '<div class="text-xs text-slate-500 py-4 text-center">No users registered yet.</div>';
    } else {
      recentUsersContainer.innerHTML = stats.recentUsers.map(u => `
        <div class="p-3 bg-black/40 rounded-xl border border-borderDark flex items-center justify-between gap-3 text-xs">
          <div class="flex items-center gap-2.5 truncate">
            <img src="${escapeHtml(u.avatar)}" class="w-7 h-7 rounded-full object-cover border border-slate-700" alt="">
            <div class="truncate">
              <span class="font-bold text-white block truncate">${escapeHtml(u.name)}</span>
              <span class="text-slate-400 text-[11px]">${escapeHtml(u.handle)}</span>
            </div>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold ${u.is_admin ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30' : 'bg-slate-800 text-slate-400'}">
            ${u.is_admin ? 'Admin' : 'Reader'}
          </span>
        </div>
      `).join('');
    }

  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -------------------------------------------------------------------
// 6. ACCOUNTS (USERS) MANAGEMENT
// -------------------------------------------------------------------
function debounceUserSearch() {
  clearTimeout(userSearchTimer);
  userSearchTimer = setTimeout(() => {
    loadAdminUsers();
  }, 300);
}

async function loadAdminUsers() {
  const query = document.getElementById('userSearchInput').value.trim();
  const url = query ? `/api/admin/users?q=${encodeURIComponent(query)}` : '/api/admin/users';
  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-slate-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading user accounts...</td></tr>';

  try {
    const data = await apiCall(url);
    cachedUsers = data.users || [];
    document.getElementById('usersCountBadge').textContent = cachedUsers.length;

    if (cachedUsers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-slate-500">No accounts found matching query.</td></tr>';
      return;
    }

    tbody.innerHTML = cachedUsers.map(u => {
      const dateStr = u.created_at ? new Date(u.created_at).toLocaleDateString() : '—';
      return `
        <tr class="hover:bg-white/[0.02] transition">
          <td class="py-3 px-4">
            <div class="flex items-center gap-3">
              <img src="${escapeHtml(u.avatar)}" class="w-8 h-8 rounded-full object-cover border border-borderDark flex-shrink-0" alt="">
              <div class="truncate">
                <div class="font-bold text-white">${escapeHtml(u.name)}</div>
                <div class="text-[11px] text-slate-400 font-mono">${escapeHtml(u.handle)}</div>
              </div>
            </div>
          </td>
          <td class="py-3 px-4 text-slate-300 font-mono text-[11px]">${escapeHtml(u.email)}</td>
          <td class="py-3 px-4">
            <button onclick="toggleAdminRole('${u.id}', ${Boolean(u.is_admin)})" title="Click to toggle Admin status" class="text-[10px] font-bold px-2 py-0.5 rounded-full border transition ${
              u.is_admin 
                ? 'bg-brand-500/20 text-brand-400 border-brand-500/40 hover:bg-brand-500/30' 
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
            }">
              <i class="fa-solid ${u.is_admin ? 'fa-shield-halved' : 'fa-user'} mr-1"></i>
              ${u.is_admin ? 'Admin' : 'Reader'}
            </button>
          </td>
          <td class="py-3 px-4 text-center font-bold text-slate-200">${u.reviews_count || 0}</td>
          <td class="py-3 px-4 text-center font-bold text-slate-200">${u.comments_count || 0}</td>
          <td class="py-3 px-4 text-slate-400 text-[11px]">${dateStr}</td>
          <td class="py-3 px-4 text-right">
            <div class="flex items-center justify-end gap-1.5">
              <button onclick="openEditUserModal('${u.id}')" class="p-1.5 rounded-lg bg-cardDark hover:bg-borderDark text-slate-300 hover:text-white transition" title="Edit account">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button onclick="confirmDeleteUser('${u.id}', '${escapeHtml(u.username)}')" class="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition" title="Delete account">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    populateUserDropdown();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function populateUserDropdown() {
  const select = document.getElementById('postFormUserId');
  if (!select) return;
  select.innerHTML = cachedUsers.map(u => `
    <option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.handle)})</option>
  `).join('');
}

function openAddUserModal() {
  document.getElementById('userModalTitle').innerHTML = '<i class="fa-solid fa-user-plus text-brand-400"></i> Add New Account';
  document.getElementById('editUserId').value = '';
  document.getElementById('userFormName').value = '';
  document.getElementById('userFormUsername').value = '';
  document.getElementById('userFormEmail').value = '';
  document.getElementById('userFormPassword').value = '';
  document.getElementById('userFormPassword').required = true;
  document.getElementById('pwdLabelText').textContent = 'Password *';
  document.getElementById('pwdHint').textContent = '(required for new user)';
  document.getElementById('userFormBio').value = 'Avid reader and reviewer.';
  document.getElementById('userFormAvatar').value = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&auto=format&fit=crop&q=80';
  document.getElementById('userFormIsAdmin').checked = false;
  document.getElementById('userModal').classList.remove('hidden');
}

function openEditUserModal(userId) {
  const u = cachedUsers.find(item => item.id === userId);
  if (!u) return;

  document.getElementById('userModalTitle').innerHTML = '<i class="fa-solid fa-user-pen text-brand-400"></i> Edit Account';
  document.getElementById('editUserId').value = u.id;
  document.getElementById('userFormName').value = u.name || '';
  document.getElementById('userFormUsername').value = u.username || '';
  document.getElementById('userFormEmail').value = u.email || '';
  document.getElementById('userFormPassword').value = '';
  document.getElementById('userFormPassword').required = false;
  document.getElementById('pwdLabelText').textContent = 'New Password';
  document.getElementById('pwdHint').textContent = '(leave blank to keep current password)';
  document.getElementById('userFormBio').value = u.bio || '';
  document.getElementById('userFormAvatar').value = u.avatar || '';
  document.getElementById('userFormIsAdmin').checked = Boolean(u.is_admin);
  document.getElementById('userModal').classList.remove('hidden');
}

function closeUserModal() {
  document.getElementById('userModal').classList.add('hidden');
}

async function handleSaveUser(e) {
  e.preventDefault();
  const id = document.getElementById('editUserId').value;
  const name = document.getElementById('userFormName').value.trim();
  const username = document.getElementById('userFormUsername').value.trim();
  const email = document.getElementById('userFormEmail').value.trim();
  const password = document.getElementById('userFormPassword').value;
  const bio = document.getElementById('userFormBio').value.trim();
  const avatar = document.getElementById('userFormAvatar').value.trim();
  const isAdmin = document.getElementById('userFormIsAdmin').checked;

  const payload = { name, username, email, bio, avatar, isAdmin };
  if (password) payload.password = password;

  try {
    if (id) {
      await apiCall(`/api/admin/users/${id}`, 'PUT', payload);
      showToast('Account updated successfully!');
    } else {
      if (!password) throw new Error('Password is required for new accounts');
      payload.password = password;
      await apiCall('/api/admin/users', 'POST', payload);
      showToast('New user account created!');
    }
    closeUserModal();
    loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function toggleAdminRole(userId, currentStatus) {
  try {
    await apiCall(`/api/admin/users/${userId}`, 'PUT', { isAdmin: !currentStatus });
    showToast(`Role updated to ${!currentStatus ? 'Administrator' : 'Reader'}`);
    loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function confirmDeleteUser(userId, username) {
  openConfirmModal(
    'Delete User Account?',
    `Are you sure you want to delete @${username}? All their reviews, comments, and likes will be permanently erased.`,
    async () => {
      try {
        await apiCall(`/api/admin/users/${userId}`, 'DELETE');
        showToast(`Account @${username} was deleted.`);
        loadAdminUsers();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  );
}

// -------------------------------------------------------------------
// 7. POSTS & REVIEWS MANAGEMENT
// -------------------------------------------------------------------
function debouncePostSearch() {
  clearTimeout(postSearchTimer);
  postSearchTimer = setTimeout(() => {
    loadAdminReviews();
  }, 300);
}

async function loadAdminReviews() {
  const query = document.getElementById('postSearchInput').value.trim();
  const genre = document.getElementById('genreFilterSelect').value;
  let url = `/api/admin/reviews?genre=${encodeURIComponent(genre)}`;
  if (query) url += `&q=${encodeURIComponent(query)}`;

  const tbody = document.getElementById('postsTableBody');
  tbody.innerHTML = '<tr><td colspan="8" class="py-8 text-center text-slate-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading reviews...</td></tr>';

  try {
    const data = await apiCall(url);
    const reviews = data.reviews || [];
    document.getElementById('postsCountBadge').textContent = reviews.length;

    if (reviews.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="py-8 text-center text-slate-500">No posts or reviews found.</td></tr>';
      return;
    }

    tbody.innerHTML = reviews.map(r => {
      const dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString() : '—';
      return `
        <tr class="hover:bg-white/[0.02] transition">
          <td class="py-3 px-4">
            <div class="flex items-center gap-3">
              <img src="${escapeHtml(r.cover_url)}" class="w-10 h-14 object-cover rounded-md border border-borderDark flex-shrink-0 shadow" alt="">
              <div class="max-w-xs truncate">
                <div class="font-bold text-white truncate">${escapeHtml(r.book_title)}</div>
                <div class="text-[11px] text-slate-400 truncate">by ${escapeHtml(r.book_author)}</div>
              </div>
            </div>
          </td>
          <td class="py-3 px-4">
            <div class="flex items-center gap-2">
              <img src="${escapeHtml(r.author_avatar)}" class="w-6 h-6 rounded-full object-cover border border-slate-700" alt="">
              <span class="text-slate-300 font-medium">${escapeHtml(r.author_name)}</span>
            </div>
          </td>
          <td class="py-3 px-4">
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              ${escapeHtml(r.genre)}
            </span>
          </td>
          <td class="py-3 px-4 font-bold text-amber-400">★ ${r.rating}</td>
          <td class="py-3 px-4 text-center font-bold text-rose-400">♥ ${r.likes_count || 0}</td>
          <td class="py-3 px-4 text-center font-bold text-purple-400">💬 ${r.comments_count || 0}</td>
          <td class="py-3 px-4 text-slate-400 text-[11px]">${dateStr}</td>
          <td class="py-3 px-4 text-right">
            <div class="flex items-center justify-end gap-1.5">
              <button onclick="openEditPostModal('${r.id}')" class="p-1.5 rounded-lg bg-cardDark hover:bg-borderDark text-slate-300 hover:text-white transition" title="Edit review">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button onclick="confirmDeletePost('${r.id}', '${escapeHtml(r.book_title)}')" class="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition" title="Delete review">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    showToast(err.message, 'error');
  }
}

let cachedReviewsForEdit = [];

function openAddPostModal() {
  document.getElementById('postModalTitle').innerHTML = '<i class="fa-solid fa-plus text-brand-400"></i> Create New Post';
  document.getElementById('editPostId').value = '';
  document.getElementById('postFormTitle').value = '';
  document.getElementById('postFormAuthor').value = '';
  document.getElementById('postFormGenre').value = 'Fiction';
  document.getElementById('postFormRating').value = '5.0';
  document.getElementById('postFormText').value = '';
  document.getElementById('postFormQuote').value = '';
  document.getElementById('postFormCover').value = 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=360&auto=format&fit=crop&q=80';
  document.getElementById('postFormLink').value = '';
  populateUserDropdown();
  document.getElementById('postModal').classList.remove('hidden');
}

async function openEditPostModal(postId) {
  try {
    const res = await apiCall(`/api/reviews/${postId}`);
    const r = res.review;
    if (!r) throw new Error('Review not found');

    document.getElementById('postModalTitle').innerHTML = '<i class="fa-solid fa-pen-to-square text-brand-400"></i> Edit Post / Review';
    document.getElementById('editPostId').value = r.id;
    document.getElementById('postFormTitle').value = r.bookTitle || '';
    document.getElementById('postFormAuthor').value = r.bookAuthor || '';
    document.getElementById('postFormGenre').value = r.genre || 'Fiction';
    document.getElementById('postFormRating').value = r.rating || 5.0;
    document.getElementById('postFormText').value = r.reviewText || '';
    document.getElementById('postFormQuote').value = r.quote || '';
    document.getElementById('postFormCover').value = r.coverUrl || '';
    document.getElementById('postFormLink').value = r.bookLink || '';
    populateUserDropdown();
    if (r.author && r.author.id) {
      document.getElementById('postFormUserId').value = r.author.id;
    }
    document.getElementById('postModal').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function closePostModal() {
  document.getElementById('postModal').classList.add('hidden');
}

async function handleSavePost(e) {
  e.preventDefault();
  const id = document.getElementById('editPostId').value;
  const payload = {
    bookTitle: document.getElementById('postFormTitle').value.trim(),
    bookAuthor: document.getElementById('postFormAuthor').value.trim(),
    genre: document.getElementById('postFormGenre').value,
    rating: parseFloat(document.getElementById('postFormRating').value),
    userId: document.getElementById('postFormUserId').value,
    reviewText: document.getElementById('postFormText').value.trim(),
    quote: document.getElementById('postFormQuote').value.trim(),
    coverUrl: document.getElementById('postFormCover').value.trim(),
    bookLink: document.getElementById('postFormLink').value.trim()
  };

  try {
    if (id) {
      await apiCall(`/api/admin/reviews/${id}`, 'PUT', payload);
      showToast('Post updated successfully!');
    } else {
      await apiCall('/api/admin/reviews', 'POST', payload);
      showToast('New post published!');
    }
    closePostModal();
    loadAdminReviews();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function confirmDeletePost(postId, bookTitle) {
  openConfirmModal(
    'Delete Review Post?',
    `Are you sure you want to permanently delete the review for "${bookTitle}"? All associated comments and likes will also be removed.`,
    async () => {
      try {
        await apiCall(`/api/admin/reviews/${postId}`, 'DELETE');
        showToast(`Review for "${bookTitle}" deleted.`);
        loadAdminReviews();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  );
}

// -------------------------------------------------------------------
// 8. COMMENTS MANAGEMENT
// -------------------------------------------------------------------
function debounceCommentSearch() {
  clearTimeout(commentSearchTimer);
  commentSearchTimer = setTimeout(() => {
    loadAdminComments();
  }, 300);
}

async function loadAdminComments() {
  const query = document.getElementById('commentSearchInput').value.trim();
  const url = query ? `/api/admin/comments?q=${encodeURIComponent(query)}` : '/api/admin/comments';
  const tbody = document.getElementById('commentsTableBody');
  tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-slate-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading comments...</td></tr>';

  try {
    const data = await apiCall(url);
    const comments = data.comments || [];
    document.getElementById('commentsCountBadge').textContent = comments.length;

    if (comments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-slate-500">No comments found.</td></tr>';
      return;
    }

    tbody.innerHTML = comments.map(c => {
      const dateStr = c.created_at ? new Date(c.created_at).toLocaleDateString() : '—';
      return `
        <tr class="hover:bg-white/[0.02] transition">
          <td class="py-3 px-4">
            <div class="flex items-center gap-2.5">
              <img src="${escapeHtml(c.user_avatar)}" class="w-6 h-6 rounded-full object-cover border border-slate-700" alt="">
              <span class="font-bold text-white">${escapeHtml(c.user_name)}</span>
            </div>
          </td>
          <td class="py-3 px-4 text-slate-300 font-medium">${escapeHtml(c.book_title)}</td>
          <td class="py-3 px-4 text-slate-200 max-w-sm">${escapeHtml(c.text)}</td>
          <td class="py-3 px-4 text-slate-400 text-[11px]">${dateStr}</td>
          <td class="py-3 px-4 text-right">
            <div class="flex items-center justify-end gap-1.5">
              <button onclick="openEditCommentModal('${c.id}', '${encodeURIComponent(c.text)}')" class="p-1.5 rounded-lg bg-cardDark hover:bg-borderDark text-slate-300 hover:text-white transition" title="Edit comment">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button onclick="confirmDeleteComment('${c.id}')" class="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition" title="Delete comment">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openEditCommentModal(id, encodedText) {
  document.getElementById('editCommentId').value = id;
  document.getElementById('commentFormText').value = decodeURIComponent(encodedText);
  document.getElementById('commentModal').classList.remove('hidden');
}

function closeCommentModal() {
  document.getElementById('commentModal').classList.add('hidden');
}

async function handleSaveComment(e) {
  e.preventDefault();
  const id = document.getElementById('editCommentId').value;
  const text = document.getElementById('commentFormText').value.trim();

  try {
    await apiCall(`/api/admin/comments/${id}`, 'PUT', { text });
    showToast('Comment updated successfully!');
    closeCommentModal();
    loadAdminComments();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function confirmDeleteComment(commentId) {
  openConfirmModal(
    'Delete Comment?',
    'Are you sure you want to permanently delete this comment?',
    async () => {
      try {
        await apiCall(`/api/admin/comments/${commentId}`, 'DELETE');
        showToast('Comment deleted.');
        loadAdminComments();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  );
}

// -------------------------------------------------------------------
// 9. CONFIRMATION MODAL HELPER
// -------------------------------------------------------------------
let confirmActionCallback = null;

function openConfirmModal(title, desc, onConfirm) {
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalDesc').textContent = desc;
  confirmActionCallback = onConfirm;
  document.getElementById('confirmModal').classList.remove('hidden');

  const btn = document.getElementById('confirmModalActionBtn');
  btn.onclick = async () => {
    if (confirmActionCallback) await confirmActionCallback();
    closeConfirmModal();
  };
}

function closeConfirmModal() {
  document.getElementById('confirmModal').classList.add('hidden');
  confirmActionCallback = null;
}

// -------------------------------------------------------------------
// 10. INITIALIZATION
// -------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  checkExistingAuth();
});
