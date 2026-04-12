import { InlineKeyboard } from 'grammy';
import { mikrotik } from '../mikrotik.js';
import { escapeHtml } from '../utils.js';

const PER_PAGE = 10;

// ═══════════════════════════════════
//  SHOW USER LIST
// ═══════════════════════════════════

async function showUserList(ctx, page = 0, edit = false) {
  try {
    const allUsers = await mikrotik.getUsers();

    // Filter out 'default-trial' type users / system users
    const users = allUsers.filter((u) => u.name !== 'default-trial');

    if (users.length === 0) {
      const msg = '📋 <b>Daftar User Hotspot</b>\n\nTidak ada user.';
      return edit
        ? ctx.editMessageText(msg, { parse_mode: 'HTML' })
        : ctx.reply(msg, { parse_mode: 'HTML' });
    }

    const totalPages = Math.ceil(users.length / PER_PAGE);
    const safeP = Math.min(Math.max(page, 0), totalPages - 1);
    const start = safeP * PER_PAGE;
    const pageUsers = users.slice(start, start + PER_PAGE);

    let text =
      `📋 <b>Daftar User Hotspot</b>\n` +
      `Total: ${users.length} user | Hal ${safeP + 1}/${totalPages}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n`;

    for (let i = 0; i < pageUsers.length; i++) {
      const u = pageUsers[i];
      const num = start + i + 1;
      const profile = u.profile || 'default';
      const comment = u.comment ? ` · <i>${escapeHtml(u.comment)}</i>` : '';
      text += `${num}. <code>${escapeHtml(u.name)}</code> — ${profile}${comment}\n`;
    }

    // Pagination buttons
    const keyboard = new InlineKeyboard();
    if (safeP > 0) keyboard.text('⬅️ Prev', `listuser:page:${safeP - 1}`);
    keyboard.text(`${safeP + 1}/${totalPages}`, 'listuser:noop');
    if (safeP < totalPages - 1) keyboard.text('Next ➡️', `listuser:page:${safeP + 1}`);
    keyboard.row().text('🔄 Refresh', `listuser:page:${safeP}`);

    const opts = { parse_mode: 'HTML', reply_markup: keyboard };
    if (edit) {
      await ctx.editMessageText(text, opts);
    } else {
      await ctx.reply(text, opts);
    }
  } catch (error) {
    const msg = `❌ Gagal mengambil data user:\n<code>${error.message}</code>`;
    if (edit) {
      await ctx.editMessageText(msg, { parse_mode: 'HTML' });
    } else {
      await ctx.reply(msg, { parse_mode: 'HTML' });
    }
  }
}

// ═══════════════════════════════════
//  REGISTER HANDLERS
// ═══════════════════════════════════

export function registerListUser(bot) {
  bot.command('listuser', async (ctx) => {
    await showUserList(ctx, 0, false);
  });

  bot.callbackQuery('menu:listuser', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showUserList(ctx, 0, false);
  });

  bot.callbackQuery(/^listuser:page:(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await showUserList(ctx, page, true);
  });

  bot.callbackQuery('listuser:noop', async (ctx) => {
    await ctx.answerCallbackQuery();
  });
}
