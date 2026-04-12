import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from './config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// ═══════════════════════════════════
//  USERNAME GENERATOR
// ═══════════════════════════════════

// Removed ambiguous chars: i, l, o, 0, 1
const CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateCode(length = config.usernameLength) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return result;
}

// ═══════════════════════════════════
//  DATE / TIME
// ═══════════════════════════════════

export function now() {
  return dayjs().tz(config.timezone);
}

export function formatDate(date) {
  return dayjs(date).tz(config.timezone).format('DD MMM YYYY, HH:mm [WIB]');
}

export function formatDateShort(date) {
  return dayjs(date).tz(config.timezone).format('DD-MMM-YYYY');
}

// ═══════════════════════════════════
//  FORMATTERS
// ═══════════════════════════════════

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const num = Number(bytes);
  if (isNaN(num)) return bytes;
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(num) / Math.log(k));
  return parseFloat((num / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatSpeed(rateLimit) {
  if (!rateLimit) return { upload: '-', download: '-', display: '-' };
  const parts = rateLimit.split('/');
  const upload = parts[0] || '-';
  const download = parts[1] || '-';
  return {
    upload,
    download,
    display: `↓${download} / ↑${upload}`,
  };
}

export function formatSessionTimeout(timeout) {
  if (!timeout || timeout === '00:00:00' || timeout === 'none') return 'Unlimited';
  // Parse MikroTik format like "1d 00:00:00" or "7d 00:00:00"
  const match = timeout.match(/(?:(\d+)w)?(?:(\d+)d)?(?:\s*(\d+):(\d+):(\d+))?/);
  if (!match) return timeout;
  const weeks = parseInt(match[1]) || 0;
  const days = parseInt(match[2]) || 0;
  const hours = parseInt(match[3]) || 0;

  const parts = [];
  if (weeks > 0) parts.push(`${weeks} Minggu`);
  if (days > 0) parts.push(`${days} Hari`);
  if (hours > 0) parts.push(`${hours} Jam`);
  return parts.length > 0 ? parts.join(' ') : timeout;
}

export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function profileLabel(name) {
  const labels = {
    '1hari': '1 Hari',
    '2hari': '2 Hari',
    '7hari': '7 Hari',
    'keluarga': 'Keluarga',
    'default': 'Default',
  };
  return labels[name] || name;
}

export function formatMemory(free, total) {
  const freeNum = Number(free);
  const totalNum = Number(total);
  if (isNaN(freeNum) || isNaN(totalNum) || totalNum === 0) return '-';
  const used = totalNum - freeNum;
  const percent = Math.round((used / totalNum) * 100);
  return `${formatBytes(used)} / ${formatBytes(totalNum)} (${percent}%)`;
}
