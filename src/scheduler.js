import { mikrotik } from './mikrotik.js';
import { database } from './database.js';
import { getProfile, now, formatCurrency } from './utils.js';

const CHECK_INTERVAL = 60 * 60 * 1000; // 1 jam
let schedulerTimer = null;
let notifyFn = null;

// ═══════════════════════════════════
//  1) CHECK FIRST-LOGIN (ACTIVATION)
//  Cek active sessions, tandai user yang
//  baru pertama kali login → income masuk
// ═══════════════════════════════════

async function checkActivations() {
  try {
    const sessions = await mikrotik.getActiveSessions();
    const inactiveUsers = database.getInactiveUsers();

    if (inactiveUsers.length === 0 || sessions.length === 0) return [];

    // Set of currently active usernames
    const activeNames = new Set(sessions.map((s) => s.user));
    const activated = [];

    for (const user of inactiveUsers) {
      if (activeNames.has(user.username)) {
        const result = database.activateUser(user.username);
        if (result) {
          activated.push(result);
        }
      }
    }

    if (activated.length > 0) {
      const totalIncome = activated.reduce((sum, u) => sum + (u.price || 0), 0);
      console.log(`💰 ${activated.length} user baru login → +${totalIncome} income`);

      // Notify admin
      if (notifyFn && totalIncome > 0) {
        let msg = `💰 <b>User Login Terdeteksi!</b>\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `📅 ${now().format('DD MMM YYYY, HH:mm [WIB]')}\n\n`;

        for (const u of activated) {
          const p = getProfile(u.profile);
          msg += `✅ <code>${u.username}</code> — ${p?.label || u.profile} (${formatCurrency(u.price || 0)})\n`;
        }

        msg += `\n💵 <b>+${formatCurrency(totalIncome)}</b>`;
        msg += `\n━━━━━━━━━━━━━━━━━━━━━━━`;
        await notifyFn(msg);
      }
    }

    return activated;
  } catch (error) {
    console.error('⚠️  Activation check error:', error.message);
    return [];
  }
}

// ═══════════════════════════════════
//  2) AUTO-CLEANUP EXPIRED USERS
//  Hapus user yang sudah melewati
//  validity period
// ═══════════════════════════════════

async function cleanupExpiredUsers() {
  try {
    const activeUsers = database.getActiveUsers();
    const deletedUsers = [];

    for (const user of activeUsers) {
      const profile = getProfile(user.profile);
      if (!profile || !profile.validityDays) continue;

      const createdAt = new Date(user.created_at);
      const expiresAt = new Date(createdAt.getTime() + profile.validityDays * 24 * 60 * 60 * 1000);
      const currentTime = new Date();

      if (currentTime >= expiresAt) {
        try {
          // Find user on MikroTik and delete
          const mtUser = await mikrotik.getUserByName(user.username);
          if (mtUser) {
            // Kick active session if any
            const sessions = await mikrotik.getActiveSessions();
            const activeSession = sessions.find((s) => s.user === user.username);
            if (activeSession) {
              await mikrotik.kickUser(activeSession['.id']);
            }
            // Delete from MikroTik
            await mikrotik.removeUser(mtUser['.id']);
          }

          // Mark as deleted in database
          database.markDeleted(user.username);
          deletedUsers.push({
            username: user.username,
            profile: user.profile,
            createdAt: user.created_at,
          });
        } catch (err) {
          console.error(`⚠️  Failed to cleanup user ${user.username}:`, err.message);
        }
      }
    }

    if (deletedUsers.length > 0) {
      console.log(`🧹 Auto-cleanup: ${deletedUsers.length} user(s) expired and removed.`);

      // Notify admin via Telegram
      if (notifyFn) {
        let msg = `🧹 <b>Auto-Cleanup Report</b>\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `📅 ${now().format('DD MMM YYYY, HH:mm [WIB]')}\n\n`;
        msg += `<b>${deletedUsers.length} user expired dihapus:</b>\n\n`;

        for (const u of deletedUsers) {
          const p = getProfile(u.profile);
          msg += `• <code>${u.username}</code> — ${p?.label || u.profile}\n`;
        }

        msg += `\n━━━━━━━━━━━━━━━━━━━━━━━`;
        await notifyFn(msg);
      }
    }
  } catch (error) {
    console.error('❌ Cleanup error:', error.message);
  }
}

// ═══════════════════════════════════
//  MAIN SCHEDULER TICK
// ═══════════════════════════════════

async function schedulerTick() {
  await checkActivations();
  await cleanupExpiredUsers();
}

// ═══════════════════════════════════
//  START / STOP
// ═══════════════════════════════════

export function startScheduler(notifyCallback) {
  notifyFn = notifyCallback;

  console.log('⏰ Scheduler started (activation check + auto-cleanup, interval: 1 hour)');

  // Run immediately on startup
  schedulerTick();

  // Then every hour
  schedulerTimer = setInterval(schedulerTick, CHECK_INTERVAL);
}

export function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('⏰ Scheduler stopped.');
  }
}
