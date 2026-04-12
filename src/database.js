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
  return { users: [], nextId: 1 };
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Initialize
let db = loadDB();

// ═══════════════════════════════════
//  DATABASE OPERATIONS
// ═══════════════════════════════════

export const database = {
  logUser(username, profile, server, createdById, createdByName) {
    const entry = {
      id: db.nextId++,
      username,
      profile,
      server,
      created_by_id: createdById,
      created_by_name: createdByName,
      created_at: new Date().toISOString(),
      is_deleted: false,
      deleted_at: null,
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
        created_by_id: u.createdById,
        created_by_name: u.createdByName,
        created_at: new Date().toISOString(),
        is_deleted: false,
        deleted_at: null,
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

  getRecentUsers(limit = 20) {
    return db.users
      .filter((u) => !u.is_deleted)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
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
    return { total_created, active, deleted };
  },
};
