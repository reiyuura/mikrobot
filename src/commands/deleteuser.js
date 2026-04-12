import { InlineKeyboard } from 'grammy';
import { mikrotik } from '../mikrotik.js';
import { database } from '../database.js';
import { escapeHtml } from '../utils.js';

// ═══════════════════════════════════
//  SHOW DELETE LIST
// ═══════════════════════════════════

async function showDeleteList(ctx, edit = false) {
  try {
    const allUsers = await mikrotik.getUsers();
    const users = allUsers.filter((u) => u.name !== 'default-trial');

    if (users.length === 0) {
      const msg = '🗑 <b>Hapus User</b>\n\nTidak ada user untuk dihapus.';
      return edit
        ? ctx.editMessageText(msg, { parse_mode: 'HTML' })
        : ctx.reply(msg, { parse_mode: 'HTML' });
    }

    // Show last 8 users
    const recent = users.slice(-8).reverse();

    const keyboard = new InlineKeyboard();
    for (let i = 0; i < recent.length; i++) {
      const u = recent[i];
      keyboard.text(`${u.name} (${u.profile || 'default'})`, `del:confirm:${u.name}`);
      if ((i + 1) % 2 === 0) keyboard.row();
    }
    if (recent.length % 2 !== 0) keyboard.row();
    keyboard.text('❌ Batal', 'del:cancel');

    const text =
      `🗑 <b>Hapus User Hotspot</b>\n\n` +
      `Pilih user yang ingin dihapus:\n` +
      `<i>(Menampilkan ${recent.length} user terakhir)</i>\n\n` +
      `Atau ketik: <code>/deleteuser username</code>`;

    if (edit) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
  } catch (error) {
    const msg = `❌ Gagal mengambil data user:\n<code>${error.message}</code>`;
    edit
      ? await ctx.editMessageText(msg, { parse_mode: 'HTML' })
      : await ctx.reply(msg, { parse_mode: 'HTML' });
  }
}

// ═══════════════════════════════════
//  DELETE USER LOGIC
// ═══════════════════════════════════

async function executeDelete(ctx, username) {
  try {
    // Find user by name
    const user = await mikrotik.getUserByName(username);
    if (!user) {
      return ctx.editMessageText(
        `❌ User <code>${escapeHtml(username)}</code> tidak ditemukan di router.`,
        { parse_mode: 'HTML' }
      );
    }

    // Kick from active session if online
    let wasActive = false;
    try {
      const actives = await mikrotik.getActiveSessions();
      const session = actives.find((a) => a.user === username);
      if (session) {
        await mikrotik.kickUser(session['.id']);
        wasActive = true;
      }
    } catch {
      // Ignore kick errors
    }

    // Delete from router
    await mikrotik.removeUser(user['.id']);

    // Mark deleted in DB
    database.markDeleted(username);

    await ctx.editMessageText(
      `✅ <b>User Berhasil Dihapus!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 Username: <code>${escapeHtml(username)}</code>\n` +
      (wasActive ? `🔌 Session aktif di-kick.\n` : '') +
      `━━━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    await ctx.editMessageText(
      `❌ Gagal menghapus user:\n<code>${error.message}</code>`,
      { parse_mode: 'HTML' }
    );
  }
}

// ═══════════════════════════════════
//  REGISTER HANDLERS
// ═══════════════════════════════════

export function registerDeleteUser(bot) {
  // Command: /deleteuser or /deleteuser <username>
  bot.command('deleteuser', async (ctx) => {
    const username = ctx.match?.trim();

    if (username) {
      // Direct delete with confirmation
      const keyboard = new InlineKeyboard()
        .text('✅ Ya, Hapus', `del:yes:${username}`)
        .text('❌ Batal', 'del:cancel');

      await ctx.reply(
        `🗑 <b>Konfirmasi Hapus User</b>\n\n` +
        `Yakin hapus user <code>${escapeHtml(username)}</code>?`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    } else {
      await showDeleteList(ctx);
    }
  });

  // Menu button
  bot.callbackQuery('menu:deleteuser', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showDeleteList(ctx);
  });

  // Cancel
  bot.callbackQuery('del:cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('❌ Dibatalkan.');
  });

  // Confirm dialog
  bot.callbackQuery(/^del:confirm:(.+)$/, async (ctx) => {
    const username = ctx.match[1];
    await ctx.answerCallbackQuery();

    const keyboard = new InlineKeyboard()
      .text('✅ Ya, Hapus', `del:yes:${username}`)
      .text('❌ Batal', 'del:cancel');

    await ctx.editMessageText(
      `🗑 <b>Konfirmasi Hapus User</b>\n\n` +
      `Yakin hapus user <code>${escapeHtml(username)}</code>?\n` +
      `User akan dihapus dari router dan di-kick jika sedang online.`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  });

  // Execute delete
  bot.callbackQuery(/^del:yes:(.+)$/, async (ctx) => {
    const username = ctx.match[1];
    await ctx.answerCallbackQuery('⏳ Menghapus...');
    await executeDelete(ctx, username);
  });
}
