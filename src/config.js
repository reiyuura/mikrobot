import 'dotenv/config';

function required(key) {
  const value = process.env[key];
  if (!value) {
    console.error(`❌ Missing required env variable: ${key}`);
    process.exit(1);
  }
  return value;
}

export const config = {
  botToken: required('BOT_TOKEN'),
  adminIds: required('ADMIN_IDS').split(',').map(id => Number(id.trim())),

  router: {
    host: process.env.ROUTER_HOST || '10.10.10.2',
    port: Number(process.env.ROUTER_PORT) || 80,
    user: process.env.ROUTER_USER || 'admin',
    pass: process.env.ROUTER_PASS || '',
  },

  // Anti-tether: TTL=1 + drop TTL 63/127 + MAC bind
  // HOTSPOT_INTERFACE = iface ke client hotspot (bukan WAN)
  // HOTSPOT_SUBNET    = subnet pool hotspot
  hotspotInterface: process.env.HOTSPOT_INTERFACE || 'ether4',
  hotspotSubnet: process.env.HOTSPOT_SUBNET || '192.168.20.0/24',
  antiTether: process.env.ANTI_TETHER !== 'false', // default ON

  // Tether abuse detect + notify
  tetherList: process.env.TETHER_LIST || 'mikrobot-tether',
  tetherPollSeconds: Number(process.env.TETHER_POLL_SECONDS) || 30,
  tetherNotifyCooldownMin: Number(process.env.TETHER_NOTIFY_COOLDOWN_MIN) || 10,
  tetherPunishMin: Number(process.env.TETHER_PUNISH_MIN) || 5, // disable user N menit
  tetherListTimeout: process.env.TETHER_LIST_TIMEOUT || '10m',
  tetherAutoPunish: process.env.TETHER_AUTO_PUNISH !== 'false', // kick + disable

  usernameLength: Number(process.env.USERNAME_LENGTH) || 6,
  timezone: process.env.TIMEZONE || 'Asia/Jakarta',
};
