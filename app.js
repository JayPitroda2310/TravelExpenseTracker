let state = {
  trips: {},
  currentTripCode: null,
  currentUserId: null,
  currentUserName: null,
  isAdmin: false,
  splitType: 'equal'
};

const SUPABASE_URL = 'https://titsruvqhttaomudvpfi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IhPSHDIrvBeajV-RH-DoLw_lDMumNNQ';
const SUPABASE_STATE_ID = 'trip-vault-global';
const LOCAL_STATE_KEY = 'tripvault_state';
const SESSION_KEY = 'tripvault_session';
let supabaseClient = null;
let editingExpenseId = null;

function initSupabase() {
  try {
    if (window.supabase && window.supabase.createClient) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      window.tripVaultDebug = {
        getClient: () => supabaseClient
      };
    }
  } catch (e) {}
}

async function debugSupabaseRW() {
  if (!supabaseClient) {
    console.error('Debug RW: supabase client missing');
    showToast('Debug RW: client missing');
    return;
  }
  try {
    const probe = {
      id: SUPABASE_STATE_ID,
      app_state: getPersistableState(),
      updated_at: new Date().toISOString()
    };
    const writeRes = await supabaseClient
      .from('tripvault_state')
      .upsert(probe, { onConflict: 'id' })
      .select('id, updated_at')
      .single();
    console.log('Debug RW write:', writeRes);
    if (writeRes.error) {
      showToast('RW write error: ' + (writeRes.error.message || writeRes.error.code || 'unknown'));
      return;
    }

    const readRes = await supabaseClient
      .from('tripvault_state')
      .select('id, updated_at')
      .eq('id', SUPABASE_STATE_ID)
      .single();
    console.log('Debug RW read:', readRes);
    if (readRes.error) {
      showToast('RW read error: ' + (readRes.error.message || readRes.error.code || 'unknown'));
      return;
    }
    showToast('Supabase RW OK');
  } catch (e) {
    console.error('Debug RW exception:', e);
    showToast('RW exception: ' + (e.message || 'unknown'));
  }
}

async function testSupabaseConnection() {
  if (!supabaseClient) return;
  try {
    const { error } = await supabaseClient
      .from('tripvault_state')
      .select('id')
      .limit(1);
    if (error) {
      console.error('Supabase connection test error:', error);
      showToast('Supabase error: ' + (error.message || error.code || 'unknown'));
    }
  } catch (e) {
    console.error('Supabase connection test exception:', e);
    showToast('Supabase exception: ' + (e.message || 'unknown'));
  }
}

async function saveStateRemote() {
  if (!supabaseClient) return;
  try {
    const payload = {
      id: SUPABASE_STATE_ID,
      app_state: getPersistableState(),
      updated_at: new Date().toISOString()
    };
    const { error } = await supabaseClient
      .from('tripvault_state')
      .upsert(payload, { onConflict: 'id' })
      .select('id')
      .single();
    if (error) {
      console.error('Supabase save error:', error);
      showToast('Supabase save failed: ' + (error.message || error.code || 'unknown'));
      return;
    }
    await syncNormalizedTables();
  } catch (e) {
    console.error('Supabase save exception:', e);
    showToast('Supabase save exception: ' + (e.message || 'unknown'));
  }
}

function toIso(ts) {
  if (!ts) return new Date().toISOString();
  return new Date(ts).toISOString();
}

