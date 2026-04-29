let state = {
  trips: {},
  currentTripCode: null,
  currentUserId: null,
  currentUserName: null,
  isAdmin: false,
  splitType: 'equal'
};

const LOCAL_STATE_KEY = 'tripvault_state';
const SESSION_KEY = 'tripvault_session';
let editingExpenseId = null;

const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other'];
const DEFAULT_PAYMENT_METHOD = 'Cash';

function applyRemoteState(appState) {
  const activeScreen = document.querySelector('.screen.active')?.id;
  const previousTripCode = state.currentTripCode;
  const previousUserId = state.currentUserId;

  applyPersistedTripState(appState);
  loadSession();
  try { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(getPersistableState())); } catch (e) {}

  const trip = state.currentTripCode ? state.trips[state.currentTripCode] : null;
  const memberExists = trip?.members?.[state.currentUserId];

  if (trip && memberExists) {
    renderApp();
    if (activeScreen === 'landing' || activeScreen === 'create-trip' || activeScreen === 'join-trip') {
      showScreen('main');
    }
    return;
  }

  if (previousTripCode && previousUserId) clearCurrentSession();
  if (activeScreen === 'main') showScreen('landing');
}

function generateCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function getPrimaryTripCode(trips = state.trips) {
  return Object.keys(trips || {})[0] || null;
}

function getPersistableState() {
  return {
    trips: state.trips || {},
    currentTripCode: state.currentTripCode || null,
    currentUserId: null,
    currentUserName: null,
    isAdmin: false,
    splitType: 'equal'
  };
}

function applyPersistedTripState(savedState) {
  state.trips = savedState?.trips || {};
  const tripCode = savedState?.currentTripCode && state.trips[savedState.currentTripCode]
    ? savedState.currentTripCode
    : getPrimaryTripCode(state.trips);

  state.currentTripCode = null;
  state.currentUserId = null;
  state.currentUserName = null;
  state.isAdmin = false;
  state.splitType = 'equal';
}

function saveSession() {
  try {
    if (!state.currentTripCode || !state.currentUserId) {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    const session = JSON.stringify({
      tripCode: state.currentTripCode,
      userId: state.currentUserId,
      userName: state.currentUserName
    });
    sessionStorage.setItem(SESSION_KEY, session);
    localStorage.setItem(SESSION_KEY, session);
  } catch (e) {}
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const session = JSON.parse(raw);
    const trip = state.trips?.[session.tripCode];
    const member = trip?.members?.[session.userId];
    if (!trip || !member) {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    state.currentTripCode = session.tripCode;
    state.currentUserId = member.id;
    state.currentUserName = member.name;
    state.isAdmin = member.id === trip.adminId;
    saveSession();
  } catch (e) {}
}

function saveState() {
  saveSession();
  const tripCode = getPrimaryTripCode();
  if (!tripCode) return;
  const payload = {
    id: tripCode,
    app_state: getPersistableState(),
    updated_at: new Date().toISOString()
  };
  try { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(payload.app_state)); } catch (e) {}
  window.TripVaultRemoteStorage?.queueSave?.(payload);
}

async function loadState(requestedCode) {
  try {
    const s = localStorage.getItem(LOCAL_STATE_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      applyPersistedTripState(parsed);
      loadSession();
    }
  } catch (e) {}

  const codeToLoad = requestedCode || state.currentTripCode;
  if (!codeToLoad) return;

  const remote = await window.TripVaultRemoteStorage?.load?.(codeToLoad);
  if (remote?.appState) {
    applyPersistedTripState(remote.appState);
    loadSession();
    try { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(getPersistableState())); } catch (e) {}
    if (remote.source === 'firebase') showToast('Loaded Firebase backup.');
    return;
  }
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function fmt(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function getPaymentMethod(value) {
  return PAYMENT_METHODS.includes(value) ? value : DEFAULT_PAYMENT_METHOD;
}

function getMemberName(trip, memberId) {
  return trip?.members?.[memberId]?.name || '';
}

function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').substr(0, 2).toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, ' ');
}

