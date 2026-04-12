import { InlineKeyboard } from 'grammy';
import { mikrotik } from '../mikrotik.js';
import { database } from '../database.js';
import { config } from '../config.js';
import {
  generateCode, formatDate, formatSpeed, formatSessionTimeout, now,
  getProfileList, getProfile,
} from '../utils.js';

// ═══════════════════════════════════
//  GET PROFILES (API or fallback)
// ═══════════════════════════════════

async function fetchProfiles() {
  // Try API first, fallback to hardcoded
  const apiProfiles = await mikrotik.getUserProfiles();
  if (apiProfiles && apiProfiles.length > 0) {
    return apiProfiles;
  }
  return getProfileList();
}

// ═══════════════════════════════════
//  SHOW PROFILE SELECTION
// ═══════════════════════════════════

async function showProfileSelection(ctx) {
  try {
    const profiles = await fetchProfiles();

    const keyboard = new InlineKeyboard();
    let count = 0;

    for (const profile of profiles) {
      if (profile.name === 'default') continue;

      const speed = formatSpeed(profile['rate-limit']);
      const label = `${profile.label || profile.name} (${speed.display})`;
      keyboard.text(label, `adduser:${profile.name}`);

      count++;
      if (count % 2 === 0) keyboard.row();
    }

    if (count % 2 !== 0) keyboard.row();
    keyboard.text('❌ Batal', 'adduser:cancel');

    await ctx.reply(
      `➕ <b>Tambah User Hotspot</b>\n\n` +
      `Pilih profile untuk user baru:`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (error) {
    await ctx.reply(
      `❌ Gagal mengambil data profile:\n<code>${error.message}</code>`,
      { parse_mode: 'HTML' }
    );
  }
}

// ═══════════════════════════════════
//  REGISTER HANDLERS
// ═══════════════════════════════════

export function registerAddUser(bot) {
  // Command: /adduser
  bot.command('adduser', async (ctx) => {
    await showProfileSelection(ctx);
  });

  // Menu button
  bot.callbackQuery('menu:adduser', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProfileSelection(ctx);
  });

  // Cancel
  bot.callbackQuery('adduser:cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('❌ Dibatalkan.');
  });

  // Profile selected → create user
  bot.callbackQuery(/^adduser:(?!cancel)(.+)$/, async (ctx) => {
    const profileName = ctx.match[1];
    await ctx.answerCallbackQuery('⏳ Membuat user...');

    try {
      // Generate unique code (username = password)
      const code = generateCode();
      const comment = `MikroBot | ${now().format('DD-MMM-YYYY')}`;

      // Create user on MikroTik
      await mikrotik.addUser({
        name: code,
        password: code,
        profile: profileName,
        server: config.hotspotServer,
        comment,
      });

      // Log to database
      database.logUser(code, profileName, config.hotspotServer, ctx.from.id, ctx.from.first_name);

      // Get profile details for display (from hardcoded or API)
      const profileData = getProfile(profileName);
      const speed = formatSpeed(profileData?.['rate-limit']);
      const duration = formatSessionTimeout(profileData?.['session-timeout']);

      await ctx.editMessageText(
        `✅ <b>User Hotspot Berhasil Dibuat!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 Username : <code>${code}</code>\n` +
        `🔑 Password : <code>${code}</code>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 Profile  : ${profileData?.label || profileName}\n` +
        `⚡ Speed    : ${speed.display}\n` +
        `⏱ Durasi   : ${duration}\n` +
        `🖥 Server   : ${config.hotspotServer}\n` +
        `📅 Dibuat   : ${formatDate(now())}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      await ctx.editMessageText(
        `❌ Gagal membuat user:\n<code>${error.message}</code>`,
        { parse_mode: 'HTML' }
      );
    }
  });
}
