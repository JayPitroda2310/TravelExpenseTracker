(function () {
  const config = window.TRIP_VAULT_CONFIG?.supabase || {};
  const STATE_TABLE = 'tripvault_state';
  const STATE_ID = config.stateId || 'trip-vault-global';
  const DEFAULT_PAYMENT_METHOD = 'Cash';
  let client = null;
  let realtimeChannel = null;
  let remoteRenderTimer = null;

  function toIso(ts) {
    if (!ts) return new Date().toISOString();
    return new Date(ts).toISOString();
  }

  function getPasswordRecord(entity) {
    if (entity?.password?.salt && entity?.password?.hash) return entity.password;
    if (entity?.passwordSalt && entity?.passwordHash) {
      return { salt: entity.passwordSalt, hash: entity.passwordHash };
    }
    return null;
  }

  function assertReady() {
    if (!client) throw new Error('Supabase is not configured or SDK failed to load.');
  }

  function init() {
    if (!config.url || !config.anonKey || !window.supabase?.createClient) return false;
    client = window.supabase.createClient(config.url, config.anonKey);
    window.tripVaultDebug = window.tripVaultDebug || {};
    window.tripVaultDebug.getSupabaseClient = () => client;
    return true;
  }

  async function testConnection() {
    if (!client) return;
    const { error } = await client.from(STATE_TABLE).select('id').limit(1);
    if (error) throw error;
  }

  async function loadState(tripCode) {
    if (!client) return null;
    if (!tripCode) return null;
    const { data, error } = await client
      .from(STATE_TABLE)
      .select('app_state')
      .eq('id', tripCode)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data?.app_state || null;
  }

  async function debugReadWrite(appState) {
    assertReady();
    const tripCode = Object.keys(appState?.trips || {})[0] || STATE_ID;
    const probe = {
      id: tripCode,
      app_state: appState,
      updated_at: new Date().toISOString()
    };
    const writeRes = await client
      .from(STATE_TABLE)
      .upsert(probe, { onConflict: 'id' })
      .select('id, updated_at')
      .single();
    if (writeRes.error) throw writeRes.error;

    const readRes = await client
      .from(STATE_TABLE)
      .select('id, updated_at')
      .eq('id', tripCode)
      .single();
    if (readRes.error) throw readRes.error;
    return readRes.data;
  }

  async function saveState(payload) {
    assertReady();
    const { error } = await client
      .from(STATE_TABLE)
      .upsert(payload, { onConflict: 'id' })
      .select('id')
      .single();
    if (error) throw error;
    await syncNormalizedTables(payload.app_state?.trips || {});
  }

  async function syncNormalizedTables(tripsByCode) {
    assertReady();
    const trips = Object.values(tripsByCode || {});
    for (const trip of trips) {
      await syncOneTripToTables(trip);
    }
  }

  async function syncOneTripToTables(trip) {
    const tripId = trip.code;
    const tripRow = {
      id: tripId,
      code: trip.code,
      name: trip.name,
      password_salt: getPasswordRecord(trip)?.salt || null,
      password_hash: getPasswordRecord(trip)?.hash || null,
      initial_pool: trip.initialPool || 0,
      current_pool: trip.currentPool || 0,
      admin_member_id: null
    };

    let res = await client.from('trips').upsert(tripRow, { onConflict: 'id' });
    if (res.error) throw res.error;

    const members = Object.values(trip.members || {}).map(m => ({
      id: m.id,
      trip_id: tripId,
      name: m.name,
      password_salt: getPasswordRecord(m)?.salt || null,
      password_hash: getPasswordRecord(m)?.hash || null,
      contribution: m.contribution || 0,
      joined_at: toIso(m.joinedAt)
    }));
    if (members.length) {
      res = await client.from('members').upsert(members, { onConflict: 'id' });
      if (res.error) throw res.error;
    }

    if (trip.adminId) {
      res = await client.from('trips').update({ admin_member_id: trip.adminId }).eq('id', tripId);
      if (res.error) throw res.error;
    }

    const expenses = (trip.expenses || []).map(e => ({
      id: e.id,
      trip_id: tripId,
      description: e.desc,
      amount: e.amount || 0,
      category: e.category || 'Other',
      payment_method: e.paymentMethod || DEFAULT_PAYMENT_METHOD,
      paid_by_member_id: e.paidBy,
      split_type: (e.splitLabel || '').toLowerCase().includes('custom') ? 'unequal' : 'equal',
      split_label: e.splitLabel || 'Equal',
      created_at: toIso(e.timestamp)
    }));

    res = await client.from('expenses').delete().eq('trip_id', tripId);
    if (res.error) throw res.error;
    if (expenses.length) {
      res = await client.from('expenses').insert(expenses);
      if (res.error) throw res.error;
    }

    const expenseSplits = [];
    for (const e of (trip.expenses || [])) {
      for (const [memberId, amount] of Object.entries(e.splits || {})) {
        expenseSplits.push({ expense_id: e.id, member_id: memberId, amount: amount || 0 });
      }
    }
    const expenseIds = (trip.expenses || []).map(e => e.id);
    if (expenseIds.length) {
      res = await client.from('expense_splits').delete().in('expense_id', expenseIds);
      if (res.error) throw res.error;
    }
    if (expenseSplits.length) {
      res = await client.from('expense_splits').insert(expenseSplits);
      if (res.error) throw res.error;
    }

    const settlements = (trip.settlements || []).map(s => ({
      id: s.id,
      trip_id: tripId,
      from_member_id: s.from,
      to_member_id: s.to,
      amount: s.amount || 0,
      payment_method: s.paymentMethod || DEFAULT_PAYMENT_METHOD,
      status: s.status || 'confirmed',
      paid_at: s.paidAt ? toIso(s.paidAt) : toIso(s.timestamp),
      confirmed_at: s.confirmedAt ? toIso(s.confirmedAt) : null,
      recorded_by_member_id: s.recordedBy || s.from,
      confirmed_by_member_id: s.confirmedBy || null,
      created_at: toIso(s.timestamp)
    }));
    res = await client.from('settlements').delete().eq('trip_id', tripId);
    if (res.error) throw res.error;
    if (settlements.length) {
      res = await client.from('settlements').insert(settlements);
      if (res.error) throw res.error;
    }

    const transactions = (trip.transactions || []).map(t => ({
      id: t.id,
      trip_id: tripId,
      type: t.type,
      description: t.desc,
      amount: t.amount || 0,
      payment_method: t.paymentMethod || null,
      member_id: t.userId || null,
      created_at: toIso(t.timestamp)
    }));
    res = await client.from('transactions').delete().eq('trip_id', tripId);
    if (res.error) throw res.error;
    if (transactions.length) {
      res = await client.from('transactions').insert(transactions);
      if (res.error) throw res.error;
    }
  }

  function subscribe(tripCode, onStateChange) {
    if (!client) return;
    if (realtimeChannel) {
      client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    if (!tripCode) return;
    realtimeChannel = client
      .channel(`trip-vault-state-${tripCode}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: STATE_TABLE,
        filter: `id=eq.${tripCode}`
      }, payload => {
        const appState = payload?.new?.app_state;
        if (!appState) return;
        clearTimeout(remoteRenderTimer);
        remoteRenderTimer = setTimeout(() => onStateChange(appState), 100);
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR') console.error('Supabase realtime channel error');
      });
  }

  window.TripVaultSupabaseStore = {
    init,
    testConnection,
    loadState,
    saveState,
    subscribe,
    debugReadWrite,
    stateId: STATE_ID
  };
})();
