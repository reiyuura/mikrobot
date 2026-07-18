import 'dotenv/config';
import { database } from './database.js';

function required(key) {
  const value = process.env[key];
  if (!value) {
    console.error(`❌ Missing required env variable: ${key}`);
    process.exit(1);
  }
  return value;
}

function parseBool(v, defaultTrue = true) {
  if (v === undefined || v === null || v === '') return defaultTrue;
  const s = String(v).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return defaultTrue;
}

// Defaults from env (boot). Runtime overrides live in DB settings.
export const config = {
  botToken: required('BOT_TOKEN'),
  adminIds: required('ADMIN_IDS').split(',').map((id) => Number(id.trim())),

  router: {
    host: process.env.ROUTER_HOST || '10.10.10.2',
    port: Number(process.env.ROUTER_PORT) || 80,
    user: process.env.ROUTER_USER || 'admin',
    pass: process.env.ROUTER_PASS || '',
  },

  // Anti-tether segments
  // hotspot = voucher (ether4 / 192.168.20.0/24)
  // tetangga = WiFi tetangga plain DHCP (ether2 / 192.168.30.0/24)
  hotspotInterface: process.env.HOTSPOT_INTERFACE || 'ether4',
  hotspotSubnet: process.env.HOTSPOT_SUBNET || '192.168.20.0/24',
  tetanggaInterface: process.env.TETANGGA_INTERFACE || 'ether2',
  tetanggaSubnet: process.env.TETANGGA_SUBNET || '192.168.30.0/24',
  tetanggaPoolName: process.env.TETANGGA_POOL_NAME || 'pool-tetangga',
  tetanggaMaxDevices: Number(process.env.TETANGGA_MAX_DEVICES) || 5,
  antiTether: parseBool(process.env.ANTI_TETHER, true),
  antiTetherTetangga: parseBool(process.env.ANTI_TETHER_TETANGGA, true),
  // HARD detect TTL63/127 sering false-positive (HP normal, Android 10, VPN).
  // Default SOFT keduanya: TTL=1 (+ MAC bind hotspot / pool max tetangga), TANPA mark/drop/ban.
  // Set true hanya kalau sadar risk ban orang normal.
  tetherHotspotHard: parseBool(process.env.TETHER_HOTSPOT_HARD, false),
  tetherTetanggaHard: parseBool(process.env.TETHER_TETANGGA_HARD, false),

  // Tether abuse detect + notify (mutable via /tether)
  tetherList: process.env.TETHER_LIST || 'mikrobot-tether',
  tetherPollSeconds: Number(process.env.TETHER_POLL_SECONDS) || 30,
  tetherNotifyCooldownMin: Number(process.env.TETHER_NOTIFY_COOLDOWN_MIN) || 10,
  tetherPunishMin: Number(process.env.TETHER_PUNISH_MIN) || 5,
  tetherListTimeout: process.env.TETHER_LIST_TIMEOUT || '10m',
  // Default false — soft mode. HARD + autoPunish true = risk ban massal.
  tetherAutoPunish: parseBool(process.env.TETHER_AUTO_PUNISH, false),

  // Secondary AP/router (e.g. TL-WR840N) — traffic NAT lewat sini, jangan ban
  // Comma-separated. Default: WR840N tetangga.
  tetherWhitelistIps: (process.env.TETHER_WHITELIST_IPS || '192.168.30.11')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  tetherWhitelistMacs: (process.env.TETHER_WHITELIST_MACS || '40:3F:8C:DF:43:EA')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),

  usernameLength: Number(process.env.USERNAME_LENGTH) || 6,
  timezone: process.env.TIMEZONE || 'Asia/Jakarta',
};

/** True if IP/MAC is secondary AP/router whitelist (skip ban/notify). */
export function isTetherWhitelisted({ address, mac } = {}) {
  const ip = String(address || '').trim();
  const m = String(mac || '').trim().toUpperCase();
  if (ip && config.tetherWhitelistIps.includes(ip)) return true;
  if (m && config.tetherWhitelistMacs.includes(m)) return true;
  return false;
}

/** Segments protected by anti-tether rules. */
export function getAntiTetherSegments() {
  const segs = [
    {
      name: 'hotspot',
      interface: config.hotspotInterface,
      subnet: config.hotspotSubnet,
      commentPrefix: 'MikroBot',
      kind: 'hotspot',
      // soft default: TTL=1 + MAC bind. hardDetect=true = mark/drop TTL63 (risk ban A10/VPN)
      hardDetect: config.tetherHotspotHard,
    },
  ];
  if (config.antiTetherTetangga) {
    segs.push({
      name: 'tetangga',
      interface: config.tetanggaInterface,
      subnet: config.tetanggaSubnet,
      commentPrefix: 'MikroBot tetangga',
      kind: 'dhcp',
      // soft default: TTL=1 + pool max. hardDetect=true = mark/drop/ban (risk)
      hardDetect: config.tetherTetanggaHard,
    });
  }
  return segs;
}

