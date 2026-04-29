(function () {
  let saveQueue = Promise.resolve();

  function toast(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
  }

  function init() {
    window.TripVaultSupabaseStore?.init();
  }

  async function testConnection() {
    try {
      await window.TripVaultSupabaseStore?.testConnection?.();
    } catch (e) {
      console.error('Supabase connection test failed:', e);
      toast('Supabase error: ' + (e.message || e.code || 'unknown'));
    }
  }

  function queueSave(payload) {
    saveQueue = saveQueue
      .catch(() => {})
      .then(() => save(payload));
    return saveQueue;
  }

  async function save(payload) {
    try {
      await window.TripVaultSupabaseStore?.saveState(payload);
    } catch (e) {
      console.error('Supabase save failed:', e);
      toast('Supabase save failed: ' + (e.message || 'unknown'));
    }
  }

  async function load(tripCode) {
    if (!tripCode) return null;
    try {
      const supabaseState = await window.TripVaultSupabaseStore?.loadState?.(tripCode);
      if (supabaseState) return { source: 'supabase', appState: supabaseState };
    } catch (e) {
      console.error('Supabase load exception:', e);
      toast('Supabase load failed: ' + (e.message || 'unknown'));
    }

    return null;
  }

  function subscribe(tripCode, onStateChange) {
    if (!tripCode) return;
    window.TripVaultSupabaseStore?.subscribe?.(tripCode, onStateChange);
  }

  async function debugReadWrite(appState) {
    const result = await window.TripVaultSupabaseStore?.debugReadWrite?.(appState);
    toast('Supabase RW OK');
    return result;
  }

  function stateId() {
    return window.TripVaultSupabaseStore?.stateId || 'trip-vault-global';
  }

  window.TripVaultRemoteStorage = {
    init,
    testConnection,
    queueSave,
    load,
    subscribe,
    debugReadWrite,
    stateId
  };
})();
