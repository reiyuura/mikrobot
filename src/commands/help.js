export function registerHelp(bot) {
  bot.command('help', async (ctx) => {
    await showHelp(ctx);
  });

  bot.callbackQuery('menu:help', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showHelp(ctx);
  });
}

async function showHelp(ctx) {
  await ctx.reply(
    `❓ <b>Panduan MikroBot</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>📌 Command Tersedia:</b>\n\n` +
    `/start — Menu utama\n` +
    `/adduser — Buat 1 user hotspot baru\n` +
    `/voucher — Generate batch voucher\n` +
    `/listuser — Lihat semua user\n` +
    `/deleteuser — Hapus user\n` +
    `/deleteuser <i>username</i> — Hapus user langsung\n` +
    `/active — Lihat user yang sedang online\n` +
    `/info — Info server MikroTik\n` +
    `/income — Laporan pendapatan\n` +
    `/help — Panduan ini\n\n` +
    `<b>💡 Tips:</b>\n` +
    `• Username = Password (tinggal copy)\n` +
    `• Gunakan /voucher untuk buat banyak user sekaligus\n` +
    `• User otomatis dihapus saat masa aktif habis 🧹\n` +
    `• /deleteuser akan kick user yang sedang online\n` +
    `• Harga tercatat otomatis di /income\n\n` +
    `<b>🔗 Koneksi:</b>\n` +
    `Bot → WireGuard → MikroTik REST API\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'HTML' }
  );
}
