import { createBot } from './bot.js';
import { mikrotik } from './mikrotik.js';
import { config } from './config.js';
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

// ═══════════════════════════════════
//  INITIALIZE BOT
// ═══════════════════════════════════

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
