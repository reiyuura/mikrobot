import { InlineKeyboard } from 'grammy';
import { mikrotik } from '../mikrotik.js';

export function registerReboot(bot) {
  // Command: /reboot
  bot.command('reboot', async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text('✅ Ya, Reboot!', 'reboot:confirm')
      .text('❌ Batal', 'reboot:cancel');

    await ctx.reply(
      `⚠️ <b>Reboot MikroTik?</b>\n\n` +
      `Router akan restart dan semua koneksi aktif akan terputus.\n` +
      `Proses reboot biasanya memakan waktu 30-60 detik.\n\n` +
      `Yakin ingin reboot?`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  });

  // Menu button
  bot.callbackQuery('menu:reboot', async (ctx) => {
    await ctx.answerCallbackQuery();

    const keyboard = new InlineKeyboard()
      .text('✅ Ya, Reboot!', 'reboot:confirm')
      .text('❌ Batal', 'reboot:cancel');

    await ctx.reply(
      `⚠️ <b>Reboot MikroTik?</b>\n\n` +
      `Router akan restart dan semua koneksi aktif akan terputus.\n` +
      `Proses reboot biasanya memakan waktu 30-60 detik.\n\n` +
      `Yakin ingin reboot?`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  });

  // Confirm reboot
  bot.callbackQuery('reboot:confirm', async (ctx) => {
    await ctx.answerCallbackQuery('⏳ Rebooting...');

    try {
      await ctx.editMessageText('⏳ <b>Mengirim perintah reboot...</b>', { parse_mode: 'HTML' });

      await mikrotik.reboot();

      await ctx.editMessageText(
        `🔄 <b>Reboot berhasil dikirim!</b>\n\n` +
        `Router sedang restart...\n` +
        `⏱ Estimasi: 30-60 detik\n\n` +
        `Gunakan /info untuk cek apakah router sudah online.`,
        { parse_mode: 'HTML' }
      );

      // Auto-check after 60 seconds
      setTimeout(async () => {
        try {
          const isOnline = await mikrotik.ping();
          if (isOnline) {
            await ctx.reply('✅ Router sudah <b>online</b> kembali!', { parse_mode: 'HTML' });
          } else {
            await ctx.reply('⚠️ Router belum merespon. Coba /info lagi nanti.', { parse_mode: 'HTML' });
          }
        } catch {
          // Ignore — router might still be booting
        }
      }, 60000);

    } catch (error) {
      // Reboot command often "fails" because connection drops immediately
      if (error.message?.includes('ECONNRESET') || error.message?.includes('ECONNABORTED') || error.message?.includes('timeout')) {
        await ctx.editMessageText(
          `🔄 <b>Reboot berhasil!</b>\n\n` +
          `Router sedang restart (koneksi terputus = normal).\n` +
          `⏱ Estimasi: 30-60 detik\n\n` +
          `Gunakan /info untuk cek status.`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.editMessageText(
          `❌ Gagal reboot:\n<code>${error.message}</code>`,
          { parse_mode: 'HTML' }
        );
      }
    }
  });

  // Cancel
  bot.callbackQuery('reboot:cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('❌ Reboot dibatalkan.');
  });
}
