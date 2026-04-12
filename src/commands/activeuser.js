import { InlineKeyboard } from 'grammy';
import { mikrotik } from '../mikrotik.js';
import { escapeHtml, formatBytes } from '../utils.js';

// ═══════════════════════════════════
//  SHOW ACTIVE USERS
// ═══════════════════════════════════

async function showActiveUsers(ctx, edit = false) {
  try {
    const sessions = await mikrotik.getActiveSessions();

    if (sessions.length === 0) {
      const text = '👥 <b>User Aktif</b>\n\nTidak ada user yang sedang online.';
      const keyboard = new InlineKeyboard().text('🔄 Refresh', 'active:refresh');

      return edit
        ? ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
        : ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }

    let text =
      `👥 <b>User Aktif</b> — ${sessions.length} online\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n`;

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const name = escapeHtml(s.user || '-');
      const ip = s.address || '-';
      const mac = s['mac-address'] || '-';
      const uptime = s.uptime || '-';
      const bytesIn = formatBytes(s['bytes-in']);
      const bytesOut = formatBytes(s['bytes-out']);

      text +=
        `\n<b>${i + 1}. ${name}</b>\n` +
        `   📍 IP : ${ip}\n` +
        `   🔗 MAC: <code>${mac}</code>\n` +
        `   ⏱ Up : ${uptime}\n` +
        `   📊 ↓${bytesOut} / ↑${bytesIn}\n`;
    }

    const keyboard = new InlineKeyboard().text('🔄 Refresh', 'active:refresh');

    if (edit) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
  } catch (error) {
    const msg = `❌ Gagal mengambil data user aktif:\n<code>${error.message}</code>`;
    edit
      ? await ctx.editMessageText(msg, { parse_mode: 'HTML' })
      : await ctx.reply(msg, { parse_mode: 'HTML' });
  }
}

// ═══════════════════════════════════
//  REGISTER HANDLERS
// ═══════════════════════════════════

export function registerActiveUser(bot) {
  bot.command('active', async (ctx) => {
    await showActiveUsers(ctx, false);
  });

  bot.callbackQuery('menu:active', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showActiveUsers(ctx, false);
  });

  bot.callbackQuery('active:refresh', async (ctx) => {
    await ctx.answerCallbackQuery('🔄 Refreshing...');
    await showActiveUsers(ctx, true);
  });
}
