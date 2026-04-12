import { InlineKeyboard } from 'grammy';
import { mikrotik } from '../mikrotik.js';
import { database } from '../database.js';
import { config } from '../config.js';
import { generateCode, formatDate, formatSpeed, formatSessionTimeout, now } from '../utils.js';

// ═══════════════════════════════════
//  SHOW PROFILE SELECTION
// ═══════════════════════════════════

async function showVoucherProfiles(ctx) {
  try {
    const profiles = await mikrotik.getUserProfiles();

    const keyboard = new InlineKeyboard();
    let count = 0;

    for (const profile of profiles) {
      if (profile.name === 'default') continue;

      const speed = formatSpeed(profile['rate-limit']);
      keyboard.text(`${profile.name} (${speed.display})`, `voucher:profile:${profile.name}`);

      count++;
      if (count % 2 === 0) keyboard.row();
    }

    if (count % 2 !== 0) keyboard.row();
    keyboard.text('❌ Batal', 'voucher:cancel');

    await ctx.reply(
      `🎫 <b>Generate Voucher</b>\n\n` +
      `Pilih profile untuk voucher:`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (error) {
    await ctx.reply(`❌ Gagal mengambil data profile:\n<code>${error.message}</code>`, { parse_mode: 'HTML' });
  }
}

// ═══════════════════════════════════
//  REGISTER HANDLERS
// ═══════════════════════════════════

export function registerVoucher(bot) {
  // Command: /voucher
  bot.command('voucher', async (ctx) => {
    await showVoucherProfiles(ctx);
  });

  // Menu button
  bot.callbackQuery('menu:voucher', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showVoucherProfiles(ctx);
  });

  // Cancel
  bot.callbackQuery('voucher:cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('❌ Dibatalkan.');
  });

  // Profile selected → choose quantity
  bot.callbackQuery(/^voucher:profile:(.+)$/, async (ctx) => {
    const profile = ctx.match[1];
    await ctx.answerCallbackQuery();

    const keyboard = new InlineKeyboard()
      .text('3 Voucher', `voucher:gen:${profile}:3`)
      .text('5 Voucher', `voucher:gen:${profile}:5`)
      .row()
      .text('10 Voucher', `voucher:gen:${profile}:10`)
      .text('20 Voucher', `voucher:gen:${profile}:20`)
      .row()
      .text('❌ Batal', 'voucher:cancel');

    await ctx.editMessageText(
      `🎫 <b>Generate Voucher — ${profile}</b>\n\n` +
      `Pilih jumlah voucher:`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  });

  // Generate vouchers
  bot.callbackQuery(/^voucher:gen:(.+):(\d+)$/, async (ctx) => {
    const profileName = ctx.match[1];
    const qty = parseInt(ctx.match[2]);
    await ctx.answerCallbackQuery('⏳ Generating vouchers...');

    try {
      const comment = `MikroBot | ${now().format('DD-MMM-YYYY')}`;
      const vouchers = [];
      const dbEntries = [];

      // Generate all vouchers
      for (let i = 0; i < qty; i++) {
        const code = generateCode();

        await mikrotik.addUser({
          name: code,
          password: code,
          profile: profileName,
          server: config.hotspotServer,
          comment,
        });

        vouchers.push(code);
        dbEntries.push({
          username: code,
          profile: profileName,
          server: config.hotspotServer,
          createdById: ctx.from.id,
          createdByName: ctx.from.first_name,
        });
      }

      // Batch log to database
      database.logBatchUsers(dbEntries);

      // Get profile info
      const profiles = await mikrotik.getUserProfiles();
      const profileData = profiles.find((p) => p.name === profileName);
      const speed = formatSpeed(profileData?.['rate-limit']);
      const duration = formatSessionTimeout(profileData?.['session-timeout']);

      // Build voucher list
      let voucherList = '';
      vouchers.forEach((code, i) => {
        voucherList += `${String(i + 1).padStart(2, ' ')}. <code>${code}</code> / <code>${code}</code>\n`;
      });

      await ctx.editMessageText(
        `🎫 <b>Voucher Hotspot — ${profileName}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `⚡ Speed  : ${speed.display}\n` +
        `⏱ Durasi : ${duration}\n` +
        `🖥 Server : ${config.hotspotServer}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<b>User / Pass:</b>\n\n` +
        voucherList +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📅 Dibuat: ${formatDate(now())}\n` +
        `📊 Total: ${qty} voucher`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      await ctx.editMessageText(
        `❌ Gagal generate voucher:\n<code>${error.message}</code>\n\n` +
        `⚠️ Beberapa voucher mungkin sudah terbuat. Cek /listuser`,
        { parse_mode: 'HTML' }
      );
    }
  });
}