async function syncOneTripToTables(trip) {
  const tripId = trip.code;
  const tripRow = {
    id: tripId,
    code: trip.code,
    name: trip.name,
    initial_pool: trip.initialPool || 0,
    current_pool: trip.currentPool || 0,
    admin_member_id: null
  };

  let res = await supabaseClient.from('trips').upsert(tripRow, { onConflict: 'id' });
  if (res.error) throw res.error;

  const members = Object.values(trip.members || {}).map(m => ({
    id: m.id,
    trip_id: tripId,
    name: m.name,
    contribution: m.contribution || 0,
    joined_at: toIso(m.joinedAt)
  }));
  if (members.length) {
    res = await supabaseClient.from('members').upsert(members, { onConflict: 'id' });
    if (res.error) throw res.error;
  }

  // Set admin FK only after members exist.
  if (trip.adminId) {
    res = await supabaseClient
      .from('trips')
      .update({ admin_member_id: trip.adminId })
      .eq('id', tripId);
    if (res.error) throw res.error;
  }

  const expenses = (trip.expenses || []).map(e => ({
    id: e.id,
    trip_id: tripId,
    description: e.desc,
    amount: e.amount || 0,
    category: e.category || 'Other',
    paid_by_member_id: e.paidBy,
    split_type: (e.splitLabel || '').toLowerCase().includes('custom') ? 'unequal' : 'equal',
    split_label: e.splitLabel || 'Equal',
    created_at: toIso(e.timestamp)
  }));

  res = await supabaseClient.from('expenses').delete().eq('trip_id', tripId);
  if (res.error) throw res.error;
  if (expenses.length) {
    res = await supabaseClient.from('expenses').insert(expenses);
    if (res.error) throw res.error;
  }

  const expenseSplits = [];
  for (const e of (trip.expenses || [])) {
    for (const [memberId, amount] of Object.entries(e.splits || {})) {
      expenseSplits.push({
        expense_id: e.id,
        member_id: memberId,
        amount: amount || 0
      });
    }
  }
  const expenseIds = (trip.expenses || []).map(e => e.id);
  if (expenseIds.length) {
    res = await supabaseClient.from('expense_splits').delete().in('expense_id', expenseIds);
    if (res.error) throw res.error;
  }
  if (expenseSplits.length) {
    res = await supabaseClient.from('expense_splits').insert(expenseSplits);
    if (res.error) throw res.error;
  }

  const settlements = (trip.settlements || []).map(s => ({
    id: s.id,
    trip_id: tripId,
    from_member_id: s.from,
    to_member_id: s.to,
    amount: s.amount || 0,
    created_at: toIso(s.timestamp)
  }));
  res = await supabaseClient.from('settlements').delete().eq('trip_id', tripId);
  if (res.error) throw res.error;
  if (settlements.length) {
    res = await supabaseClient.from('settlements').insert(settlements);
    if (res.error) throw res.error;
  }

  const transactions = (trip.transactions || []).map(t => ({
    id: t.id,
    trip_id: tripId,
    type: t.type,
    description: t.desc,
    amount: t.amount || 0,
    member_id: t.userId || null,
    created_at: toIso(t.timestamp)
  }));
  res = await supabaseClient.from('transactions').delete().eq('trip_id', tripId);
  if (res.error) throw res.error;
  if (transactions.length) {
    res = await supabaseClient.from('transactions').insert(transactions);
    if (res.error) throw res.error;
  }
}

async function syncNormalizedTables() {
  if (!supabaseClient) return;
  const trips = Object.values(state.trips || {});
  for (const trip of trips) {
    await syncOneTripToTables(trip);
  }
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
  const tripCode = getPrimaryTripCode();
  return {
    trips: tripCode ? { [tripCode]: state.trips[tripCode] } : {},
    currentTripCode: tripCode,
    currentUserId: null,
    currentUserName: null,
    isAdmin: false,
    splitType: 'equal'
  };
}

function applyPersistedTripState(savedState) {
  const savedTrips = savedState?.trips || {};
  const tripCode = savedState?.currentTripCode && savedTrips[savedState.currentTripCode]
    ? savedState.currentTripCode
    : getPrimaryTripCode(savedTrips);

  state.trips = tripCode ? { [tripCode]: savedTrips[tripCode] } : {};
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
      return;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      tripCode: state.currentTripCode,
      userId: state.currentUserId,
      userName: state.currentUserName
    }));
  } catch (e) {}
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const session = JSON.parse(raw);
    const trip = state.trips?.[session.tripCode];
    const member = trip?.members?.[session.userId];
    if (!trip || !member) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    state.currentTripCode = session.tripCode;
    state.currentUserId = member.id;
    state.currentUserName = member.name;
    state.isAdmin = member.id === trip.adminId;
  } catch (e) {}
}

