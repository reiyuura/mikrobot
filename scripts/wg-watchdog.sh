#!/bin/bash
# ═══════════════════════════════════
#  WireGuard Watchdog for MikroBot
#  Cek koneksi tiap 5 menit via cron
#  Restart WireGuard otomatis jika putus
# ═══════════════════════════════════

PING_TARGET="10.10.10.2"
LOG="/var/log/wg-watchdog.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Ping 3x, timeout 5s
if ping -c 3 -W 5 "$PING_TARGET" > /dev/null 2>&1; then
    # Tunnel OK — do nothing
    exit 0
fi

# Tunnel down — restart WireGuard
echo "[$TIMESTAMP] ⚠️  Tunnel down, restarting wg-quick@wg0..." >> "$LOG"
systemctl restart wg-quick@wg0
sleep 5

# Verify
if ping -c 3 -W 5 "$PING_TARGET" > /dev/null 2>&1; then
    echo "[$TIMESTAMP] ✅ Tunnel restored!" >> "$LOG"
else
    echo "[$TIMESTAMP] ❌ Tunnel still down after restart." >> "$LOG"
fi
