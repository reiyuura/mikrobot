import { InlineKeyboard } from 'grammy';
import { mikrotik } from '../mikrotik.js';
import { database } from '../database.js';
import {
  config,
  getTetherRuntime,
  updateTetherSettings,
} from '../config.js';
import { restartTetherMonitor, runTetherScanNow } from '../scheduler.js';
import { formatDate } from '../utils.js';

function parseOnOff(raw) {
  const s = String(raw || '').toLowerCase();
  if (['on', '1', 'true', 'yes', 'enable', 'enabled'].includes(s)) return true;
  if (['off', '0', 'false', 'no', 'disable', 'disabled'].includes(s)) return false;
  return null;
}

function statusText() {
  const r = getTetherRuntime();
  const stats = database.getTetherStats();
  const states = database.getAllTetherStates();
  const banned = Object.entries(states)
    .filter(([, s]) => s.punishUntil && new Date(s.punishUntil).getTime() > Date.now())
    .map(([u, s]) => ({ u, until: s.punishUntil }));

  let msg = `🛡 <b>Anti-Tether Settings</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Status     : <b>${r.enabled ? 'ON' : 'OFF'}</b>\n`;
  msg += `Poll       : <code>${r.pollSeconds}s</code>\n`;
  msg += `Cooldown   : <code>${r.cooldownMin} menit</code> (notif admin)\n`;
  msg += `Punish     : <code>${r.punishMin} menit</code> (disable user)\n`;
  msg += `AutoPunish : <b>${r.autoPunish ? 'ON' : 'OFF'}</b>\n`;
  msg += `List       : <code>${r.list}</code> (timeout ${r.listTimeout})\n`;
  msg += `Iface/Net  : <code>${r.interface}</code> / <code>${r.subnet}</code>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 Stats: ${stats.totalHits} hit · ${stats.users} user · ${stats.activePunish} ban aktif\n`;
  if (banned.length) {
    msg += `\n🔒 <b>Ban aktif:</b>\n`;
    for (const b of banned.slice(0, 8)) {
      msg += `• <code>${b.u}</code> sampai ${formatDate(b.until)}\n`;
    }
  }
  msg += `\n<i>Ubah: /tether help</i>`;
  return msg;
}