function saveState() {
  saveSession();
  try { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(getPersistableState())); } catch (e) {}
  saveStateRemote();
}

async function loadState() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('tripvault_state')
        .select('app_state')
        .eq('id', SUPABASE_STATE_ID)
        .single();
      if (error && error.code !== 'PGRST116') {
        console.error('Supabase load error:', error);
      }
      if (data?.app_state) {
        applyPersistedTripState(data.app_state);
        loadSession();
        try { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(getPersistableState())); } catch (e) {}
        return;
      }
    } catch (e) {
      console.error('Supabase load exception:', e);
    }
  }

  try {
    const s = localStorage.getItem(LOCAL_STATE_KEY);
    if (s) {
      applyPersistedTripState(JSON.parse(s));
      loadSession();
    }
  } catch (e) {}
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

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').substr(0, 2).toUpperCase();
}

/* â”€â”€ CREATE TRIP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function createTrip() {
  const adminName = document.getElementById('admin-name').value.trim();
  const tripName  = document.getElementById('trip-name-input').value.trim();
  if (!adminName || !tripName) { showToast('Fill all fields!'); return; }

  const code   = generateCode();
  const userId = generateId();
  const trip   = {
    code, name: tripName,
    initialPool: 0, currentPool: 0,
    adminId: userId,
    members: { [userId]: { id: userId, name: adminName, contribution: 0, joinedAt: Date.now() } },
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
  renderApp();
  showScreen('main');
}

/* â”€â”€ JOIN TRIP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function joinTrip() {
  const memberName = document.getElementById('member-name').value.trim();
  const code       = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (!memberName || !code) { showToast('Fill all fields!'); return; }

  const trip = state.trips[code];
  if (!trip) { showToast('Invalid code!'); return; }

  // Re-join existing member
  const existing = Object.values(trip.members).find(m => m.name.toLowerCase() === memberName.toLowerCase());
  if (existing) {
    state.currentTripCode = code;
    state.currentUserId   = existing.id;
    state.currentUserName = existing.name;
    state.isAdmin         = existing.id === trip.adminId;
    saveState(); renderApp(); showScreen('main');
    showToast('Welcome back, ' + memberName + '!');
    return;
  }

  const userId = generateId();
  trip.members[userId] = { id: userId, name: memberName, contribution: 0, joinedAt: Date.now() };
  trip.transactions.push({
    id: generateId(), type: 'join',
    desc: memberName + ' joined the trip',
    amount: 0, userId, timestamp: Date.now()
  });

  state.currentTripCode = code;
  state.currentUserId   = userId;
  state.currentUserName = memberName;
  state.isAdmin         = false;
  saveState(); renderApp(); showScreen('main');
  showToast('Joined ' + trip.name + '!');
}

function getTrip() { return state.trips[state.currentTripCode]; }

function isPoolExpense(trip, expense) {
  return expense.paidBy === trip.adminId;
}

function calcPoolContributionUsage(trip = getTrip()) {
  const used = {};
  Object.keys(trip.members || {}).forEach(id => used[id] = 0);

  (trip.expenses || []).forEach(e => {
    if (!isPoolExpense(trip, e)) return;
    Object.entries(e.splits || {}).forEach(([uid, amt]) => {
      used[uid] = (used[uid] || 0) + amt;
    });
  });

  return used;
}

/* â”€â”€ RENDER APP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderApp() {
  const trip = getTrip();
  if (!trip) return;

  document.getElementById('header-trip-name').textContent = trip.name;
  document.getElementById('role-badge').textContent = state.isAdmin ? '👑 Admin' : '👤 Member';
  const codeBtn = document.getElementById('code-btn');
  codeBtn.style.display = state.isAdmin ? 'block' : 'none';

  const totalContrib = Object.values(trip.members).reduce((s, m) => s + m.contribution, 0);
  const totalSpent   = trip.expenses.reduce((s, e) => s + (isPoolExpense(trip, e) ? e.amount : 0), 0);
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
  renderMembers();
  renderSettlements();
  renderTxns();
}

/* â”€â”€ EXPENSES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
      return `<div class="split-row"><span>${m ? m.name : uid}</span><span>${fmt(amt)}</span></div>`;
    }).join('');
    return `<div class="expense-card">
      <div class="expense-header">
        <div class="expense-desc">${e.category} ${e.desc}</div>
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
        <div class="expense-tag">${e.splitLabel}</div>
        <div class="expense-paid-by">Paid by ${payer ? payer.name : '?'}</div>
        <div class="expense-paid-by" style="color:var(--text3)">${new Date(e.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
      </div>
      <div class="expense-splits">${splits}</div>
    </div>`;
  }).join('');
}

/* â”€â”€ MEMBERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderMembers() {
  const trip     = getTrip();
  const poolUsed = calcPoolContributionUsage(trip);
  const el       = document.getElementById('members-list');
  el.innerHTML = Object.values(trip.members).map(m => {
    const isMe   = m.id === state.currentUserId;
    const isAdm  = m.id === trip.adminId;
    return `<div class="member-card">
      <div class="member-avatar">${initials(m.name)}</div>
      <div class="member-info">
        <div class="member-name">
          ${m.name}
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
    const myRemaining = Math.max(0, (myMember.contribution || 0) - myUsed);
    myPoolSec.style.display = 'block';
    document.getElementById('my-pool-remaining').textContent =
      `${fmt(myRemaining)} left of ${fmt(myMember.contribution || 0)} (${fmt(myUsed)} used)`;
  } else {
    myPoolSec.style.display = 'none';
  }

  const adminSec = document.getElementById('admin-pool-section');
  if (state.isAdmin) {
    adminSec.style.display = 'block';
    document.getElementById('inline-code').textContent = trip.code;
    document.getElementById('add-pool-member').innerHTML = Object.values(trip.members)
      .map(m => `<option value="${m.id}" ${m.id === state.currentUserId ? 'selected' : ''}>${m.name}${m.id === trip.adminId ? ' (Admin)' : ''}</option>`)
      .join('');
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

  trip.expenses.forEach(e => {
    if (isPoolExpense(trip, e)) return;
    bal[e.paidBy] = (bal[e.paidBy] || 0) + e.amount;
    Object.entries(e.splits).forEach(([uid, amt]) => {
      bal[uid] = (bal[uid] || 0) - amt;
    });
  });

  trip.settlements.forEach(s => {
    bal[s.from] = (bal[s.from] || 0) + s.amount;
    bal[s.to]   = (bal[s.to]   || 0) - s.amount;
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
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
}

function deleteExpense(expenseId) {
  if (!state.isAdmin) { showToast('Only admin can delete expenses!'); return; }
  const trip = getTrip();
  const idx = trip.expenses.findIndex(e => e.id === expenseId);
  if (idx < 0) return;

  const expense = trip.expenses[idx];
  if (isPoolExpense(trip, expense)) trip.currentPool += expense.amount || 0;
  trip.expenses.splice(idx, 1);
  trip.transactions.push({
    id: generateId(), type: 'settlement',
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
  showScreen(getPrimaryTripCode() ? 'join-trip' : 'landing');
  showToast('You left the trip.');
}

/* â”€â”€ SETTLEMENT CALCULATION (min transactions) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function calcSettlements() {
  const balances  = calcBalances();
  const debtors   = [], creditors = [];

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
    if (pay > 0.01) txns.push({ from: debtors[d].id, to: creditors[c].id, amount: pay });
    debtors[d].amt -= pay; creditors[c].amt -= pay;
    if (debtors[d].amt < 0.01) d++;
    if (creditors[c].amt < 0.01) c++;
  }
  return txns;
}

function renderSettlements() {
  const trip    = getTrip();
  const pending = calcSettlements();
  const el      = document.getElementById('settlements-list');
  const mine    = pending.filter(s => s.from === state.currentUserId || s.to === state.currentUserId);

  if (!mine.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><p>You are settled up!<br>No payments for you.</p></div>';
    return;
  }

  const renderItem = (s) => {
    const from = trip.members[s.from], to = trip.members[s.to];
    const iPay = s.from === state.currentUserId;
    const otherMember = iPay ? to : from;
    return `<div class="settlement-item">
      <div class="settlement-names">
        <div class="settlement-from">${iPay ? 'You have to give' : 'You have to take'}</div>
        <div class="settlement-to">${iPay ? 'to' : 'from'} ${otherMember ? otherMember.name : '?'}</div>
      </div>
      <div class="settlement-amt ${iPay ? 'pay' : 'receive'}">${fmt(s.amount)}</div>
      ${iPay ? `<button class="settle-btn" onclick="markSettled('${s.from}','${s.to}',${s.amount})">Paid</button>` : ''}
    </div>`;
  };

  el.innerHTML = `<div class="section-title">Your Settlements</div>
    <div class="settlement-card">
      ${mine.map(renderItem).join('')}
    </div>`;
}

function markSettled(fromId, toId, amount) {
  const trip     = getTrip();
  const fromName = trip.members[fromId]?.name;
  const toName   = trip.members[toId]?.name;
  trip.settlements.push({ id: generateId(), from: fromId, to: toId, amount, timestamp: Date.now() });
  trip.transactions.push({
    id: generateId(), type: 'settlement',
    desc: fromName + ' paid ' + toName,
    amount, userId: fromId, timestamp: Date.now()
  });
  saveState(); renderApp();
  showToast('Settlement recorded!');
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
          <div class="tx-desc">${t.desc}</div>
          <div class="tx-meta">${new Date(t.timestamp).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <div style="text-align:right">
          ${showAmount ? `<div class="tx-amount ${amtCls}">${prefix}${fmt(t.amount)}</div>` : ''}
          <div style="margin-top:4px"><span class="tx-type-badge ${badgeCls}">${displayType}</span></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* â”€â”€ TABS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function switchTab(tab) {
  const order = ['expenses', 'settle', 'txns', 'members'];
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
  document.getElementById('split-total-display').innerHTML = '';
}

function setExpenseModalMode(expenseId) {
  editingExpenseId = expenseId || null;
  document.getElementById('expense-modal-title').textContent = editingExpenseId ? 'Edit Expense' : 'Add Expense';
  document.getElementById('expense-submit-btn').textContent = editingExpenseId ? 'Save Changes' : 'Add Expense';
}

function openExpenseModal(expenseId = null) {
  const trip = getTrip();
  const expense = expenseId ? trip.expenses.find(e => e.id === expenseId) : null;
  if (expenseId && (!state.isAdmin || !expense)) return;

  setExpenseModalMode(expenseId);
  if (!expense) resetExpenseForm();

  const paidByEl = document.getElementById('exp-paid-by');
  paidByEl.innerHTML = Object.values(trip.members)
    .map(m => `<option value="${m.id}" ${m.id === (expense?.paidBy || state.currentUserId) ? 'selected' : ''}>${m.name}</option>`)
    .join('');

  if (expense) {
    document.getElementById('exp-desc').value = expense.desc;
    document.getElementById('exp-amount').value = expense.amount;
    const categoryEl = document.getElementById('exp-category');
    const categoryIndex = [...categoryEl.options].findIndex(o => o.textContent.startsWith(expense.category));
    categoryEl.selectedIndex = categoryIndex >= 0 ? categoryIndex : categoryEl.options.length - 1;
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
        <label class="member-split-name" for="chk-${m.id}">${m.name}${m.id === state.currentUserId ? ' (You)' : ''}</label>
        <div class="member-split-pct" id="split-display-${m.id}"></div>
      </div>`).join('');
  } else if (state.splitType === 'unequal') {
    container.innerHTML = members.map(m => `
      <div class="member-split-row">
        <span class="member-split-name">${m.name}${m.id === state.currentUserId ? ' (You)' : ''}</span>
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

  if (!desc || !amount || amount <= 0) { showToast('Fill description & amount!'); return null; }

  const members = Object.values(trip.members);
  let splits = {};

  if (state.splitType === 'equal') {
    const checked = members.filter(m => document.getElementById('chk-' + m.id)?.checked);
    if (!checked.length) { showToast('Select at least one member!'); return; }
    const share = amount / checked.length;
    checked.forEach(m => splits[m.id] = share);
  } else if (state.splitType === 'unequal') {
    members.forEach(m => {
      const v = parseFloat(document.getElementById('split-inp-' + m.id)?.value) || 0;
      if (v > 0) splits[m.id] = v;
    });
    const total = Object.values(splits).reduce((s, v) => s + v, 0);
    if (Math.abs(total - amount) > 0.01) { showToast('Split amounts must equal total!'); return; }
  }

  if (!Object.keys(splits).length) { showToast('No members in split!'); return; }

  const splitLabel = state.splitType === 'equal'
    ? `Equal (${Object.keys(splits).length} members)`
    : 'Custom ₹';

  return { desc, amount, paidBy, category, splits, splitLabel };
}

function applyExpensePoolEffect(trip, expense, direction) {
  if (isPoolExpense(trip, expense)) trip.currentPool += direction * (expense.amount || 0);
}

function saveExpense() {
  const trip = getTrip();
  const formExpense = collectExpenseForm();
  if (!formExpense) return;

  const existing = editingExpenseId ? trip.expenses.find(e => e.id === editingExpenseId) : null;
  const availablePool = trip.currentPool + (existing && isPoolExpense(trip, existing) ? existing.amount || 0 : 0);
  if (formExpense.paidBy === trip.adminId && formExpense.amount > availablePool) {
    showToast('Not enough in pool!');
    return;
  }

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
    desc: (editingExpenseId ? 'Edited expense: ' : '') + (expense.paidBy === trip.adminId
      ? 'Pool paid for ' + expense.desc
      : trip.members[expense.paidBy]?.name + ' paid for ' + expense.desc),
    amount: expense.amount, userId: expense.paidBy, timestamp: Date.now()
  });

  document.getElementById('expense-modal').classList.remove('open');
  resetExpenseForm();
  setExpenseModalMode(null);
  saveState(); renderApp();
  showToast(existing ? 'Expense updated!' : 'Expense added!');
}

function addMemberContribution(memberId, amount, desc) {
  const trip = getTrip();
  const member = trip.members[memberId];
  if (!member) return false;

  member.contribution = (member.contribution || 0) + amount;
  trip.currentPool += amount;
  trip.initialPool += amount;
  trip.transactions.push({
    id: generateId(), type: 'pool',
    desc,
    amount, userId: memberId, timestamp: Date.now()
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
  if (!member) { showToast('Select a member!'); return; }
  if (amt <= 0) { showToast('Enter a valid amount!'); return; }
  if (!addMemberContribution(memberId, amt, member.name + ' pool updated by admin')) return;
  document.getElementById('add-pool-input').value = '';
  saveState(); renderApp();
  showToast(fmt(amt) + ' added to ' + member.name + "'s pool!");
}

/* â”€â”€ CODE MODAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

/* â”€â”€ INIT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function initApp() {
  initSupabase();
  window.tripVaultDebug = window.tripVaultDebug || {};
  window.tripVaultDebug.runRWTest = debugSupabaseRW;
  window.runTripVaultRWTest = debugSupabaseRW;
  await testSupabaseConnection();
  await loadState();
  if (state.currentTripCode && state.trips[state.currentTripCode]) {
    renderApp();
    showScreen('main');
  } else if (getPrimaryTripCode()) {
    showScreen('join-trip');
  } else {
    showScreen('landing');
  }
}

initApp();
