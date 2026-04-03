/**
 * CaptainXI Offline Scoring Module — cxi-offline.js
 * ──────────────────────────────────────────────────
 * IndexedDB-based ball queue with auto-sync.
 * 
 * HOW IT WORKS:
 * 1. Every ball scored goes to IndexedDB FIRST, then Supabase.
 * 2. If Supabase write fails (offline), ball stays in queue.
 * 3. When connection returns, queue auto-syncs in order.
 * 4. Visual indicator shows online/offline status + pending count.
 * 
 * INTEGRATION (scorer.html):
 *   <script src="cxi-offline.js"></script>
 *   Then replace direct Supabase inserts with:
 *     await CXIOffline.queueBall(ballData, supabaseWriteFn);
 * 
 * Supabase project: ofondrfejzcznxsvpuec
 */

const CXIOffline = (() => {
    const DB_NAME = 'cxi_offline_db';
    const DB_VERSION = 1;
    const STORE_BALLS = 'pending_balls';
    const STORE_STATS = 'pending_stats';
    const SYNC_INTERVAL = 5000; // 5 seconds
    const MAX_RETRIES = 50;

    let db = null;
    let isSyncing = false;
    let syncTimer = null;
    let statusEl = null;

    // ─── IndexedDB Setup ───
    function openDB() {
        return new Promise((resolve, reject) => {
            if (db) return resolve(db);
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const d = e.target.result;
                if (!d.objectStoreNames.contains(STORE_BALLS)) {
                    const store = d.createObjectStore(STORE_BALLS, { keyPath: 'queueId', autoIncrement: true });
                    store.createIndex('matchId', 'matchId', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('synced', 'synced', { unique: false });
                }
                if (!d.objectStoreNames.contains(STORE_STATS)) {
                    const store = d.createObjectStore(STORE_STATS, { keyPath: 'queueId', autoIncrement: true });
                    store.createIndex('matchId', 'matchId', { unique: false });
                    store.createIndex('type', 'type', { unique: false });
                }
            };
            req.onsuccess = (e) => { db = e.target.result; resolve(db); };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    // ─── Generic IndexedDB helpers ───
    async function addToStore(storeName, data) {
        const d = await openDB();
        return new Promise((resolve, reject) => {
            const tx = d.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.add(data);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function getAllFromStore(storeName) {
        const d = await openDB();
        return new Promise((resolve, reject) => {
            const tx = d.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function deleteFromStore(storeName, key) {
        const d = await openDB();
        return new Promise((resolve, reject) => {
            const tx = d.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async function updateInStore(storeName, data) {
        const d = await openDB();
        return new Promise((resolve, reject) => {
            const tx = d.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(data);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async function getPendingCount() {
        const all = await getAllFromStore(STORE_BALLS);
        return all.filter(b => !b.synced).length;
    }

    // ─── Core: Queue a ball ───
    // ballData: the object you'd normally insert into Supabase `balls` table
    // writeFn: async function that does the actual Supabase insert, returns {success, error}
    async function queueBall(ballData, writeFn) {
        const entry = {
            ...ballData,
            timestamp: Date.now(),
            synced: false,
            retries: 0,
            error: null
        };

        // Always save to IndexedDB first (safety net)
        const queueId = await addToStore(STORE_BALLS, entry);
        entry.queueId = queueId;

        updateStatusUI();

        // Try immediate Supabase write
        if (navigator.onLine) {
            try {
                const result = await writeFn(ballData);
                if (result && result.success !== false && !result.error) {
                    // Success — mark as synced
                    entry.synced = true;
                    entry.syncedAt = Date.now();
                    await updateInStore(STORE_BALLS, entry);
                    updateStatusUI();
                    return { success: true, offline: false };
                }
            } catch (err) {
                console.warn('[CXI-Offline] Supabase write failed, queued for sync:', err.message);
                entry.error = err.message;
                await updateInStore(STORE_BALLS, entry);
            }
        }

        updateStatusUI();
        return { success: true, offline: true, queueId };
    }

    // ─── Queue a stat update ───
    // For match_players, tournament_teams stat updates that happen alongside ball inserts
    async function queueStatUpdate(matchId, type, updateFn, updateData) {
        const entry = {
            matchId,
            type, // 'batting_stat', 'bowling_stat', 'tournament_team', 'match_end'
            updateData,
            timestamp: Date.now(),
            synced: false,
            retries: 0
        };

        const queueId = await addToStore(STORE_STATS, entry);
        entry.queueId = queueId;

        if (navigator.onLine) {
            try {
                await updateFn(updateData);
                entry.synced = true;
                entry.syncedAt = Date.now();
                await updateInStore(STORE_STATS, entry);
                return { success: true, offline: false };
            } catch (err) {
                console.warn('[CXI-Offline] Stat update queued:', err.message);
                entry.error = err.message;
                await updateInStore(STORE_STATS, entry);
            }
        }

        return { success: true, offline: true, queueId };
    }

    // ─── Sync engine ───
    async function syncPendingBalls(writeFn) {
        if (isSyncing || !navigator.onLine) return;
        isSyncing = true;

        try {
            const all = await getAllFromStore(STORE_BALLS);
            const pending = all.filter(b => !b.synced && b.retries < MAX_RETRIES);

            // Sort by timestamp to preserve ball order
            pending.sort((a, b) => a.timestamp - b.timestamp);

            let syncedCount = 0;
            for (const ball of pending) {
                try {
                    // Extract just the ball data (remove queue metadata)
                    const { queueId, timestamp, synced, syncedAt, retries, error, ...ballData } = ball;
                    const result = await writeFn(ballData);

                    if (result && result.success !== false && !result.error) {
                        ball.synced = true;
                        ball.syncedAt = Date.now();
                        await updateInStore(STORE_BALLS, ball);
                        syncedCount++;
                    } else {
                        ball.retries = (ball.retries || 0) + 1;
                        ball.error = result?.error || 'Unknown sync error';
                        await updateInStore(STORE_BALLS, ball);
                    }
                } catch (err) {
                    ball.retries = (ball.retries || 0) + 1;
                    ball.error = err.message;
                    await updateInStore(STORE_BALLS, ball);
                }
            }

            if (syncedCount > 0) {
                console.log(`[CXI-Offline] Synced ${syncedCount} balls`);
                showSyncToast(syncedCount);
            }
        } catch (err) {
            console.error('[CXI-Offline] Sync error:', err);
        } finally {
            isSyncing = false;
            updateStatusUI();
        }
    }

    // ─── Sync stat updates ───
    async function syncPendingStats(updateFns) {
        if (!navigator.onLine) return;

        const all = await getAllFromStore(STORE_STATS);
        const pending = all.filter(s => !s.synced && s.retries < MAX_RETRIES);
        pending.sort((a, b) => a.timestamp - b.timestamp);

        for (const stat of pending) {
            const fn = updateFns[stat.type];
            if (!fn) continue;

            try {
                await fn(stat.updateData);
                stat.synced = true;
                stat.syncedAt = Date.now();
                await updateInStore(STORE_STATS, stat);
            } catch (err) {
                stat.retries = (stat.retries || 0) + 1;
                stat.error = err.message;
                await updateInStore(STORE_STATS, stat);
            }
        }
    }

    // ─── Auto-sync loop ───
    function startAutoSync(writeFn, statUpdateFns) {
        if (syncTimer) clearInterval(syncTimer);
        syncTimer = setInterval(async () => {
            if (navigator.onLine) {
                await syncPendingBalls(writeFn);
                if (statUpdateFns) await syncPendingStats(statUpdateFns);
            }
        }, SYNC_INTERVAL);

        // Also sync on reconnect
        window.addEventListener('online', async () => {
            updateStatusUI();
            showSyncToast(0, 'Reconnected! Syncing...');
            await syncPendingBalls(writeFn);
            if (statUpdateFns) await syncPendingStats(statUpdateFns);
        });

        window.addEventListener('offline', () => {
            updateStatusUI();
            showSyncToast(0, 'You\'re offline. Scoring continues locally.');
        });
    }

    function stopAutoSync() {
        if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    }

    // ─── Cleanup synced balls (call periodically or on match end) ───
    async function cleanupSynced(matchId) {
        const all = await getAllFromStore(STORE_BALLS);
        const synced = all.filter(b => b.synced && (!matchId || b.match_id === matchId));
        for (const b of synced) {
            await deleteFromStore(STORE_BALLS, b.queueId);
        }
        // Also clean stats
        const allStats = await getAllFromStore(STORE_STATS);
        const syncedStats = allStats.filter(s => s.synced && (!matchId || s.matchId === matchId));
        for (const s of syncedStats) {
            await deleteFromStore(STORE_STATS, s.queueId);
        }
    }

    // ─── Status UI ───
    function createStatusUI() {
        if (document.getElementById('cxi-offline-status')) return;

        const el = document.createElement('div');
        el.id = 'cxi-offline-status';
        el.innerHTML = `
            <div class="cxi-os-dot"></div>
            <span class="cxi-os-text">Online</span>
            <span class="cxi-os-count" style="display:none"></span>
        `;
        document.body.appendChild(el);
        statusEl = el;

        const style = document.createElement('style');
        style.textContent = `
            #cxi-offline-status {
                position: fixed;
                top: env(safe-area-inset-top, 8px);
                right: 12px;
                z-index: 99999;
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 6px 12px;
                border-radius: 20px;
                background: rgba(10,10,15,0.85);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                font-family: 'DM Sans', 'Noto Sans', sans-serif;
                font-size: 12px;
                color: #fff;
                transition: all 0.3s ease;
                pointer-events: none;
            }
            #cxi-offline-status.offline {
                background: rgba(231,76,60,0.9);
            }
            #cxi-offline-status.syncing {
                background: rgba(243,156,18,0.9);
            }
            .cxi-os-dot {
                width: 8px; height: 8px;
                border-radius: 50%;
                background: #27AE60;
                transition: background 0.3s;
            }
            #cxi-offline-status.offline .cxi-os-dot { background: #E74C3C; }
            #cxi-offline-status.syncing .cxi-os-dot {
                background: #F5A623;
                animation: cxi-pulse 1s infinite;
            }
            @keyframes cxi-pulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.5; transform: scale(1.3); }
            }
            .cxi-os-count {
                background: #F5A623;
                color: #0A0A0F;
                font-weight: 700;
                font-size: 11px;
                padding: 1px 6px;
                border-radius: 10px;
            }
            #cxi-sync-toast {
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%) translateY(20px);
                z-index: 99999;
                padding: 10px 20px;
                border-radius: 24px;
                background: rgba(10,10,15,0.9);
                backdrop-filter: blur(8px);
                color: #F5A623;
                font-family: 'DM Sans', sans-serif;
                font-size: 13px;
                font-weight: 600;
                opacity: 0;
                transition: all 0.3s ease;
                pointer-events: none;
            }
            #cxi-sync-toast.show {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
        `;
        document.head.appendChild(style);

        // Toast element
        const toast = document.createElement('div');
        toast.id = 'cxi-sync-toast';
        document.body.appendChild(toast);
    }

    async function updateStatusUI() {
        if (!statusEl) return;
        const pending = await getPendingCount();
        const online = navigator.onLine;
        const dot = statusEl.querySelector('.cxi-os-dot');
        const text = statusEl.querySelector('.cxi-os-text');
        const count = statusEl.querySelector('.cxi-os-count');

        statusEl.classList.remove('offline', 'syncing');

        if (!online) {
            statusEl.classList.add('offline');
            text.textContent = 'Offline';
        } else if (pending > 0) {
            statusEl.classList.add('syncing');
            text.textContent = 'Syncing';
        } else {
            text.textContent = 'Online';
        }

        if (pending > 0) {
            count.style.display = 'inline';
            count.textContent = pending;
        } else {
            count.style.display = 'none';
        }
    }

    function showSyncToast(count, customMsg) {
        const toast = document.getElementById('cxi-sync-toast');
        if (!toast) return;
        toast.textContent = customMsg || `✓ ${count} ball${count !== 1 ? 's' : ''} synced`;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // ─── Init ───
    async function init() {
        await openDB();
        createStatusUI();
        updateStatusUI();

        // Update status on connectivity changes
        window.addEventListener('online', updateStatusUI);
        window.addEventListener('offline', updateStatusUI);

        console.log('[CXI-Offline] Initialized');
    }

    // ─── Get match balls from local DB (for scorecard rebuild while offline) ───
    async function getLocalBalls(matchId) {
        const all = await getAllFromStore(STORE_BALLS);
        return all.filter(b => b.match_id === matchId).sort((a, b) => a.timestamp - b.timestamp);
    }

    // ─── Public API ───
    return {
        init,
        queueBall,
        queueStatUpdate,
        syncPendingBalls,
        syncPendingStats,
        startAutoSync,
        stopAutoSync,
        cleanupSynced,
        getPendingCount,
        getLocalBalls,
        updateStatusUI
    };
})();

// Auto-init when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => CXIOffline.init());
} else {
    CXIOffline.init();
}