function helpText() {
  return (
    `🛡 <b>Command /tether</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `/tether — status + tombol\n` +
    `/tether on | off — nyala/mati monitor\n` +
    `/tether poll &lt;detik&gt; — interval cek (10–3600)\n` +
    `/tether cooldown &lt;menit&gt; — jeda notif admin\n` +
    `/tether punish &lt;menit&gt; — lama ban user\n` +
    `/tether autopunish on|off — kick+disable\n` +
    `/tether listtimeout &lt;10m|1h&gt; — timeout address-list\n` +
    `/tether hits [user] — riwayat hit\n` +
    `/tether unban &lt;user&gt; — lepas ban sekarang\n` +
    `/tether reset [user|all] — reset counter hit\n` +
    `/tether scan — scan manual sekarang\n` +
    `/tether help — panduan ini\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>Setting tersimpan di data/mikrobot.json (survive restart).</i>`
  );
}

function mainKeyboard() {
  const r = getTetherRuntime();
  return new InlineKeyboard()
    .text(r.enabled ? '🟢 ON' : '🔴 OFF', 'tether:toggle')
    .text(r.autoPunish ? '⚔ Punish ON' : '🕊 Punish OFF', 'tether:togglepunish')
    .row()
    .text('⏱ Poll 15s', 'tether:set:poll:15')
    .text('30s', 'tether:set:poll:30')
    .text('60s', 'tether:set:poll:60')
    .row()
    .text('⏳ CD 5m', 'tether:set:cooldown:5')
    .text('10m', 'tether:set:cooldown:10')
    .text('30m', 'tether:set:cooldown:30')
    .row()
    .text('🔒 Ban 5m', 'tether:set:punish:5')
    .text('15m', 'tether:set:punish:15')
    .text('60m', 'tether:set:punish:60')
    .row()
    .text('📊 Hits', 'tether:hits')
    .text('🔍 Scan', 'tether:scan')
    .text('❓ Help', 'tether:help');
}

async function replyStatus(ctx, edit = false) {
  const text = statusText();
  const opts = { parse_mode: 'HTML', reply_markup: mainKeyboard() };
  if (edit && ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch {
      // fallthrough
    }
  }
  await ctx.reply(text, opts);
}

function applyAndRestart(patch) {
  const result = updateTetherSettings(patch);
  if (result.ok) {
    restartTetherMonitor();
  }
  return result;
}

export function registerTether(bot) {
  bot.command('tether', async (ctx) => {
    const raw = (ctx.match || '').trim();
    const parts = raw ? raw.split(/\s+/) : [];
    const sub = (parts[0] || '').toLowerCase();

    if (!sub) {
      await replyStatus(ctx);
      return;
    }

    if (sub === 'help' || sub === '?') {
      await ctx.reply(helpText(), { parse_mode: 'HTML' });
      return;
    }

    if (sub === 'status' || sub === 'show') {
      await replyStatus(ctx);
      return;
    }

    if (sub === 'on' || sub === 'off') {
      const enabled = sub === 'on';
      const r = applyAndRestart({ enabled });
      await ctx.reply(
        `${enabled ? '🟢' : '🔴'} Anti-tether <b>${enabled ? 'ON' : 'OFF'}</b>`,
        { parse_mode: 'HTML' }
      );
      await replyStatus(ctx);
      return;
    }

    if (sub === 'poll' || sub === 'interval') {
      const n = Number(parts[1]);
      const r = applyAndRestart({ pollSeconds: n });
      if (!r.ok) return ctx.reply(`❌ ${r.error}`);
      await ctx.reply(`✅ Poll = <code>${r.runtime.pollSeconds}s</code>`, { parse_mode: 'HTML' });
      return;
    }

    if (sub === 'cooldown' || sub === 'cd') {
      const n = Number(parts[1]);
      const r = applyAndRestart({ cooldownMin: n });
      if (!r.ok) return ctx.reply(`❌ ${r.error}`);
      await ctx.reply(`✅ Cooldown notif = <code>${r.runtime.cooldownMin} menit</code>`, {
        parse_mode: 'HTML',
      });
      return;
    }

    if (sub === 'punish' || sub === 'ban' || sub === 'punishmin') {
      const n = Number(parts[1]);
      const r = applyAndRestart({ punishMin: n });
      if (!r.ok) return ctx.reply(`❌ ${r.error}`);
      await ctx.reply(`✅ Punish = <code>${r.runtime.punishMin} menit</code>`, {
        parse_mode: 'HTML',
      });
      return;
    }

    if (sub === 'autopunish' || sub === 'auto') {
      const v = parseOnOff(parts[1]);
      if (v === null) {
        return ctx.reply('❌ Pakai: /tether autopunish on|off');
      }
      const r = applyAndRestart({ autoPunish: v });
      await ctx.reply(`✅ AutoPunish = <b>${v ? 'ON' : 'OFF'}</b>`, { parse_mode: 'HTML' });
      return;
    }

    if (sub === 'listtimeout' || sub === 'timeout') {
      const r = applyAndRestart({ listTimeout: parts[1] });
      if (!r.ok) return ctx.reply(`❌ ${r.error}`);
      await ctx.reply(`✅ List timeout = <code>${r.runtime.listTimeout}</code>`, {
        parse_mode: 'HTML',
      });
      return;
    }

    if (sub === 'hits' || sub === 'log') {
      const filterUser = parts[1];
      if (filterUser) {
        const st = database.getTetherState(filterUser);
        if (!st) return ctx.reply(`ℹ️ Belum ada hit untuk <code>${filterUser}</code>`, { parse_mode: 'HTML' });
        let msg = `📊 <b>Hit tether — <code>${filterUser}</code></b>\n`;
        msg += `Count: ${st.count}\n`;
        msg += `Last: ${st.lastAt ? formatDate(st.lastAt) : '-'}\n`;
        msg += `IP: <code>${st.lastAddress || '-'}</code>\n`;
        msg += `MAC: <code>${st.lastMac || '-'}</code>\n`;
        msg += `Ban until: ${st.punishUntil ? formatDate(st.punishUntil) : '-'}`;
        return ctx.reply(msg, { parse_mode: 'HTML' });
      }

      const events = database.getRecentTetherEvents(15);
      if (!events.length) return ctx.reply('ℹ️ Belum ada tether event.');
      let msg = `📊 <b>Tether hits (terbaru)</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const e of events) {
        msg += `• <code>${e.username}</code> ${e.address || ''} ${e.notified ? '🔔' : ''}\n  ${formatDate(e.at)}\n`;
      }
      const stats = database.getTetherStats();
      msg += `━━━━━━━━━━━━━━━━━━━━━━━\nTotal hit: ${stats.totalHits}`;
      return ctx.reply(msg, { parse_mode: 'HTML' });
    }

    if (sub === 'unban') {
      const username = parts[1];
      if (!username) return ctx.reply('❌ Pakai: /tether unban &lt;user&gt;', { parse_mode: 'HTML' });
      try {
        const mtUser = await mikrotik.getUserByName(username);
        if (!mtUser) return ctx.reply(`❌ User <code>${username}</code> gak ada di MikroTik`, { parse_mode: 'HTML' });
        const original = database.clearTetherPunish(username);
        const comment =
          original ||
          (mtUser.comment || '').replace(/\s*\|?\s*TETHER-BAN until [^\|]+/g, '').trim();
        await mikrotik.setUserDisabled(mtUser['.id'], false, comment || mtUser.comment);
        await ctx.reply(`🔓 Unban <code>${username}</code> OK`, { parse_mode: 'HTML' });
      } catch (err) {
        await ctx.reply(`❌ Unban gagal: <code>${err.message}</code>`, { parse_mode: 'HTML' });
      }
      return;
    }

    if (sub === 'reset') {
      const target = parts[1];
      if (!target || target === 'all') {
        database.resetAllTether();
        return ctx.reply('♻️ Semua counter tether di-reset.');
      }
      const ok = database.resetTetherUser(target);
      return ctx.reply(ok ? `♻️ Reset hit <code>${target}</code>` : `ℹ️ Tidak ada data ${target}`, {
        parse_mode: 'HTML',
      });
    }

    if (sub === 'scan') {
      await ctx.reply('🔍 Scan tether sekarang...');
      try {
        await runTetherScanNow();
        await ctx.reply('✅ Scan selesai. Cek notif / /tether hits');
      } catch (err) {
        await ctx.reply(`❌ Scan error: <code>${err.message}</code>`, { parse_mode: 'HTML' });
      }
      return;
    }

    await ctx.reply(`❓ Subcommand gak dikenal: <code>${sub}</code>\n\n` + helpText(), {
      parse_mode: 'HTML',
    });
  });

  // ── Callbacks (inline keyboard) ──

  bot.callbackQuery('menu:tether', async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyStatus(ctx);
  });

  bot.callbackQuery('tether:toggle', async (ctx) => {
    const next = !config.antiTether;
    applyAndRestart({ enabled: next });
    await ctx.answerCallbackQuery(next ? 'ON' : 'OFF');
    await replyStatus(ctx, true);
  });

  bot.callbackQuery('tether:togglepunish', async (ctx) => {
    const next = !config.tetherAutoPunish;
    applyAndRestart({ autoPunish: next });
    await ctx.answerCallbackQuery(next ? 'Punish ON' : 'Punish OFF');
    await replyStatus(ctx, true);
  });

  bot.callbackQuery(/^tether:set:(poll|cooldown|punish):(\d+)$/, async (ctx) => {
    const key = ctx.match[1];
    const n = Number(ctx.match[2]);
    const patch =
      key === 'poll'
        ? { pollSeconds: n }
        : key === 'cooldown'
          ? { cooldownMin: n }
          : { punishMin: n };
    const r = applyAndRestart(patch);
    await ctx.answerCallbackQuery(r.ok ? `OK ${key}=${n}` : r.error);
    await replyStatus(ctx, true);
  });

  bot.callbackQuery('tether:hits', async (ctx) => {
    await ctx.answerCallbackQuery();
    const events = database.getRecentTetherEvents(10);
    if (!events.length) {
      await ctx.reply('ℹ️ Belum ada tether event.');
      return;
    }
    let msg = `📊 <b>Tether hits</b>\n`;
    for (const e of events) {
      msg += `• <code>${e.username}</code> ${e.address || ''}\n`;
    }
    await ctx.reply(msg, { parse_mode: 'HTML' });
  });

  bot.callbackQuery('tether:scan', async (ctx) => {
    await ctx.answerCallbackQuery('Scanning...');
    await runTetherScanNow();
    await ctx.reply('✅ Scan selesai.');
  });

  bot.callbackQuery('tether:help', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(helpText(), { parse_mode: 'HTML' });
  });
}
