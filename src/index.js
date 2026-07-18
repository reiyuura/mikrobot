import { createBot } from './bot.js';
import { mikrotik } from './mikrotik.js';
import { config, applyTetherSettingsFromDb, getTetherRuntime, getAntiTetherSegments } from './config.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { registerStart } from './commands/start.js';
import { registerAddUser } from './commands/adduser.js';
import { registerVoucher } from './commands/voucher.js';
import { registerListUser } from './commands/listuser.js';
import { registerDeleteUser } from './commands/deleteuser.js';
import { registerActiveUser } from './commands/activeuser.js';
import { registerServerInfo } from './commands/serverinfo.js';
import { registerIncome } from './commands/income.js';
import { registerHelp } from './commands/help.js';
import { registerReboot } from './commands/reboot.js';
import { registerTether } from './commands/tether.js';

// ═══════════════════════════════════
//  INITIALIZE BOT
// ═══════════════════════════════════

// Apply persisted /tether settings before anything else
applyTetherSettingsFromDb();

const bot = createBot();

// Register all commands
registerStart(bot);
registerAddUser(bot);
registerVoucher(bot);
registerListUser(bot);
registerDeleteUser(bot);
registerActiveUser(bot);
registerServerInfo(bot);
registerIncome(bot);
registerReboot(bot);
registerTether(bot);
registerHelp(bot);

// ═══════════════════════════════════
//  STARTUP
// ═══════════════════════════════════

async function main() {
  console.log('🤖 MikroBot starting...');

  // Test router connection
  console.log('📡 Testing router connection...');
  const isOnline = await mikrotik.ping();

  if (isOnline) {
    console.log('✅ Router is reachable!');

    // Anti-tether + MAC bind (idempotent)
    if (config.antiTether) {
      try {
        console.log('🛡  Ensuring anti-tether rules...');
        const segments = getAntiTetherSegments();
        const anti = await mikrotik.ensureAntiTether({
          segments,
          tetherList: config.tetherList,
          tetherListTimeout: config.tetherListTimeout,
        });
        for (const [name, seg] of Object.entries(anti.segments || {})) {
          console.log(
            `   [${name}] TTL: ${seg.ttlMangle} | mark63: ${seg.markTtl63} | drop63: ${seg.dropTtl63} | mark127: ${seg.markTtl127} | drop127: ${seg.dropTtl127}`
          );
        }
        if (anti.errors.length) {
          console.warn('   anti-tether warnings:', anti.errors.join('; '));
        }

        // Lock tetangga DHCP pool to max devices (default 5)
        if (config.antiTetherTetangga) {
          try {
            const pool = await mikrotik.ensurePoolMaxDevices(
              config.tetanggaPoolName,
              config.tetanggaMaxDevices
            );
            console.log(
              `   [tetangga] pool ${config.tetanggaPoolName}: ${pool.status}` +
                (pool.to ? ` ${pool.from} → ${pool.to}` : pool.ranges ? ` ${pool.ranges}` : '')
            );
          } catch (err) {
            console.warn('   pool lock warning:', err.message);
          }
        }

        // Whitelist secondary AP/router (TL-WR840N) — no ban, TTL normal
        if (config.tetherWhitelistIps.length || config.tetherWhitelistMacs.length) {
          try {
            const wl = await mikrotik.ensureTetherWhitelist({
              ips: config.tetherWhitelistIps,
              macs: config.tetherWhitelistMacs,
            });
            console.log(
              `   [whitelist] accept=${wl.acceptRule} mangle=${wl.mangleSkip} ips=${wl.ips
                .map((x) => `${x.ip}:${x.status}`)
                .join(',') || '-'}`
            );
            if (wl.errors.length) {
              console.warn('   whitelist warnings:', wl.errors.join('; '));
            }
          } catch (err) {
            console.warn('   whitelist warning:', err.message);
          }
        }

        const mac = await mikrotik.ensureMacBindOnProfiles();
        if (mac.updated.length) {
          console.log(`   MAC bind added on profiles: ${mac.updated.join(', ')}`);
        } else {
          console.log(`   MAC bind already set (${mac.skipped.join(', ') || 'none'})`);
        }
        if (mac.errors?.length) {
          console.warn('   MAC bind warnings:', mac.errors.join('; '));
        }
      } catch (err) {
        console.warn('⚠️  Anti-tether setup failed:', err.message);
      }
    } else {
      console.log('🛡  Anti-tether disabled (ANTI_TETHER=false)');
    }
  } else {
    console.warn('⚠️  Router is NOT reachable. Bot will start anyway.');
    console.warn('   Make sure WireGuard tunnel is active and REST API is enabled.');
  }

  // Set bot commands menu (non-critical, don't crash on failure)
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Menu Utama' },
      { command: 'adduser', description: 'Tambah User Hotspot' },
      { command: 'voucher', description: 'Generate Batch Voucher' },
      { command: 'listuser', description: 'Lihat Semua User' },
      { command: 'deleteuser', description: 'Hapus User' },
      { command: 'active', description: 'User Yang Sedang Online' },
      { command: 'info', description: 'Info Server MikroTik' },
      { command: 'income', description: 'Laporan Pendapatan' },
      { command: 'tether', description: 'Setting Anti-Tether' },
      { command: 'reboot', description: 'Reboot MikroTik' },
      { command: 'help', description: 'Panduan' },
    ]);
    console.log('📋 Bot commands registered.');
  } catch (err) {
    console.warn('⚠️  Failed to set bot commands:', err.message);
    console.warn('   Bot will still start. Commands can be set later.');
  }

  // Start auto-cleanup scheduler
  startScheduler(async (msg) => {
    // Send cleanup notifications to all admins
    for (const adminId of config.adminIds) {
      try {
        await bot.api.sendMessage(adminId, msg, { parse_mode: 'HTML' });
      } catch {
        // Admin may have blocked the bot
      }
    }
  });

  // Start polling
  bot.start({
    onStart: () => {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ MikroBot is running!');
      console.log('⏰ Auto-cleanup: ON');
      if (config.antiTether) {
        console.log(
          `🛡  Anti-tether + notif: ON (poll ${getTetherRuntime().pollSeconds}s)`
        );
      } else {
        console.log('🛡  Anti-tether: OFF');
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━');
    },
  });
}

main().catch((err) => {
  console.error('❌ Failed to start MikroBot:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down MikroBot...');
  stopScheduler();
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down MikroBot...');
  stopScheduler();
  bot.stop();
  process.exit(0);
});
