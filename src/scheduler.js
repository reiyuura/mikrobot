import { mikrotik } from './mikrotik.js';
import { database } from './database.js';
import { config } from './config.js';
import { getProfile, now, formatCurrency } from './utils.js';

const CHECK_INTERVAL = 60 * 60 * 1000; // 1 jam (cleanup/activation)
let schedulerTimer = null;
let tetherTimer = null;
let notifyFn = null;

// ═══════════════════════════════════
//  1) CHECK FIRST-LOGIN (ACTIVATION)
// ═══════════════════════════════════

async function checkActivations() {
  try {
    const sessions = await mikrotik.getActiveSessions();
    const inactiveUsers = database.getInactiveUsers();

    if (inactiveUsers.length === 0 || sessions.length === 0) return [];

    const activeNames = new Set(sessions.map((s) => s.user));
    const activated = [];

    for (const user of inactiveUsers) {
      if (activeNames.has(user.username)) {
        const result = database.activateUser(user.username);
        if (result) activated.push(result);
      }
    }

    if (activated.length > 0) {
      const totalIncome = activated.reduce((sum, u) => sum + (u.price || 0), 0);
      console.log(`💰 ${activated.length} user baru login → +${totalIncome} income`);

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
          const mtUser = await mikrotik.getUserByName(user.username);
          if (mtUser) {
            const sessions = await mikrotik.getActiveSessions();
            const activeSession = sessions.find((s) => s.user === user.username);
            if (activeSession) {
              await mikrotik.kickUser(activeSession['.id']);
            }
            await mikrotik.removeUser(mtUser['.id']);
          }

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
//  3) TETHER ABUSE DETECT + NOTIFY
//  address-list mikrobot-tether ← filter mark
//  map IP → active hotspot session → user
//  Admin: Telegram notif
//  User: kick + disable sementara (internet putus)
// ═══════════════════════════════════

async function restoreExpiredPunishments() {
  const expired = database.getExpiredTetherPunishments();
  if (!expired.length) return;

  for (const { username, state } of expired) {
    try {
      const mtUser = await mikrotik.getUserByName(username);
      if (mtUser && mtUser.disabled === 'true') {
        const original = database.clearTetherPunish(username);
        const comment =
          original ||
          (mtUser.comment || '').replace(/\s*\|?\s*TETHER-BAN until [^\|]+/g, '').trim();
        await mikrotik.setUserDisabled(mtUser['.id'], false, comment || mtUser.comment);
        console.log(`🔓 Tether punish ended, re-enabled: ${username}`);

        if (notifyFn) {
          await notifyFn(
            `🔓 <b>Tether ban berakhir</b>\n` +
              `User <code>${username}</code> diaktifkan lagi.\n` +
              `📅 ${now().format('DD MMM YYYY, HH:mm [WIB]')}`
          );
        }
      } else {
        database.clearTetherPunish(username);
      }
    } catch (err) {
      console.error(`⚠️  Failed restore punish ${username}:`, err.message);
    }
  }
}

async function checkTetherAbuse() {
  if (!config.antiTether) return;

  try {
    await restoreExpiredPunishments();

    const offenders = await mikrotik.getAddressList(config.tetherList);
    if (!offenders.length) return;

    const sessions = await mikrotik.getActiveSessions();
    const byAddress = new Map(sessions.map((s) => [s.address, s]));

    // Group by resolved username (or raw IP if no session)
    const hits = [];
    for (const entry of offenders) {
      const address = entry.address;
      const session = byAddress.get(address);
      hits.push({
        address,
        listId: entry['.id'],
        username: session?.user || null,
        mac: session?.['mac-address'] || null,
        uptime: session?.uptime || null,
        creationTime: entry['creation-time'] || null,
      });
    }

    // Process unique users / IPs this tick
    const seen = new Set();
    for (const hit of hits) {
      const key = hit.username || `ip:${hit.address}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (!hit.username) {
        // No active session for this IP — still notify admin once per cooldown under pseudo key
        const { shouldNotify, state } = database.recordTetherHit(`ip:${hit.address}`, {
          address: hit.address,
          mac: null,
          cooldownMin: config.tetherNotifyCooldownMin,
        });
        if (shouldNotify && notifyFn) {
          await notifyFn(
            `🚨 <b>Tether attempt (IP tanpa session)</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `🌐 IP: <code>${hit.address}</code>\n` +
              `📊 Hit ke-${state.count}\n` +
              `📅 ${now().format('DD MMM YYYY, HH:mm [WIB]')}\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `<i>Session sudah logout / IP residual di address-list</i>`
          );
        }
        // cleanup residual list entry so it doesn't spam forever
        try {
          await mikrotik.removeAddressListEntry(hit.listId);
        } catch {
          /* ignore */
        }
        continue;
      }

      const { shouldNotify, state } = database.recordTetherHit(hit.username, {
        address: hit.address,
        mac: hit.mac,
        cooldownMin: config.tetherNotifyCooldownMin,
      });

      let punishAction = 'none';
      let punishUntilText = '-';

      if (config.tetherAutoPunish) {
        try {
          // Kick active session → user instantly loses internet (their "notification")
          const kicked = await mikrotik.kickUserByName(hit.username);
          punishAction = kicked > 0 ? 'kick' : 'kick-miss';

          // Disable account for N minutes so re-login fails
          const mtUser = await mikrotik.getUserByName(hit.username);
          if (mtUser) {
            const until = new Date(Date.now() + config.tetherPunishMin * 60 * 1000);
            punishUntilText = now()
              .add(config.tetherPunishMin, 'minute')
              .format('HH:mm [WIB]');
            const untilIso = until.toISOString();
            const originalComment = mtUser.comment || '';
            const banTag = `TETHER-BAN until ${until.toISOString()}`;
            const newComment = originalComment.includes('TETHER-BAN')
              ? originalComment.replace(/TETHER-BAN until [^\|]+/, banTag)
              : `${originalComment}${originalComment ? ' | ' : ''}${banTag}`;

            await mikrotik.setUserDisabled(mtUser['.id'], true, newComment);
            database.setTetherPunish(hit.username, untilIso, originalComment);
            punishAction = kicked > 0 ? 'kick+disable' : 'disable';
          }
        } catch (err) {
          console.error(`⚠️  Tether punish failed ${hit.username}:`, err.message);
          punishAction = `error: ${err.message}`;
        }
      }

      // Remove address-list entry so next attempt is a fresh hit
      try {
        await mikrotik.removeAddressListEntry(hit.listId);
      } catch {
        /* ignore */
      }

      console.log(
        `🚨 Tether: ${hit.username} @ ${hit.address} hits=${state.count} action=${punishAction} notify=${shouldNotify}`
      );

      if (shouldNotify && notifyFn) {
        let msg = `🚨 <b>TETHER / HOTSPOT SHARE DETECTED</b>\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `👤 User : <code>${hit.username}</code>\n`;
        msg += `🌐 IP   : <code>${hit.address}</code>\n`;
        msg += `📱 MAC  : <code>${hit.mac || '-'}</code>\n`;
        msg += `⏱ Up   : ${hit.uptime || '-'}\n`;
        msg += `📊 Hit  : ke-${state.count}\n`;
        msg += `🛡 Aksi : <b>${punishAction}</b>\n`;
        if (punishAction.includes('disable')) {
          msg += `⏳ Ban  : ${config.tetherPunishMin} menit (sampai ${punishUntilText})\n`;
        }
        msg += `📅 ${now().format('DD MMM YYYY, HH:mm [WIB]')}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `<i>User di-kick. Internet mati ${config.tetherPunishMin} menit = "notif" ke user (voucher gak punya Telegram).</i>`;
        await notifyFn(msg);
      }
    }
  } catch (error) {
    console.error('⚠️  Tether check error:', error.message);
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

  // Hourly jobs
  schedulerTick();
  schedulerTimer = setInterval(schedulerTick, CHECK_INTERVAL);

  // Fast tether poll (respect runtime config)
  restartTetherMonitor();
}

/** Restart tether poll timer from current config (call after /tether set poll/on/off). */
export function restartTetherMonitor() {
  if (tetherTimer) {
    clearInterval(tetherTimer);
    tetherTimer = null;
  }

  if (!config.antiTether) {
    console.log('🛡  Tether monitor OFF');
    return { enabled: false };
  }

  const seconds = Math.max(10, Number(config.tetherPollSeconds) || 30);
  const ms = seconds * 1000;
  console.log(
    `🛡  Tether monitor ON (poll ${seconds}s, punish ${config.tetherPunishMin}m, cooldown ${config.tetherNotifyCooldownMin}m, autopunish ${config.tetherAutoPunish})`
  );
  checkTetherAbuse();
  tetherTimer = setInterval(checkTetherAbuse, ms);
  return {
    enabled: true,
    pollSeconds: seconds,
    punishMin: config.tetherPunishMin,
    cooldownMin: config.tetherNotifyCooldownMin,
    autoPunish: config.tetherAutoPunish,
  };
}

/** Manual one-shot scan (for /tether scan). */
export async function runTetherScanNow() {
  await checkTetherAbuse();
}

export function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  if (tetherTimer) {
    clearInterval(tetherTimer);
    tetherTimer = null;
  }
  console.log('⏰ Scheduler stopped.');
}