/** Snapshot of env defaults (before DB override). */
export const tetherDefaults = {
  antiTether: config.antiTether,
  tetherPollSeconds: config.tetherPollSeconds,
  tetherNotifyCooldownMin: config.tetherNotifyCooldownMin,
  tetherPunishMin: config.tetherPunishMin,
  tetherListTimeout: config.tetherListTimeout,
  tetherAutoPunish: config.tetherAutoPunish,
  tetherList: config.tetherList,
};

/**
 * Apply runtime tether settings from DB onto live config object.
 * Call once at startup (and after each /tether set).
 */
export function applyTetherSettingsFromDb() {
  const s = database.getSettings()?.tether || {};
  if (typeof s.enabled === 'boolean') config.antiTether = s.enabled;
  if (Number.isFinite(s.pollSeconds) && s.pollSeconds >= 10) {
    config.tetherPollSeconds = Math.floor(s.pollSeconds);
  }
  if (Number.isFinite(s.cooldownMin) && s.cooldownMin >= 0) {
    config.tetherNotifyCooldownMin = Math.floor(s.cooldownMin);
  }
  if (Number.isFinite(s.punishMin) && s.punishMin >= 0) {
    config.tetherPunishMin = Math.floor(s.punishMin);
  }
  if (typeof s.autoPunish === 'boolean') config.tetherAutoPunish = s.autoPunish;
  if (typeof s.listTimeout === 'string' && s.listTimeout.trim()) {
    config.tetherListTimeout = s.listTimeout.trim();
  }
  if (typeof s.list === 'string' && s.list.trim()) {
    config.tetherList = s.list.trim();
  }
  return getTetherRuntime();
}

export function getTetherRuntime() {
  return {
    enabled: config.antiTether,
    tetanggaEnabled: config.antiTetherTetangga,
    hotspotHard: config.tetherHotspotHard,
    tetanggaHard: config.tetherTetanggaHard,
    pollSeconds: config.tetherPollSeconds,
    cooldownMin: config.tetherNotifyCooldownMin,
    punishMin: config.tetherPunishMin,
    autoPunish: config.tetherAutoPunish,
    listTimeout: config.tetherListTimeout,
    list: config.tetherList,
    interface: config.hotspotInterface,
    subnet: config.hotspotSubnet,
    tetanggaInterface: config.tetanggaInterface,
    tetanggaSubnet: config.tetanggaSubnet,
    tetanggaMaxDevices: config.tetanggaMaxDevices,
    segments: getAntiTetherSegments().map((s) => s.name),
    whitelistIps: [...config.tetherWhitelistIps],
    whitelistMacs: [...config.tetherWhitelistMacs],
  };
}

/**
 * Update one or more tether settings (persist + apply).
 * Returns { ok, error?, runtime }.
 */
export function updateTetherSettings(patch = {}) {
  const next = { ...(database.getSettings()?.tether || {}) };
  const errors = [];

  if ('enabled' in patch) {
    if (typeof patch.enabled !== 'boolean') errors.push('enabled must be bool');
    else next.enabled = patch.enabled;
  }
  if ('pollSeconds' in patch) {
    const n = Number(patch.pollSeconds);
    if (!Number.isFinite(n) || n < 10 || n > 3600) errors.push('poll 10–3600 detik');
    else next.pollSeconds = Math.floor(n);
  }
  if ('cooldownMin' in patch) {
    const n = Number(patch.cooldownMin);
    if (!Number.isFinite(n) || n < 0 || n > 1440) errors.push('cooldown 0–1440 menit');
    else next.cooldownMin = Math.floor(n);
  }
  if ('punishMin' in patch) {
    const n = Number(patch.punishMin);
    if (!Number.isFinite(n) || n < 0 || n > 1440) errors.push('punish 0–1440 menit');
    else next.punishMin = Math.floor(n);
  }
  if ('autoPunish' in patch) {
    if (typeof patch.autoPunish !== 'boolean') errors.push('autoPunish must be bool');
    else next.autoPunish = patch.autoPunish;
  }
  if ('listTimeout' in patch) {
    const v = String(patch.listTimeout || '').trim();
    if (!/^\d+[smhd]$/i.test(v)) errors.push('listTimeout format e.g. 10m, 1h');
    else next.listTimeout = v.toLowerCase();
  }

  if (errors.length) {
    return { ok: false, error: errors.join('; '), runtime: getTetherRuntime() };
  }

  database.setSettings({ tether: next });
  const runtime = applyTetherSettingsFromDb();
  return { ok: true, runtime, saved: next };
}
