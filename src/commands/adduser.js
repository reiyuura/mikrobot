import { InlineKeyboard } from 'grammy';
import { mikrotik } from '../mikrotik.js';
import { database } from '../database.js';
import {
  generateCode, formatDate, formatSpeed, formatSessionTimeout, now,
  getProfileList, getProfile, formatCurrency,
} from '../utils.js';

// Temporary storage for manual usernames (userId → {username, password})
const pendingManual = new Map();

// ═══════════════════════════════════
//  GET PROFILES (API or fallback)
// ═══════════════════════════════════

async function fetchProfiles() {
  const apiProfiles = await mikrotik.getUserProfiles();
  if (apiProfiles && apiProfiles.length > 0) {
    return apiProfiles;
  }
  return getProfileList();
}

// ═══════════════════════════════════
//  SHOW PROFILE SELECTION
// ═══════════════════════════════════

async function showProfileSelection(ctx, mode = 'auto', customInfo = null) {
  try {
    const profiles = await fetchProfiles();

    const callbackPrefix = mode === 'manual' ? 'addmanual' : 'adduser';

    const keyboard = new InlineKeyboard();
    let count = 0;

    for (const profile of profiles) {
      if (profile.name === 'default') continue;

      const price = profile.price ? ` — ${formatCurrency(profile.price)}` : '';
      const label = `${profile.label || profile.name}${price}`;
      keyboard.text(label, `${callbackPrefix}:${profile.name}`);

      count++;
      if (count % 2 === 0) keyboard.row();
    }

    if (count % 2 !== 0) keyboard.row();
    keyboard.text('❌ Batal', 'adduser:cancel');

    let headerText = `➕ <b>Tambah User Hotspot</b>\n\n`;
    if (mode === 'manual' && customInfo) {
      headerText += `👤 Username: <code>${customInfo.username}</code>\n`;
      headerText += `🔑 Password: <code>${customInfo.password}</code>\n\n`;
    }
    headerText += `Pilih profile:`;

    await ctx.reply(headerText, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error) {
    await ctx.reply(
      `❌ Gagal mengambil data profile:\n<code>${error.message}</code>`,
      { parse_mode: 'HTML' }
    );
  }
}

// ═══════════════════════════════════
//  CREATE USER (shared logic)
// ═══════════════════════════════════

async function createUser(ctx, profileName, username, password) {
  try {
    const comment = `MikroBot | ${now().format('DD-MMM-YYYY')}`;

    // Create user on MikroTik
    await mikrotik.addUser({
      name: username,
      password: password,
      profile: profileName,
      comment,
    });

    // Get profile details
    const profileData = getProfile(profileName);
    const price = profileData?.price || 0;

    // Log to database (income belum dihitung — nanti saat user pertama login)
    database.logUser(username, profileName, 'all', ctx.from.id, ctx.from.first_name, price);

    const speed = formatSpeed(profileData?.['rate-limit']);
    const duration = formatSessionTimeout(profileData?.['session-timeout']);

    await ctx.editMessageText(
      `✅ <b>User Hotspot Berhasil Dibuat!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 Username : <code>${username}</code>\n` +
      `🔑 Password : <code>${password}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 Profile  : ${profileData?.label || profileName}\n` +
      `⚡ Speed    : ${speed.display}\n` +
      `⏱ Durasi   : ${duration}\n` +
      `💰 Harga    : ${formatCurrency(price)}\n` +
      `📅 Dibuat   : ${formatDate(now())}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>💡 Income dihitung saat user pertama login</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    await ctx.editMessageText(
      `❌ Gagal membuat user:\n<code>${error.message}</code>`,
      { parse_mode: 'HTML' }
    );
  }
}

// ═══════════════════════════════════
//  REGISTER HANDLERS
// ═══════════════════════════════════

export function registerAddUser(bot) {
  // Command: /adduser (auto) or /adduser username password (manual)
  bot.command('adduser', async (ctx) => {
    const args = ctx.match?.trim().split(/\s+/) || [];

    if (args.length >= 1 && args[0]) {
      // Manual mode: /adduser nama (user=pass) or /adduser user pass
      const username = args[0];
      const password = args.length >= 2 ? args[1] : args[0]; // default: user = pass

      // Store pending manual info
      pendingManual.set(ctx.from.id, { username, password });

      await showProfileSelection(ctx, 'manual', { username, password });
    } else {
      // Auto mode: /adduser (no args)
      pendingManual.delete(ctx.from.id);
      await showProfileSelection(ctx, 'auto');
    }
  });

  // Menu button (always auto)
  bot.callbackQuery('menu:adduser', async (ctx) => {
    await ctx.answerCallbackQuery();
    pendingManual.delete(ctx.from.id);
    await showProfileSelection(ctx, 'auto');
  });

  // Cancel
  bot.callbackQuery('adduser:cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    pendingManual.delete(ctx.from.id);
    await ctx.editMessageText('❌ Dibatalkan.');
  });

  // Auto mode — profile selected → create with generated code
  bot.callbackQuery(/^adduser:(?!cancel)(.+)$/, async (ctx) => {
    const profileName = ctx.match[1];
    await ctx.answerCallbackQuery('⏳ Membuat user...');

    const code = generateCode();
    await createUser(ctx, profileName, code, code);
  });

  // Manual mode — profile selected → create with custom username
  bot.callbackQuery(/^addmanual:(.+)$/, async (ctx) => {
    const profileName = ctx.match[1];
    await ctx.answerCallbackQuery('⏳ Membuat user...');

    const manual = pendingManual.get(ctx.from.id);
    if (!manual) {
      await ctx.editMessageText('❌ Data user tidak ditemukan. Coba lagi.');
      return;
    }

    pendingManual.delete(ctx.from.id);
    await createUser(ctx, profileName, manual.username, manual.password);
  });
}
