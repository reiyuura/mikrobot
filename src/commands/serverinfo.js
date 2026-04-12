import { InlineKeyboard } from 'grammy';
import { mikrotik } from '../mikrotik.js';
import { database } from '../database.js';
import { formatMemory } from '../utils.js';

// ═══════════════════════════════════
//  SHOW SERVER INFO
// ═══════════════════════════════════

async function showServerInfo(ctx, edit = false) {
  try {
    const [resource, users, actives] = await Promise.all([
      mikrotik.getSystemResource(),
      mikrotik.getUsers(),
      mikrotik.getActiveSessions(),
    ]);

    const dbStats = database.getStats();

    const text =
      `📊 <b>Server Info — MikroTik</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `\n<b>🖥 System</b>\n` +
      `   Board    : ${resource['board-name'] || '-'}\n` +
      `   Version  : RouterOS ${resource.version || '-'}\n` +
      `   Arch     : ${resource['architecture-name'] || '-'}\n` +
      `   Uptime   : ${resource.uptime || '-'}\n` +
      `   CPU Load : ${resource['cpu-load'] || '-'}%\n` +
      `   Memory   : ${formatMemory(resource['free-memory'], resource['total-memory'])}\n` +
      `\n<b>📡 Hotspot</b>\n` +
      `   Total User   : ${users.length}\n` +
      `   User Online  : ${actives.length}\n` +
      `\n<b>📁 Database Bot</b>\n` +
      `   Total Dibuat  : ${dbStats?.total_created || 0}\n` +
      `   Aktif (di DB) : ${dbStats?.active || 0}\n` +
      `   Dihapus       : ${dbStats?.deleted || 0}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━`;

    const keyboard = new InlineKeyboard().text('🔄 Refresh', 'info:refresh');

    if (edit) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
  } catch (error) {
    const msg = `❌ Gagal mengambil info server:\n<code>${error.message}</code>`;
    edit
      ? await ctx.editMessageText(msg, { parse_mode: 'HTML' })
      : await ctx.reply(msg, { parse_mode: 'HTML' });
  }
}

// ═══════════════════════════════════
//  REGISTER HANDLERS
// ═══════════════════════════════════

export function registerServerInfo(bot) {
  bot.command('info', async (ctx) => {
    await showServerInfo(ctx, false);
  });

  bot.callbackQuery('menu:info', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showServerInfo(ctx, false);
  });

  bot.callbackQuery('info:refresh', async (ctx) => {
    await ctx.answerCallbackQuery('🔄 Refreshing...');
    await showServerInfo(ctx, true);
  });
}
