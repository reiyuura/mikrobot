import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'mikrobot.json');

// Auto-create data directory
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ═══════════════════════════════════
//  LOAD / SAVE
// ═══════════════════════════════════

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    }
  } catch {
    console.warn('⚠️  Database corrupted, creating fresh one.');
  }
  return { users: [], nextId: 1, tether: {} };
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Initialize
let db = loadDB();
if (!db.tether) db.tether = {};
if (!Array.isArray(db.tetherEvents)) db.tetherEvents = [];
if (!db.settings || typeof db.settings !== 'object') db.settings = {};
if (!db.settings.tether || typeof db.settings.tether !== 'object') db.settings.tether = {};

// ═══════════════════════════════════
//  DATABASE OPERATIONS
// ═══════════════════════════════════

export const database = {
  logUser(username, profile, server, createdById, createdByName, price = 0) {
    const entry = {
      id: db.nextId++,
      username,
      profile,
      server,
      price,
      created_by_id: createdById,
      created_by_name: createdByName,
      created_at: new Date().toISOString(),
      is_deleted: false,
      deleted_at: null,
      // Income hanya dihitung saat user pertama login
      activated: false,
      activated_at: null,
    };
    db.users.push(entry);
    saveDB(db);
    return entry;
  },

  logBatchUsers(users) {
    for (const u of users) {
      const entry = {
        id: db.nextId++,
        username: u.username,
        profile: u.profile,
        server: u.server,
        price: u.price || 0,
        created_by_id: u.createdById,
        created_by_name: u.createdByName,
        created_at: new Date().toISOString(),
        is_deleted: false,
        deleted_at: null,
        activated: false,
        activated_at: null,
      };
      db.users.push(entry);
    }
    saveDB(db);
  },

  markDeleted(username) {
    const user = db.users.find((u) => u.username === username && !u.is_deleted);
    if (user) {
      user.is_deleted = true;
      user.deleted_at = new Date().toISOString();
      saveDB(db);
    }
  },

  // ═══════════════════════════════════
  //  ACTIVATION (user pertama kali login)
  // ═══════════════════════════════════

  activateUser(username) {
    const user = db.users.find((u) => u.username === username && !u.activated && !u.is_deleted);
    if (user) {
      user.activated = true;
      user.activated_at = new Date().toISOString();
      saveDB(db);
      return user;
    }
    return null;
  },

  getInactiveUsers() {
    return db.users.filter((u) => !u.activated && !u.is_deleted);
  },

  // ═══════════════════════════════════
  //  QUERIES
  // ═══════════════════════════════════

  getRecentUsers(limit = 20) {
    return db.users
      .filter((u) => !u.is_deleted)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  },

  getActiveUsers() {
    return db.users.filter((u) => !u.is_deleted);
  },

  getByProfile(profile, limit = 50) {
    return db.users
      .filter((u) => !u.is_deleted && u.profile === profile)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  },

  getStats() {
    const total_created = db.users.length;
    const active = db.users.filter((u) => !u.is_deleted).length;
    const deleted = db.users.filter((u) => u.is_deleted).length;
    const activated = db.users.filter((u) => u.activated).length;
    const pending = db.users.filter((u) => !u.activated && !u.is_deleted).length;
    return { total_created, active, deleted, activated, pending };
  },

  // ═══════════════════════════════════
  //  INCOME TRACKING (hanya user yang sudah activated)
  // ═══════════════════════════════════

  getIncomeToday(todayStr) {
    return db.users
      .filter((u) => u.activated && u.activated_at?.startsWith(todayStr))
      .reduce((sum, u) => sum + (u.price || 0), 0);
  },

  getIncomeByDateRange(startStr, endStr) {
    return db.users
      .filter((u) => u.activated && u.activated_at >= startStr && u.activated_at <= endStr)
      .reduce((sum, u) => sum + (u.price || 0), 0);
  },

  getIncomeByProfile(startStr, endStr) {
    const result = {};
    db.users
      .filter((u) => u.activated && u.activated_at >= startStr && u.activated_at <= endStr)
      .forEach((u) => {
        if (!result[u.profile]) {
          result[u.profile] = { count: 0, income: 0 };
        }
        result[u.profile].count++;
        result[u.profile].income += (u.price || 0);
      });
    return result;
  },

  getTotalIncome() {
    return db.users
      .filter((u) => u.activated)
      .reduce((sum, u) => sum + (u.price || 0), 0);
  },

  // ═══════════════════════════════════
  //  TETHER ABUSE TRACKING
  // ═══════════════════════════════════

  getTetherState(username) {
    return db.tether[username] || null;
  },

  /**
   * Record tether hit. Returns { shouldNotify, state }.
   * shouldNotify respects cooldown minutes.
   */
  recordTetherHit(username, { address, mac, cooldownMin = 10 } = {}) {
    const now = Date.now();
    const prev = db.tether[username] || {
      count: 0,
      lastAt: null,
      lastNotifiedAt: null,
      punishUntil: null,
      originalComment: null,
      lastAddress: null,
      lastMac: null,
    };

    prev.count = (prev.count || 0) + 1;
    prev.lastAt = new Date(now).toISOString();
    prev.lastAddress = address || prev.lastAddress;
    prev.lastMac = mac || prev.lastMac;

    const lastNotified = prev.lastNotifiedAt ? new Date(prev.lastNotifiedAt).getTime() : 0;
    const shouldNotify = !lastNotified || now - lastNotified >= cooldownMin * 60 * 1000;
    if (shouldNotify) {
      prev.lastNotifiedAt = new Date(now).toISOString();
    }

    db.tether[username] = prev;
    db.tetherEvents.push({
      username,
      address: address || null,
      mac: mac || null,
      at: prev.lastAt,
      notified: shouldNotify,
    });
    // keep last 500 events
    if (db.tetherEvents.length > 500) {
      db.tetherEvents = db.tetherEvents.slice(-500);
    }
    saveDB(db);
    return { shouldNotify, state: prev };
  },

  setTetherPunish(username, punishUntilIso, originalComment = null) {
    if (!db.tether[username]) {
      db.tether[username] = {
        count: 0,
        lastAt: null,
        lastNotifiedAt: null,
        punishUntil: null,
        originalComment: null,
        lastAddress: null,
        lastMac: null,
      };
    }
    db.tether[username].punishUntil = punishUntilIso;
    if (originalComment !== null && db.tether[username].originalComment == null) {
      db.tether[username].originalComment = originalComment;
    }
    saveDB(db);
    return db.tether[username];
  },

  clearTetherPunish(username) {
    if (!db.tether[username]) return null;
    db.tether[username].punishUntil = null;
    const comment = db.tether[username].originalComment;
    db.tether[username].originalComment = null;
    saveDB(db);
    return comment;
  },

  getExpiredTetherPunishments() {
    const now = Date.now();
    return Object.entries(db.tether)
      .filter(([, s]) => s.punishUntil && new Date(s.punishUntil).getTime() <= now)
      .map(([username, state]) => ({ username, state }));
  },

  getTetherStats() {
    const users = Object.keys(db.tether).length;
    const totalHits = Object.values(db.tether).reduce((s, t) => s + (t.count || 0), 0);
    const activePunish = Object.values(db.tether).filter(
      (t) => t.punishUntil && new Date(t.punishUntil).getTime() > Date.now()
    ).length;
    return { users, totalHits, activePunish, events: db.tetherEvents.length };
  },

  getRecentTetherEvents(limit = 10) {
    return (db.tetherEvents || []).slice(-limit).reverse();
  },

  getAllTetherStates() {
    return { ...db.tether };
  },

  resetTetherUser(username) {
    if (!db.tether[username]) return false;
    delete db.tether[username];
    saveDB(db);
    return true;
  },

  resetAllTether() {
    db.tether = {};
    db.tetherEvents = [];
    saveDB(db);
  },

  // ═══════════════════════════════════
  //  SETTINGS (runtime, persist di JSON)
  // ═══════════════════════════════════

  getSettings() {
    return db.settings || { tether: {} };
  },

  setSettings(partial) {
    if (!db.settings) db.settings = {};
    if (partial.tether) {
      db.settings.tether = { ...(db.settings.tether || {}), ...partial.tether };
    }
    // future top-level keys
    for (const [k, v] of Object.entries(partial)) {
      if (k === 'tether') continue;
      db.settings[k] = v;
    }
    saveDB(db);
    return db.settings;
  },
};
