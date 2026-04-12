import { InlineKeyboard } from 'grammy';

export function registerStart(bot) {
  bot.command('start', async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text('➕ Tambah User', 'menu:adduser')
      .text('🎫 Voucher', 'menu:voucher')
      .row()
      .text('📋 List User', 'menu:listuser')
      .text('🗑 Hapus User', 'menu:deleteuser')
      .row()
      .text('👥 User Aktif', 'menu:active')
      .text('💰 Pendapatan', 'menu:income')
      .row()
      .text('📊 Info Server', 'menu:info')
      .text('❓ Bantuan', 'menu:help');

    await ctx.reply(
      `🤖 <b>MikroBot</b> — Hotspot Manager\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Kelola user hotspot MikroTik\n` +
      `langsung dari Telegram.\n\n` +
      `🔗 Router: <code>${process.env.ROUTER_HOST || '10.10.10.2'}</code>\n` +
      `⏰ Auto-cleanup: ON\n\n` +
      `Pilih menu di bawah atau ketik /help`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  });
}
