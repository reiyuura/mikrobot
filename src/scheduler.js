import { mikrotik } from './mikrotik.js';
import { database } from './database.js';
import { config, isTetherWhitelisted } from './config.js';
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
//  map IP → hotspot session OR DHCP lease
//  Admin: Telegram notif
//  Hotspot user: kick + disable sementara
//  Tetangga DHCP: block lease sementara
// ═══════════════════════════════════

function detectSegment(address) {
  if (!address) return 'unknown';
  if (String(address).startsWith('192.168.20.')) return 'hotspot';
  if (String(address).startsWith('192.168.30.')) return 'tetangga';
  return 'unknown';
}

function segmentLabel(seg) {
  if (seg === 'hotspot') return 'Hotspot voucher';
  if (seg === 'tetangga') return 'WiFi tetangga';
  return seg;
}

async function restoreExpiredPunishments() {
  const expired = database.getExpiredTetherPunishments();
  if (!expired.length) return;

  for (const { username, state } of expired) {
    try {
      // Hotspot user restore
      if (!username.startsWith('dhcp:') && !username.startsWith('ip:')) {
        const mtUser = await mikrotik.getUserByName(username);
        if (mtUser && mtUser.disabled === 'true') {
          const original = database.clearTetherPunish(username);
          const comment =
            original ||
            (mtUser.comment || '').replace(/\s*\|?\s*TETHER-BAN until [^\|]+/g, '').trim();
          await mikrotik.setUserDisabled(mtUser['.id'], false, comment || mtUser.comment);
          console.log(`🔓 Tether punish ended, re-enabled hotspot: ${username}`);
          if (notifyFn) {
            await notifyFn(
              `🔓 <b>Tether ban berakhir</b>\n` +
                `User hotspot <code>${username}</code> diaktifkan lagi.\n` +
                `📅 ${now().format('DD MMM YYYY, HH:mm [WIB]')}`
            );
          }
          continue;
        }
      }

      // DHCP lease restore (tetangga): key = dhcp:MAC or dhcp:IP
      if (username.startsWith('dhcp:')) {
        const address = state?.lastAddress;
        if (address) {
          const res = await mikrotik.unpunishDhcpAddress(address);
          console.log(`🔓 Tether punish ended, unpunish DHCP ${address}:`, res);
          if (notifyFn) {
            await notifyFn(
              `🔓 <b>Tether ban berakhir</b>\n` +
                `Device tetangga <code>${address}</code> diaktifkan lagi.\n` +
                `📅 ${now().format('DD MMM YYYY, HH:mm [WIB]')}`
            );
          }
        }
        database.clearTetherPunish(username);
        continue;
      }

      database.clearTetherPunish(username);
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

    let leases = [];
    try {
      leases = await mikrotik.getDhcpLeases();
    } catch {
      leases = [];
    }
    const leaseByAddress = new Map();
    for (const l of leases) {
      const a = l['active-address'] || l.address;
      if (a) leaseByAddress.set(a, l);
    }

    const hits = [];
    for (const entry of offenders) {
      const address = entry.address;
      const session = byAddress.get(address);
      const lease = leaseByAddress.get(address);
      const segment = detectSegment(address);

      let identity = null;
      let mac = null;
      let uptime = null;
      let kind = 'unknown';

      if (session) {
        identity = session.user;
        mac = session['mac-address'] || null;
        uptime = session.uptime || null;
        kind = 'hotspot';
      } else if (lease) {
        mac = lease['active-mac-address'] || lease['mac-address'] || null;
        identity = `dhcp:${mac || address}`;
        uptime = lease['last-seen'] || lease.age || null;
        kind = 'dhcp';
      } else {
        identity = null;
        kind = segment === 'tetangga' ? 'dhcp' : 'unknown';
      }

      hits.push({
        address,
        listId: entry['.id'],
        username: identity,
        mac,
        uptime,
        segment,
        kind,
        hostName: lease?.['host-name'] || null,
        leaseId: lease?.['.id'] || null,
        creationTime: entry['creation-time'] || null,
      });
    }

    const seen = new Set();
    for (const hit of hits) {
      const key = hit.username || `ip:${hit.address}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Secondary AP/router whitelist (TL-WR840N dll) — skip ban + notif
      if (isTetherWhitelisted({ address: hit.address, mac: hit.mac })) {
        try {
          await mikrotik.removeAddressListEntry(hit.listId);
        } catch {
          /* ignore */
        }
        // also clear accidental ban list
        try {
          await mikrotik.unpunishDhcpAddress(hit.address);
        } catch {
          /* ignore */
        }
        console.log(
          `⏭  Tether whitelist skip: ${hit.address} (${hit.mac || hit.hostName || '-'})`
        );
        continue;
      }

      // Unknown IP residual
      if (!hit.username) {
        const { shouldNotify, state } = database.recordTetherHit(`ip:${hit.address}`, {
          address: hit.address,
          mac: hit.mac,
          cooldownMin: config.tetherNotifyCooldownMin,
        });
        if (shouldNotify && notifyFn) {
          await notifyFn(
            `🚨 <b>Tether attempt (${segmentLabel(hit.segment)})</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `🌐 IP: <code>${hit.address}</code>\n` +
              `📍 Seg: ${segmentLabel(hit.segment)}\n` +
              `📊 Hit ke-${state.count}\n` +
              `📅 ${now().format('DD MMM YYYY, HH:mm [WIB]')}\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `<i>IP residual / session sudah logout</i>`
          );
        }
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
          if (hit.kind === 'hotspot') {
            const kicked = await mikrotik.kickUserByName(hit.username);
            punishAction = kicked > 0 ? 'kick' : 'kick-miss';

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
          } else if (hit.kind === 'dhcp') {
            // Ban IP via address-list + disable lease (if any)
            const res = await mikrotik.punishDhcpAddress(hit.address, {
              minutes: config.tetherPunishMin,
            });
            const until = new Date(Date.now() + config.tetherPunishMin * 60 * 1000);
            punishUntilText = now()
              .add(config.tetherPunishMin, 'minute')
              .format('HH:mm [WIB]');
            database.setTetherPunish(hit.username, until.toISOString(), null);
            if (res.banListed && res.leaseDisabled) punishAction = 'ban+disable-lease';
            else if (res.banListed) punishAction = 'ip-ban';
            else if (res.leaseDisabled) punishAction = 'disable-lease';
            else punishAction = `dhcp-fail: ${res.banError || res.leaseError || 'unknown'}`;
          }
        } catch (err) {
          console.error(`⚠️  Tether punish failed ${hit.username}:`, err.message);
          punishAction = `error: ${err.message}`;
        }
      }

      try {
        await mikrotik.removeAddressListEntry(hit.listId);
      } catch {
        /* ignore */
      }

      console.log(
        `🚨 Tether [${hit.segment}/${hit.kind}]: ${hit.username} @ ${hit.address} hits=${state.count} action=${punishAction} notify=${shouldNotify}`
      );

      if (shouldNotify && notifyFn) {
        let msg = `🚨 <b>TETHER DETECTED</b>\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `📍 Seg  : <b>${segmentLabel(hit.segment)}</b>\n`;
        msg += `👤 ID   : <code>${hit.username}</code>\n`;
        if (hit.hostName) msg += `🖥 Host : <code>${hit.hostName}</code>\n`;
        msg += `🌐 IP   : <code>${hit.address}</code>\n`;
        msg += `📱 MAC  : <code>${hit.mac || '-'}</code>\n`;
        msg += `⏱ Seen : ${hit.uptime || '-'}\n`;
        msg += `📊 Hit  : ke-${state.count}\n`;
        msg += `🛡 Aksi : <b>${punishAction}</b>\n`;
        if (punishAction.includes('disable') || punishAction.includes('ban') || punishAction === 'dhcp-block') {
          msg += `⏳ Ban  : ${config.tetherPunishMin} menit (sampai ${punishUntilText})\n`;
        }
        msg += `📅 ${now().format('DD MMM YYYY, HH:mm [WIB]')}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
        if (hit.kind === 'hotspot') {
          msg += `<i>Voucher di-kick + disable ${config.tetherPunishMin} menit.</i>`;
        } else {
          msg += `<i>Device tetangga di-block lease ${config.tetherPunishMin} menit (max 5 device).</i>`;
        }
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
