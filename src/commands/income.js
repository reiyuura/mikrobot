import { InlineKeyboard } from 'grammy';
import { database } from '../database.js';
import { formatCurrency, getProfile, now } from '../utils.js';

// ═══════════════════════════════════
//  INCOME REPORT COMMAND
// ═══════════════════════════════════

export function registerIncome(bot) {
  // Command: /income
  bot.command('income', async (ctx) => {
    await showIncomeMenu(ctx);
  });

  // Menu button
  bot.callbackQuery('menu:income', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showIncomeMenu(ctx);
  });

  // Today
  bot.callbackQuery('income:today', async (ctx) => {
    await ctx.answerCallbackQuery();
    const today = now().format('YYYY-MM-DD');
    const startStr = `${today}T00:00:00`;
    const endStr = `${today}T23:59:59`;
    const byProfile = database.getIncomeByProfile(startStr, endStr);
    const total = database.getIncomeToday(today);

    await ctx.editMessageText(
      buildIncomeReport('Hari Ini', now().format('DD MMM YYYY'), byProfile, total),
      { parse_mode: 'HTML', reply_markup: backKeyboard() }
    );
  });

  // This week
  bot.callbackQuery('income:week', async (ctx) => {
    await ctx.answerCallbackQuery();
    const todayDate = now();
    const startOfWeek = todayDate.startOf('week');
    const startStr = startOfWeek.toISOString();
    const endStr = todayDate.toISOString();
    const byProfile = database.getIncomeByProfile(startStr, endStr);
    const total = Object.values(byProfile).reduce((sum, p) => sum + p.income, 0);

    await ctx.editMessageText(
      buildIncomeReport(
        'Minggu Ini',
        `${startOfWeek.format('DD MMM')} - ${todayDate.format('DD MMM YYYY')}`,
        byProfile,
        total
      ),
      { parse_mode: 'HTML', reply_markup: backKeyboard() }
    );
  });

  // This month
  bot.callbackQuery('income:month', async (ctx) => {
    await ctx.answerCallbackQuery();
    const todayDate = now();
    const startOfMonth = todayDate.startOf('month');
    const startStr = startOfMonth.toISOString();
    const endStr = todayDate.toISOString();
    const byProfile = database.getIncomeByProfile(startStr, endStr);
    const total = Object.values(byProfile).reduce((sum, p) => sum + p.income, 0);

    await ctx.editMessageText(
      buildIncomeReport(
        'Bulan Ini',
        `${startOfMonth.format('DD MMM')} - ${todayDate.format('DD MMM YYYY')}`,
        byProfile,
        total
      ),
      { parse_mode: 'HTML', reply_markup: backKeyboard() }
    );
  });

  // All time
  bot.callbackQuery('income:all', async (ctx) => {
    await ctx.answerCallbackQuery();
    const byProfile = database.getIncomeByProfile('2000-01-01', '2099-12-31');
    const total = database.getTotalIncome();

    await ctx.editMessageText(
      buildIncomeReport('Total (Semua Waktu)', 'Sejak awal', byProfile, total),
      { parse_mode: 'HTML', reply_markup: backKeyboard() }
    );
  });

  // Back
  bot.callbackQuery('income:back', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showIncomeMenu(ctx, true);
  });
}

// ═══════════════════════════════════
//  HELPERS
// ═══════════════════════════════════

async function showIncomeMenu(ctx, isEdit = false) {
  const keyboard = new InlineKeyboard()
    .text('📅 Hari Ini', 'income:today')
    .text('📆 Minggu Ini', 'income:week')
    .row()
    .text('🗓 Bulan Ini', 'income:month')
    .text('📊 Total', 'income:all');

  const stats = database.getStats();
  const totalIncome = database.getTotalIncome();

  const text =
    `💰 <b>Laporan Pendapatan</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 Total user dibuat : ${stats.total_created}\n` +
    `✅ Aktif             : ${stats.active}\n` +
    `🗑 Dihapus           : ${stats.deleted}\n` +
    `💵 Total pendapatan  : ${formatCurrency(totalIncome)}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Pilih periode:`;

  if (isEdit) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

function buildIncomeReport(title, range, byProfile, total) {
  let msg = `💰 <b>Pendapatan — ${title}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📅 Periode: ${range}\n\n`;

  const profiles = Object.entries(byProfile);

  if (profiles.length === 0) {
    msg += `<i>Belum ada transaksi di periode ini.</i>\n\n`;
  } else {
    for (const [name, data] of profiles) {
      const profile = getProfile(name);
      const label = profile?.label || name;
      const unitPrice = profile?.price || 0;
      msg += `📋 <b>${label}</b>\n`;
      msg += `   ${data.count} user × ${formatCurrency(unitPrice)} = ${formatCurrency(data.income)}\n\n`;
    }
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💵 <b>TOTAL: ${formatCurrency(total)}</b>`;

  return msg;
}

function backKeyboard() {
  return new InlineKeyboard().text('◀️ Kembali', 'income:back');
}
