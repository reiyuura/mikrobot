import { Bot } from 'grammy';
import { config } from './config.js';

export function createBot() {
  const bot = new Bot(config.botToken);

  // ═══════════════════════════════════
  //  ADMIN-ONLY MIDDLEWARE
  // ═══════════════════════════════════

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;

    // Ignore updates without a sender (channel posts, etc.)
    if (!userId) return;

    // Check if user is in admin list
    if (!config.adminIds.includes(userId)) {
      return ctx.reply('⛔ Akses ditolak. Bot ini hanya untuk admin.');
    }

    await next();
  });

  // ═══════════════════════════════════
  //  ERROR HANDLER
  // ═══════════════════════════════════

  bot.catch((err) => {
    const ctx = err.ctx;
    const e = err.error;
    console.error(`❌ Error handling update ${ctx.update.update_id}:`);
    console.error(e);

    // Try to notify admin
    ctx.reply(`❌ Terjadi error: ${e.message || 'Unknown error'}`)
      .catch(() => {}); // Ignore if reply also fails
  });

  return bot;
}
