import { mikrotik } from './mikrotik.js';
import { database } from './database.js';
import { getProfile, now } from './utils.js';

const CHECK_INTERVAL = 60 * 60 * 1000; // 1 jam
let schedulerTimer = null;
let notifyFn = null;

// ═══════════════════════════════════
//  AUTO-CLEANUP SCHEDULER
//  Cek setiap 1 jam, hapus user yang
//  sudah melewati validity period
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
    console.error('❌ Scheduler error:', error.message);
  }
}

// ═══════════════════════════════════
//  START / STOP
// ═══════════════════════════════════

export function startScheduler(notifyCallback) {
  notifyFn = notifyCallback;

  // Run immediately on startup
  console.log('⏰ Auto-cleanup scheduler started (interval: 1 hour)');
  cleanupExpiredUsers();

  // Then every hour
  schedulerTimer = setInterval(cleanupExpiredUsers, CHECK_INTERVAL);
}

export function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('⏰ Scheduler stopped.');
  }
}