function toDatetimeLocalValue(ts = Date.now()) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function parseDatetimeLocalValue(value) {
  const ts = value ? new Date(value).getTime() : Date.now();
  return Number.isFinite(ts) ? ts : Date.now();
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
  else bytes.forEach((_, i) => bytes[i] = Math.floor(Math.random() * 256));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const text = `${salt}:${password}`;
  if (window.crypto?.subtle && window.TextEncoder) {
    const data = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }

  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

async function createPasswordRecord(password) {
  const salt = randomSalt();
  return { salt, hash: await hashPassword(password, salt) };
}

function getPasswordRecord(entity) {
  if (entity?.password?.salt && entity?.password?.hash) return entity.password;
  if (entity?.passwordSalt && entity?.passwordHash) {
    return { salt: entity.passwordSalt, hash: entity.passwordHash };
  }
  return null;
}

async function verifyPassword(entity, password) {
  const record = getPasswordRecord(entity);
  if (!record) return true;
  return (await hashPassword(password, record.salt)) === record.hash;
}

function passwordLooksOk(password, label) {
  if (!password || password.length < 4) {
    showToast(`${label} must be at least 4 characters.`);
    return false;
  }
  return true;
}

/* â”€â”€ CREATE TRIP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function createTrip() {
  const adminName = normalizeName(document.getElementById('admin-name').value);
  const adminPassword = document.getElementById('admin-password').value;
  const tripName  = document.getElementById('trip-name-input').value.trim();
  const tripPassword = document.getElementById('trip-password-create').value;
  if (!adminName || !tripName || !adminPassword || !tripPassword) { showToast('Fill all fields!'); return; }
  if (!passwordLooksOk(adminPassword, 'Your password') || !passwordLooksOk(tripPassword, 'Trip password')) return;

  let code = generateCode();
  while (state.trips[code]) code = generateCode();
  const userId = generateId();
  const adminPasswordRecord = await createPasswordRecord(adminPassword);
  const tripPasswordRecord = await createPasswordRecord(tripPassword);
  const trip   = {
    code, name: tripName,
    initialPool: 0, currentPool: 0,
    password: tripPasswordRecord,
    adminId: userId,
    members: { [userId]: { id: userId, name: adminName, password: adminPasswordRecord, contribution: 0, joinedAt: Date.now() } },
    expenses: [], transactions: [], settlements: []
  };
  trip.transactions.push({
    id: generateId(), type: 'join',
    desc: adminName + ' created trip',
    amount: 0, userId, timestamp: Date.now()
  });

  state.trips = { [code]: trip };
  state.currentTripCode = code;
  state.currentUserId  = userId;
  state.currentUserName = adminName;
  state.isAdmin        = true;
  saveState();
  window.TripVaultRemoteStorage?.subscribe?.(code, applyRemoteState);
  renderApp();
  showScreen('main');
}

/* â”€â”€ JOIN TRIP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function joinTrip() {
  const memberName = normalizeName(document.getElementById('member-name').value);
  const memberPassword = document.getElementById('member-password').value;
  const code       = document.getElementById('join-code-input').value.trim().toUpperCase();
  const tripPassword = document.getElementById('trip-password-join').value;
  if (!memberName || !memberPassword || !code) { showToast('Fill all fields!'); return; }
  if (!passwordLooksOk(memberPassword, 'Your password')) return;

  const btn = document.querySelector('#join-trip .btn');
  const oldText = btn.textContent;
  btn.textContent = 'Joining...';
  btn.disabled = true;
  await loadState(code);
  btn.textContent = oldText;
  btn.disabled = false;

  const trip = state.trips[code];
  if (!trip) { showToast('Invalid code!'); return; }
  if (getPasswordRecord(trip)) {
    if (!tripPassword) { showToast('Enter the trip password!'); return; }
    if (!(await verifyPassword(trip, tripPassword))) { showToast('Wrong trip password!'); return; }
  }

  // Re-join existing member
  const existing = Object.values(trip.members).find(m => m.name.toLowerCase() === memberName.toLowerCase());
  if (existing) {
    if (getPasswordRecord(existing)) {
      if (!(await verifyPassword(existing, memberPassword))) { showToast('Wrong member password!'); return; }
    } else {
      existing.password = await createPasswordRecord(memberPassword);
    }
    state.currentTripCode = code;
    state.currentUserId   = existing.id;
    state.currentUserName = existing.name;
    state.isAdmin         = existing.id === trip.adminId;
    saveState(); window.TripVaultRemoteStorage?.subscribe?.(code, applyRemoteState); renderApp(); showScreen('main');
    showToast('Welcome back, ' + memberName + '!');
    return;
  }

  const userId = generateId();
  trip.members[userId] = {
    id: userId,
    name: memberName,
    password: await createPasswordRecord(memberPassword),
    contribution: 0,
    joinedAt: Date.now()
  };
  trip.transactions.push({
    id: generateId(), type: 'join',
    desc: memberName + ' joined the trip',
    amount: 0, userId, timestamp: Date.now()
  });

  state.currentTripCode = code;
  state.currentUserId   = userId;
  state.currentUserName = memberName;
  state.isAdmin         = false;
  saveState(); window.TripVaultRemoteStorage?.subscribe?.(code, applyRemoteState); renderApp(); showScreen('main');
  showToast('Joined ' + trip.name + '!');
}

function getTrip() { return state.trips[state.currentTripCode]; }

function isPoolExpense(trip, expense) {
  // If paidBy is any member (including admin), they paid it directly.
  // Pool expenses are no longer technically supported as a separate entity, 
  // but legacy expenses where paidBy === adminId will still be treated normally as paid by the admin.
  // For the sake of remaining features, we'll keep checking if the payer is the admin for legacy behavior? No.
  // The prompt asks to remove "Central Pool" payments and make it purely member payments deducted from their respective contributed pools.
  return false; // all expenses are now member-paid
}

function calcPoolContributionUsage(trip = getTrip()) {
  const used = {};
  Object.keys(trip.members || {}).forEach(id => used[id] = 0);

  // According to the new logic, EVERY expense split reduces from the participant's pool,
  // regardless of who paid it. The payer is owed the total sum (minus their split),
  // but let's keep all splits as 'pool deduction'.
  (trip.expenses || []).forEach(e => {
    Object.entries(e.splits || {}).forEach(([uid, amt]) => {
      used[uid] = (used[uid] || 0) + amt;
    });
  });

  return used;
}

function renderApp() {
  const trip = getTrip();
  if (!trip) return;

  document.getElementById('header-trip-name').textContent = trip.name;
  document.getElementById('role-badge').textContent = state.isAdmin ? '👑 Admin' : '👤 Member';
  const codeBtn = document.getElementById('code-btn');
  codeBtn.style.display = state.isAdmin ? 'block' : 'none';
  const addExpenseBtn = document.getElementById('add-expense-btn');
  if (addExpenseBtn) addExpenseBtn.style.display = state.isAdmin ? 'flex' : 'none';

  const totalContrib = Object.values(trip.members).reduce((s, m) => s + m.contribution, 0);
  const totalSpent   = trip.expenses.reduce((s, e) => s + e.amount, 0);
  const myMember = trip.members[state.currentUserId];
  const myPoolUsed = myMember ? (calcPoolContributionUsage(trip)[myMember.id] || 0) : 0;
  const myPoolLeft = myMember ? Math.max(0, (myMember.contribution || 0) - myPoolUsed) : 0;
  document.getElementById('pool-display').textContent  = fmt(trip.currentPool);
  document.getElementById('pool-spent').textContent    = fmt(totalSpent);
  document.getElementById('pool-total-main').textContent = fmt(totalContrib);
  document.getElementById('pool-my-left-main').textContent = fmt(myPoolLeft);
  document.getElementById('pool-my-total').textContent = fmt(myMember?.contribution || 0);
  document.getElementById('pool-members').textContent  = Object.keys(trip.members).length;

  const pct = totalContrib > 0 ? Math.max(0, (trip.currentPool / totalContrib) * 100) : 100;
  document.getElementById('pool-bar').style.width = pct + '%';

  renderExpenses();
  renderHistory();
  renderMembers();
  renderSettlements();
  renderTxns();
}


function renderExpenses() {
  const trip = getTrip();
  const el   = document.getElementById('expenses-list');
  if (!trip.expenses.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🧾</div><p>No expenses yet.<br>Tap + Add Expense to get started.</p></div>';
    return;
  }
  el.innerHTML = [...trip.expenses].reverse().map(e => {
    const payer  = trip.members[e.paidBy];
    const splits = Object.entries(e.splits).map(([uid, amt]) => {
      const m = trip.members[uid];
      return `<div class="split-row"><span>${escapeHtml(m ? m.name : uid)}</span><span>${fmt(amt)}</span></div>`;
    }).join('');
    return `<div class="expense-card">
      <div class="expense-header">
        <div class="expense-desc">${escapeHtml(e.category)} ${escapeHtml(e.desc)}</div>
        <div class="expense-actions">
          <div class="expense-amount">${fmt(e.amount)}</div>
          ${state.isAdmin ? `<details class="expense-menu">
            <summary aria-label="Expense actions">...</summary>
            <div class="expense-menu-list">
              <button onclick="openExpenseModal('${e.id}')">Edit</button>
              <button class="danger" onclick="deleteExpense('${e.id}')">Delete</button>
            </div>
          </details>` : ''}
        </div>
      </div>
      <div class="expense-meta">
        <div class="expense-tag">${escapeHtml(e.splitLabel)}</div>
        <div class="expense-tag">${escapeHtml(e.paymentMethod || DEFAULT_PAYMENT_METHOD)}</div>
        <div class="expense-paid-by">Paid by ${escapeHtml(payer ? payer.name : '?')}</div>
        <div class="expense-paid-by" style="color:var(--text3)">${new Date(e.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
      </div>
      <div class="expense-splits">${splits}</div>
    </div>`;
  }).join('');
}

function renderHistory() {
  const trip = getTrip();
  const el = document.getElementById('history-list');
  if (!trip.expenses.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🕒</div><p>No history available.</p></div>';
    return;
  }
  
  let rows = [...trip.expenses].reverse().map(e => {
    const payer = trip.members[e.paidBy];
    const splitsCount = Object.keys(e.splits).length;
    const splitType = (e.splitLabel || '').toLowerCase().includes('equal') ? 'Equally' : 'Unequally';
    const d = new Date(e.timestamp);
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    
    return `<tr>
      <td style="white-space:nowrap">${dateStr}</td>
      <td style="white-space:nowrap">${timeStr}</td>
      <td>${escapeHtml(e.category)} ${escapeHtml(e.desc)}</td>
      <td style="font-family:var(--font);font-weight:500">${fmt(e.amount)}</td>
      <td>${escapeHtml(payer ? payer.name : '?')}</td>
      <td><span class="history-badge">${splitType}</span></td>
      <td style="text-align:center">${splitsCount}</td>
    </tr>`;
  }).join('');
  
  el.innerHTML = `
    <table class="history-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Time</th>
          <th>Expense</th>
          <th>Amount</th>
          <th>Paid By</th>
          <th>Split Type</th>
          <th style="text-align:center">Splits</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}


function renderMembers() {
  const trip     = getTrip();
  const poolUsed = calcPoolContributionUsage(trip);
  const el       = document.getElementById('members-list');
  el.innerHTML = Object.values(trip.members).map(m => {
    const isMe   = m.id === state.currentUserId;
    const isAdm  = m.id === trip.adminId;
    return `<div class="member-card">
      <div class="member-avatar">${escapeHtml(initials(m.name))}</div>
      <div class="member-info">
        <div class="member-name">
          ${escapeHtml(m.name)}
          ${isAdm ? '<span class="member-name-badge">Admin</span>' : ''}
          ${isMe  ? '<span class="member-name-badge" style="color:var(--blue)">You</span>' : ''}
        </div>
      </div>
      ${state.isAdmin && !isAdm ? `<button class="icon-text-btn danger" onclick="removeMember('${m.id}')">Remove</button>` : ''}
    </div>`;
  }).join('');

  const myMember = trip.members[state.currentUserId];
  const myPoolSec = document.getElementById('my-pool-section');
  if (myMember) {
    const myUsed = poolUsed[myMember.id] || 0;
    const myRemaining = (myMember.contribution || 0) - myUsed;
    myPoolSec.style.display = 'block';
    const remainingEl = document.getElementById('my-pool-remaining');
    if (myRemaining >= 0) {
      remainingEl.textContent = `${fmt(myRemaining)} left of ${fmt(myMember.contribution || 0)} (${fmt(myUsed)} used)`;
      remainingEl.style.color = '';
    } else {
      remainingEl.textContent = `Overused by ${fmt(-myRemaining)}. (Contrib: ${fmt(myMember.contribution || 0)}, Used: ${fmt(myUsed)})`;
      remainingEl.style.color = 'var(--red)';
    }
  } else {
    myPoolSec.style.display = 'none';
  }

  const adminSec = document.getElementById('admin-pool-section');
  if (state.isAdmin) {
    adminSec.style.display = 'block';
    document.getElementById('inline-code').textContent = trip.code;
    document.getElementById('add-pool-member').innerHTML = Object.values(trip.members)
      .map(m => `<option value="${m.id}" ${m.id === state.currentUserId ? 'selected' : ''}>${escapeHtml(m.name)}${m.id === trip.adminId ? ' (Admin)' : ''}</option>`)
      .join('');
    const poolDateEl = document.getElementById('add-pool-datetime');
    if (poolDateEl && !poolDateEl.value) poolDateEl.value = toDatetimeLocalValue();
  } else {
    adminSec.style.display = 'none';
  }

  const leaveSec = document.getElementById('leave-trip-section');
  leaveSec.style.display = state.isAdmin ? 'none' : 'block';
}

/* â”€â”€ BALANCE CALCULATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function calcBalances() {
  const trip = getTrip();
  const bal  = {};
  Object.keys(trip.members).forEach(id => bal[id] = 0);

  // 1. Account for Pool Contributions
  // When a member contributes, they are owed that money by the Admin (who holds the pool).
  Object.values(trip.members).forEach(m => {
    if ((m.contribution || 0) > 0) {
      bal[m.id] = money((bal[m.id] || 0) + m.contribution);
      bal[trip.adminId] = money((bal[trip.adminId] || 0) - m.contribution);
    }
  });

  // 2. Account for Expenses
  trip.expenses.forEach(e => {
    if (isPoolExpense(trip, e)) return;
    bal[e.paidBy] = money((bal[e.paidBy] || 0) + e.amount);
    Object.entries(e.splits).forEach(([uid, amt]) => {
      bal[uid] = money((bal[uid] || 0) - amt);
    });
  });

  // 3. Account for Settlements
  trip.settlements.filter(s => (s.status || 'confirmed') === 'confirmed').forEach(s => {
    bal[s.from] = money((bal[s.from] || 0) + s.amount);
    bal[s.to]   = money((bal[s.to]   || 0) - s.amount);
  });

  return bal;
}

function memberHasActivity(trip, memberId) {
  const member = trip.members[memberId];
  if (!member) return false;
  if ((member.contribution || 0) > 0) return true;
  return (trip.expenses || []).some(e => e.paidBy === memberId || Object.prototype.hasOwnProperty.call(e.splits || {}, memberId)) ||
    (trip.settlements || []).some(s => s.from === memberId || s.to === memberId);
}

function clearCurrentSession() {
  state.currentTripCode = null;
  state.currentUserId = null;
  state.currentUserName = null;
  state.isAdmin = false;
  window.TripVaultRemoteStorage?.subscribe?.(null, null);
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}

function deleteExpense(expenseId) {
  if (!state.isAdmin) { showToast('Only admin can delete expenses!'); return; }
  const trip = getTrip();
  const idx = trip.expenses.findIndex(e => e.id === expenseId);
  if (idx < 0) return;

  const expense = trip.expenses[idx];
  if (isPoolExpense(trip, expense)) trip.currentPool = money(trip.currentPool + (expense.amount || 0));
  trip.expenses.splice(idx, 1);
  trip.transactions.push({
    id: generateId(), type: 'expense',
    desc: 'Admin deleted expense: ' + expense.desc,
    amount: expense.amount || 0, userId: state.currentUserId, timestamp: Date.now()
  });
  saveState(); renderApp();
  showToast('Expense deleted!');
}

function removeMember(memberId) {
  if (!state.isAdmin) { showToast('Only admin can remove members!'); return; }
  const trip = getTrip();
  const member = trip.members[memberId];
  if (!member) return;
  if (memberId === trip.adminId) { showToast('Admin cannot be removed.'); return; }
  if (memberHasActivity(trip, memberId)) {
    showToast('Clear this member activity first.');
    return;
  }

  delete trip.members[memberId];
  trip.transactions.push({
    id: generateId(), type: 'settlement',
    desc: member.name + ' was removed by admin',
    amount: 0, userId: state.currentUserId, timestamp: Date.now()
  });
  saveState(); renderApp();
  showToast(member.name + ' removed!');
}

function leaveTrip() {
  const trip = getTrip();
  const memberId = state.currentUserId;
  const member = trip?.members?.[memberId];
  if (!trip || !member) return;
  if (state.isAdmin) { showToast('Admin cannot leave the trip.'); return; }
  if (memberHasActivity(trip, memberId)) {
    showToast('Ask admin to clear your activity first.');
    return;
  }

  delete trip.members[memberId];
  trip.transactions.push({
    id: generateId(), type: 'settlement',
    desc: member.name + ' left the trip',
    amount: 0, userId: memberId, timestamp: Date.now()
  });
  saveState();
  clearCurrentSession();
  showScreen('landing');
  showToast('You left the trip.');
}

/* â”€â”€ SETTLEMENT CALCULATION (min transactions) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function calcSettlements() {
  const balances  = calcBalances();
  const debtors   = [], creditors = [];
  const trip = getTrip();

  Object.entries(balances).forEach(([id, b]) => {
    if (b < -0.01) debtors.push({ id, amt: -b });
    else if (b > 0.01) creditors.push({ id, amt: b });
  });

  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);

  const txns = [];
  let d = 0, c = 0;
  while (d < debtors.length && c < creditors.length) {
    const pay = Math.min(debtors[d].amt, creditors[c].amt);
    if (pay > 0.01) txns.push({ from: debtors[d].id, to: creditors[c].id, amount: money(pay) });
    debtors[d].amt -= pay; creditors[c].amt -= pay;
    if (debtors[d].amt < 0.01) d++;
    if (creditors[c].amt < 0.01) c++;
  }
  return txns.filter(s => !hasOpenSettlement(trip, s.from, s.to));
}

function hasOpenSettlement(trip, fromId, toId) {
  return (trip.settlements || []).some(s =>
    s.from === fromId &&
    s.to === toId &&
    (s.status || 'confirmed') === 'pending_confirmation'
  );
}

function renderSettlements() {
  const trip    = getTrip();
  const pending = calcSettlements();
  const el      = document.getElementById('settlements-list');
  const mine    = pending.filter(s => s.from === state.currentUserId || s.to === state.currentUserId);
  const openConfirmations = (trip.settlements || []).filter(s =>
    (s.status || 'confirmed') === 'pending_confirmation' &&
    (s.from === state.currentUserId || s.to === state.currentUserId || state.isAdmin)
  );

  if (!mine.length && !openConfirmations.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><p>You are settled up!<br>No payments for you.</p></div>';
    return;
  }

  const renderItem = (s) => {
    const from = trip.members[s.from], to = trip.members[s.to];
    const iPay = s.from === state.currentUserId;
    const otherMember = iPay ? to : from;
    const methodId = `settle-method-${s.from}-${s.to}`;
    const methodOptions = PAYMENT_METHODS.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    return `<div class="settlement-item">
      <div class="settlement-names">
        <div class="settlement-from">${iPay ? 'You have to give' : 'You have to take'}</div>
        <div class="settlement-to">${iPay ? 'to' : 'from'} ${escapeHtml(otherMember ? otherMember.name : '?')}</div>
      </div>
      <div class="settlement-amt ${iPay ? 'pay' : 'receive'}">${fmt(s.amount)}</div>
      ${iPay ? `<div class="settlement-pay-controls">
        <select class="settlement-method" id="${methodId}">${methodOptions}</select>
        <button class="settle-btn" onclick="markSettlementPaid('${s.from}','${s.to}',${s.amount}, document.getElementById('${methodId}').value)">Paid</button>
      </div>` : ''}
    </div>`;
  };

  const renderConfirmation = (s) => {
    const iReceive = s.to === state.currentUserId;
    const canConfirm = iReceive || state.isAdmin;
    const fromName = getMemberName(trip, s.from);
    const toName = getMemberName(trip, s.to);
    return `<div class="settlement-item">
      <div class="settlement-names">
        <div class="settlement-from">${escapeHtml(fromName)} marked paid</div>
        <div class="settlement-to">to ${escapeHtml(toName)} by ${escapeHtml(s.paymentMethod || DEFAULT_PAYMENT_METHOD)} at ${escapeHtml(formatDateTime(s.paidAt || s.timestamp))}</div>
      </div>
      <div class="settlement-amt receive">${fmt(s.amount)}</div>
      ${canConfirm ? `<button class="settle-btn" onclick="confirmSettlementReceived('${s.id}')">Received</button>` : '<span class="tx-meta">Awaiting receiver</span>'}
    </div>`;
  };

  el.innerHTML = `${openConfirmations.length ? `<div class="section-title">Awaiting Confirmation</div>
    <div class="settlement-card">${openConfirmations.map(renderConfirmation).join('')}</div>` : ''}
    ${mine.length ? `<div class="section-title">Your Settlements</div>
    <div class="settlement-card">${mine.map(renderItem).join('')}</div>` : ''}`;
}

function markSettlementPaid(fromId, toId, amount, paymentMethod = DEFAULT_PAYMENT_METHOD) {
  const trip     = getTrip();
  if (state.currentUserId !== fromId && !state.isAdmin) {
    showToast('Only the payer can mark this paid.');
    return;
  }
  if (hasOpenSettlement(trip, fromId, toId)) {
    showToast('This payment is already waiting for confirmation.');
    return;
  }
  const fromName = trip.members[fromId]?.name;
  const toName   = trip.members[toId]?.name;
  const method = getPaymentMethod(paymentMethod);
  const now = Date.now();
  trip.settlements.push({
    id: generateId(), from: fromId, to: toId, amount: money(amount),
    paymentMethod: method, status: 'pending_confirmation',
    recordedBy: state.currentUserId, paidAt: now, timestamp: now
  });
  trip.transactions.push({
    id: generateId(), type: 'settlement',
    desc: fromName + ' marked payment to ' + toName + ' as paid; awaiting receiver confirmation',
    amount: money(amount), paymentMethod: method, userId: state.currentUserId, timestamp: now
  });
  saveState(); renderApp();
  showToast('Awaiting receiver confirmation.');
}

function confirmSettlementReceived(settlementId) {
  const trip = getTrip();
  const settlement = (trip.settlements || []).find(s => s.id === settlementId);
  if (!settlement) return;
  if (settlement.to !== state.currentUserId && !state.isAdmin) {
    showToast('Only the receiver can confirm this.');
    return;
  }
  if ((settlement.status || 'confirmed') === 'confirmed') {
    showToast('Already confirmed.');
    return;
  }
  const now = Date.now();
  settlement.status = 'confirmed';
  settlement.confirmedBy = state.currentUserId;
  settlement.confirmedAt = now;
  trip.transactions.push({
    id: generateId(), type: 'settlement',
    desc: getMemberName(trip, settlement.to) + ' confirmed receipt from ' + getMemberName(trip, settlement.from),
    amount: money(settlement.amount), paymentMethod: settlement.paymentMethod,
    userId: state.currentUserId, timestamp: now
  });
  saveState(); renderApp();
  showToast('Receipt confirmed!');
}

/* â”€â”€ TRANSACTIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderTxns() {
  const trip = getTrip();
  const el   = document.getElementById('txns-list');
  if (!trip.transactions.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p>No transactions yet.</p></div>';
    return;
  }
  el.innerHTML = [...trip.transactions].reverse().map(t => {
    const displayType = t.type === 'join' && (t.amount || 0) > 0 ? 'pool' : t.type;
    const amtCls   = t.type === 'settlement' ? 'settlement' : (t.type === 'expense' ? 'debit' : 'credit');
    const badgeCls = displayType === 'join' ? 'join' : (displayType === 'settlement' ? 'settlement' : (displayType === 'pool' ? 'pool' : 'expense'));
    const prefix   = t.type === 'expense' ? '-' : '';
    const showAmount = displayType !== 'join';
    return `<div class="tx-card">
      <div class="tx-header">
        <div>
          <div class="tx-desc">${escapeHtml(t.desc)}</div>
          <div class="tx-meta">${new Date(t.timestamp).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <div style="text-align:right">
          ${showAmount ? `<div class="tx-amount ${amtCls}">${prefix}${fmt(t.amount)}</div>` : ''}
          <div style="margin-top:4px"><span class="tx-type-badge ${badgeCls}">${displayType}</span></div>
          ${t.paymentMethod ? `<div class="tx-meta">${escapeHtml(t.paymentMethod)}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

/* â”€â”€ TABS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function switchTab(tab) {
  const order = ['expenses', 'history', 'settle', 'txns', 'members'];
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', order[i] === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
}

/* â”€â”€ EXPENSE MODAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function inferSplitType(expense) {
  const label = (expense?.splitLabel || '').toLowerCase();
  if (label.includes('custom')) return 'unequal';
  return 'equal';
}

function resetExpenseForm() {
  document.getElementById('exp-desc').value = '';
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-category').selectedIndex = 0;
  document.getElementById('exp-payment-method').value = DEFAULT_PAYMENT_METHOD;
  document.getElementById('split-total-display').innerHTML = '';
}

function setExpenseModalMode(expenseId) {
  editingExpenseId = expenseId || null;
  document.getElementById('expense-modal-title').textContent = editingExpenseId ? 'Edit Expense' : 'Add Expense';
  document.getElementById('expense-submit-btn').textContent = editingExpenseId ? 'Save Changes' : 'Add Expense';
}

function openExpenseModal(expenseId = null) {
  if (!state.isAdmin) { showToast('Only admin can add or edit expenses!'); return; }
  const trip = getTrip();
  const expense = expenseId ? trip.expenses.find(e => e.id === expenseId) : null;
  if (expenseId && (!state.isAdmin || !expense)) return;

  setExpenseModalMode(expenseId);
  if (!expense) resetExpenseForm();

  const paidByEl = document.getElementById('exp-paid-by');
  paidByEl.innerHTML = Object.values(trip.members)
    .map(m => {
      const label = m.name;
      return `<option value="${m.id}" ${m.id === (expense?.paidBy || state.currentUserId) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');

  if (expense) {
    document.getElementById('exp-desc').value = expense.desc;
    document.getElementById('exp-amount').value = expense.amount;
    const categoryEl = document.getElementById('exp-category');
    const categoryIndex = [...categoryEl.options].findIndex(o => o.textContent.startsWith(expense.category));
    categoryEl.selectedIndex = categoryIndex >= 0 ? categoryIndex : categoryEl.options.length - 1;
    document.getElementById('exp-payment-method').value = getPaymentMethod(expense.paymentMethod);
  }

  state.splitType = expense ? inferSplitType(expense) : 'equal';
  document.querySelectorAll('.split-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.toLowerCase().startsWith(state.splitType.substr(0, 3)));
  });
  buildSplitList();
  if (expense) fillSplitInputs(expense);
  document.getElementById('expense-modal').classList.add('open');
}

function closeExpenseModal(e) {
  if (e.target === document.getElementById('expense-modal')) {
    document.getElementById('expense-modal').classList.remove('open');
    setExpenseModalMode(null);
  }
}

function setSplitType(type) {
  state.splitType = type;
  document.querySelectorAll('.split-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.toLowerCase().startsWith(type.substr(0, 3)));
  });
  buildSplitList();
  updateSplitAmounts();
}

function buildSplitList() {
  const trip    = getTrip();
  const members = Object.values(trip.members);
  const container = document.getElementById('split-members-list');

  if (state.splitType === 'equal') {
    container.innerHTML = members.map(m => `
      <div class="member-split-row">
        <input type="checkbox" class="member-checkbox" id="chk-${m.id}" value="${m.id}" checked onchange="updateSplitAmounts()" />
        <label class="member-split-name" for="chk-${m.id}">${escapeHtml(m.name)}${m.id === state.currentUserId ? ' (You)' : ''}</label>
        <div class="member-split-pct" id="split-display-${m.id}"></div>
      </div>`).join('');
  } else if (state.splitType === 'unequal') {
    container.innerHTML = members.map(m => `
      <div class="member-split-row">
        <span class="member-split-name">${escapeHtml(m.name)}${m.id === state.currentUserId ? ' (You)' : ''}</span>
        <input type="number" class="member-split-input" id="split-inp-${m.id}" value="0" placeholder="0" oninput="updateSplitTotal()" />
      </div>`).join('');
  }
  updateSplitAmounts();
}

function fillSplitInputs(expense) {
  const members = Object.values(getTrip().members);
  if (state.splitType === 'equal') {
    members.forEach(m => {
      const el = document.getElementById('chk-' + m.id);
      if (el) el.checked = Object.prototype.hasOwnProperty.call(expense.splits || {}, m.id);
    });
    updateSplitAmounts();
    return;
  }

  members.forEach(m => {
    const el = document.getElementById('split-inp-' + m.id);
    if (!el) return;
    el.value = expense.splits?.[m.id] || 0;
  });
  updateSplitTotal();
}

function updateSplitAmounts() {
  const trip    = getTrip();
  const members = Object.values(trip.members);
  const amt     = parseFloat(document.getElementById('exp-amount').value) || 0;

  if (state.splitType === 'equal') {
    const checked = members.filter(m => document.getElementById('chk-' + m.id)?.checked);
    const share   = checked.length > 0 ? amt / checked.length : 0;
    members.forEach(m => {
      const el = document.getElementById('split-display-' + m.id);
      if (el) el.textContent = document.getElementById('chk-' + m.id)?.checked ? fmt(share) : '-';
    });
    document.getElementById('split-total-display').innerHTML = '';
  } else {
    updateSplitTotal();
  }
}

function updateSplitTotal() {
  const trip    = getTrip();
  const members = Object.values(trip.members);
  const amt     = parseFloat(document.getElementById('exp-amount').value) || 0;
  const totalEl = document.getElementById('split-total-display');

  if (state.splitType === 'unequal') {
    const total = members.reduce((s, m) => s + (parseFloat(document.getElementById('split-inp-' + m.id)?.value) || 0), 0);
    const ok    = Math.abs(total - amt) < 0.01;
    totalEl.className = 'split-total-row ' + (ok ? 'ok' : 'error');
    totalEl.innerHTML = `<span>Total Split</span><span>${fmt(total)} / ${fmt(amt)}</span>`;
  }
}

function collectExpenseForm() {
  const trip   = getTrip();
  const desc   = document.getElementById('exp-desc').value.trim();
  const amount = parseFloat(document.getElementById('exp-amount').value);
  const paidBy = document.getElementById('exp-paid-by').value;
  const category = document.getElementById('exp-category').value.split(' ')[0];
  const paymentMethod = getPaymentMethod(document.getElementById('exp-payment-method').value);

  if (!desc || !amount || amount <= 0) { showToast('Fill description & amount!'); return null; }

  const members = Object.values(trip.members);
  let splits = {};

  if (state.splitType === 'equal') {
    const checked = members.filter(m => document.getElementById('chk-' + m.id)?.checked);
    if (!checked.length) { showToast('Select at least one member!'); return; }
    const share = money(amount / checked.length);
    checked.forEach(m => splits[m.id] = share);
    const roundedTotal = Object.values(splits).reduce((s, v) => money(s + v), 0);
    const remainder = money(amount - roundedTotal);
    if (Math.abs(remainder) > 0 && checked[0]) splits[checked[0].id] = money(splits[checked[0].id] + remainder);
  } else if (state.splitType === 'unequal') {
    members.forEach(m => {
      const v = parseFloat(document.getElementById('split-inp-' + m.id)?.value) || 0;
      if (v > 0) splits[m.id] = money(v);
    });
    const total = Object.values(splits).reduce((s, v) => s + v, 0);
    if (Math.abs(total - amount) > 0.01) { showToast('Split amounts must equal total!'); return; }
  }

  if (!Object.keys(splits).length) { showToast('No members in split!'); return; }

  const splitLabel = state.splitType === 'equal'
    ? `Equal (${Object.keys(splits).length} members)`
    : 'Custom ₹';

  return { desc, amount: money(amount), paidBy, paymentMethod, category, splits, splitLabel };
}

function applyExpensePoolEffect(trip, expense, direction) {
  // All expenses draw from the global "currentPool" total since members pay out of their contributed pool.
  trip.currentPool = money(trip.currentPool + direction * (expense.amount || 0));
}

function getPoolUsageExcluding(trip, excludedExpenseId) {
  const used = calcPoolContributionUsage(trip);
  const excluded = (trip.expenses || []).find(e => e.id === excludedExpenseId);
  if (excluded) {
    Object.entries(excluded.splits || {}).forEach(([memberId, amount]) => {
      used[memberId] = Math.max(0, (used[memberId] || 0) - (amount || 0));
    });
  }
  return used;
}

function saveExpense() {
  if (!state.isAdmin) { showToast('Only admin can add or edit expenses!'); return; }
  const trip = getTrip();
  const formExpense = collectExpenseForm();
  if (!formExpense) return;

  const existing = editingExpenseId ? trip.expenses.find(e => e.id === editingExpenseId) : null;
  const availablePool = trip.currentPool + (existing ? existing.amount || 0 : 0);
  // Allow the total pool to go negative if an expense exceeds it. The math handles it.
  
  const used = getPoolUsageExcluding(trip, existing?.id);
  // Allow individual members to go into negative balance (spend more than they pitched in).

  if (existing) applyExpensePoolEffect(trip, existing, 1);

  const expense = {
    ...formExpense,
    id: existing?.id || generateId(),
    timestamp: existing?.timestamp || Date.now()
  };

  if (existing) {
    Object.assign(existing, expense);
  } else {
    trip.expenses.push(expense);
  }

  applyExpensePoolEffect(trip, expense, -1);
  trip.transactions.push({
    id: generateId(), type: 'expense',
    desc: (editingExpenseId ? 'Edited expense: ' : '') + trip.members[expense.paidBy]?.name + ' paid for ' + expense.desc,
    amount: expense.amount, paymentMethod: expense.paymentMethod, userId: expense.paidBy, timestamp: Date.now()
  });

  document.getElementById('expense-modal').classList.remove('open');
  resetExpenseForm();
  setExpenseModalMode(null);
  saveState(); renderApp();
  showToast(existing ? 'Expense updated!' : 'Expense added!');
}

function addMemberContribution(memberId, amount, desc, timestamp = Date.now(), paymentMethod = DEFAULT_PAYMENT_METHOD) {
  const trip = getTrip();
  const member = trip.members[memberId];
  if (!member) return false;
  const method = getPaymentMethod(paymentMethod);

  member.contribution = money((member.contribution || 0) + amount);
  trip.currentPool = money(trip.currentPool + amount);
  trip.initialPool = money(trip.initialPool + amount);
  trip.transactions.push({
    id: generateId(), type: 'pool',
    desc,
    amount: money(amount), paymentMethod: method, userId: memberId, timestamp
  });
  return true;
}

/* â”€â”€ ADMIN: ADD TO POOL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function addToPool() {
  if (!state.isAdmin) { showToast('Only admin can update pool!'); return; }
  const trip = getTrip();
  const memberId = document.getElementById('add-pool-member').value;
  const member = trip.members[memberId];
  const amt = parseFloat(document.getElementById('add-pool-input').value) || 0;
  const timestamp = parseDatetimeLocalValue(document.getElementById('add-pool-datetime').value);
  const paymentMethod = document.getElementById('add-pool-payment-method').value;
  if (!member) { showToast('Select a member!'); return; }
  if (amt <= 0) { showToast('Enter a valid amount!'); return; }
  if (!addMemberContribution(memberId, money(amt), member.name + ' contributed to pool', timestamp, paymentMethod)) return;
  document.getElementById('add-pool-input').value = '';
  document.getElementById('add-pool-datetime').value = toDatetimeLocalValue();
  saveState(); renderApp();
  showToast(fmt(amt) + ' added to ' + member.name + "'s pool!");
}

function showCodeModal() {
  const trip = getTrip();
  document.getElementById('modal-code').textContent = trip.code;
  document.getElementById('code-modal').classList.add('open');
}

function closeCodeModal(e) {
  if (e.target === document.getElementById('code-modal'))
    document.getElementById('code-modal').classList.remove('open');
}

function copyCode() {
  const trip = getTrip();
  navigator.clipboard?.writeText(trip.code)
    .then(() => showToast('Code copied!'))
    .catch(()  => showToast('Code: ' + trip.code));
}


async function initApp() {
  window.TripVaultRemoteStorage?.init?.();
  window.tripVaultDebug = window.tripVaultDebug || {};
  window.tripVaultDebug.runRWTest = () => window.TripVaultRemoteStorage?.debugReadWrite?.(getPersistableState());
  window.runTripVaultRWTest = window.tripVaultDebug.runRWTest;
  await window.TripVaultRemoteStorage?.testConnection?.();
  await loadState();
  if (state.currentTripCode) {
    window.TripVaultRemoteStorage?.subscribe?.(state.currentTripCode, applyRemoteState);
  }
  if (state.currentTripCode && state.trips[state.currentTripCode]) {
    renderApp();
    showScreen('main');
  } else {
    showScreen('landing');
  }
}

initApp();
