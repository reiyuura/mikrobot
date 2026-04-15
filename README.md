# 🤖 MikroBot

Telegram Bot untuk manajemen **Hotspot MikroTik** via REST API. Buat, kelola, dan hapus user hotspot langsung dari Telegram.

Pengganti [MiHKMon](https://github.com/laksa19/mihkmon) yang sudah outdated dan buggy di RouterOS 7.x.

## ✨ Fitur

| Command | Deskripsi |
|---------|-----------|
| `/start` | Menu utama dengan inline keyboard |
| `/adduser` | Buat user (auto generate username/password) |
| `/adduser nama` | Buat user manual (username = password) |
| `/adduser user pass` | Buat user dengan custom user & password |
| `/voucher` | Generate batch voucher (3/5/10/20 sekaligus) |
| `/listuser` | Lihat semua user dengan pagination |
| `/deleteuser` | Hapus user + kick session aktif |
| `/active` | Lihat user yang sedang online |
| `/info` | Info server (CPU, RAM, uptime) |
| `/income` | Laporan pendapatan (harian/mingguan/bulanan) |
| `/help` | Panduan penggunaan |

### Highlight
- 🔐 **Admin-only** — hanya Telegram ID tertentu yang bisa akses
- 🔗 **WireGuard** — koneksi aman VPS ↔ MikroTik (support CGNAT)
- ⚡ **REST API** — native RouterOS 7.x, tanpa library tambahan
- 🧹 **Auto-cleanup** — user otomatis dihapus saat masa aktif habis
- 💰 **Income tracking** — pendapatan dihitung saat user pertama kali login
- 🎫 **Batch Voucher** — generate banyak user sekaligus
- 📋 **Username = Password** — format simple, tinggal copy
- 📊 **Manual & Auto** — bisa buat user custom atau auto generate

## 💰 Harga Default

| Profile | Harga | Masa Aktif | Speed |
|---------|-------|------------|-------|
| 1 Hari | Rp 3.000 | 1 hari | ↓10M / ↑3M |
| 2 Hari | Rp 5.000 | 2 hari | ↓15M / ↑3M |
| 7 Hari | Rp 15.000 | 7 hari | ↓20M / ↑4M |
| Keluarga | Rp 50.000 | 30 hari | ↓20M / ↑5M |

> Edit `src/utils.js` untuk menyesuaikan harga dan profile.

## 📋 Persyaratan

- **MikroTik** RouterOS 7.x (tested on 7.21.3)
- **VPS** Ubuntu 20.04+ dengan Node.js 18+
- **WireGuard** tunnel antara VPS dan MikroTik
- **Telegram Bot Token** dari [@BotFather](https://t.me/BotFather)

## 🛠 Instalasi

### 1. Setup WireGuard

Bot berjalan di VPS dan berkomunikasi dengan MikroTik melalui WireGuard tunnel.

<details>
<summary><b>📖 Panduan WireGuard (klik untuk expand)</b></summary>

#### VPS (Ubuntu) — WireGuard Server

```bash
# Install WireGuard
sudo apt update && sudo apt install wireguard -y

# Generate keys
wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key

# Lihat keys
cat /etc/wireguard/server_private.key
cat /etc/wireguard/server_public.key
```

Edit config:
```bash
sudo nano /etc/wireguard/wg0.conf
```

```ini
[Interface]
PrivateKey = <PRIVATE_KEY_VPS>
Address = 10.10.10.1/24
ListenPort = 51820
PostUp = iptables -A INPUT -p udp --dport 51820 -j ACCEPT
PostDown = iptables -D INPUT -p udp --dport 51820 -j ACCEPT

[Peer]
# MikroTik
PublicKey = <PUBLIC_KEY_MIKROTIK>
AllowedIPs = 10.10.10.2/32
```

```bash
sudo systemctl enable --now wg-quick@wg0
```

#### MikroTik — WireGuard Client

```
# Buat WireGuard interface
/interface wireguard add name=wg-vps listen-port=13231

# Lihat public key (catat untuk config VPS)
/interface wireguard print

# Tambah peer (VPS)
/interface wireguard peers add \
  interface=wg-vps \
  public-key="<PUBLIC_KEY_VPS>" \
  endpoint-address=<IP_PUBLIC_VPS> \
  endpoint-port=51820 \
  allowed-address=10.10.10.0/24 \
  persistent-keepalive=25

# Assign IP
/ip address add address=10.10.10.2/24 interface=wg-vps

# Firewall
/ip firewall filter add chain=input action=accept protocol=udp dst-port=13231
```

> **Penting:** Public key saling tukar!
> - VPS config `[Peer]` → isi public key **MikroTik**
> - MikroTik peer → isi public key **VPS**

#### Aktifkan REST API di MikroTik

```
# Enable www service (allow dari WireGuard + lokal)
/ip service set www address=10.10.10.1/32,192.168.88.0/24 disabled=no port=80

# Buat user khusus API
/user add name=mikrobot password=PASSWORD_KUAT group=full
```

#### Verifikasi

```bash
# Dari VPS
ping 10.10.10.2
curl -u mikrobot:PASSWORD http://10.10.10.2/rest/system/resource
```

</details>

### 2. Deploy Bot

```bash
# Clone repository
git clone https://github.com/username/mikrobot.git /opt/mikrobot
cd /opt/mikrobot

# Install dependencies
npm install

# Copy dan edit config
cp .env.example .env
nano .env
```

### 3. Konfigurasi `.env`

```env
# Telegram Bot (dari @BotFather)
BOT_TOKEN=your_telegram_bot_token
ADMIN_IDS=123456789

# MikroTik (via WireGuard)
ROUTER_HOST=10.10.10.2
ROUTER_PORT=80
ROUTER_USER=mikrobot
ROUTER_PASS=your_password

# Settings
USERNAME_LENGTH=6
TIMEZONE=Asia/Jakarta
```

| Variable | Deskripsi |
|----------|-----------|
| `BOT_TOKEN` | Token dari @BotFather |
| `ADMIN_IDS` | Telegram user ID admin (pisahkan dengan koma untuk multiple admin) |
| `ROUTER_HOST` | IP MikroTik di WireGuard network |
| `ROUTER_PORT` | Port REST API (default: 80) |
| `ROUTER_USER` | Username API di MikroTik |
| `ROUTER_PASS` | Password API |
| `USERNAME_LENGTH` | Panjang username yang di-generate (default: 6) |
| `TIMEZONE` | Timezone untuk format tanggal |

> 💡 Dapatkan Telegram ID kamu dengan mengirim pesan ke [@userinfobot](https://t.me/userinfobot)

### 4. Jalankan

```bash
# Test run
node src/index.js

# Production dengan PM2
npm install -g pm2
pm2 start src/index.js --name mikrobot
pm2 startup
pm2 save
```

### 5. WireGuard Watchdog (Recommended)

Kalau ISP pakai **CGNAT**, IP publik MikroTik bisa berubah setelah mati listrik/reboot. Pasang watchdog agar tunnel auto-recover:

```bash
# Copy script
sudo cp scripts/wg-watchdog.sh /opt/wg-watchdog.sh
sudo chmod +x /opt/wg-watchdog.sh

# Test
sudo /opt/wg-watchdog.sh

# Pasang cron (cek setiap 5 menit)
sudo crontab -e
```

Tambahkan baris ini:
```
*/5 * * * * /opt/wg-watchdog.sh
```

> 📋 Log watchdog bisa dilihat di `/var/log/wg-watchdog.log`

## 📱 Cara Pakai

### Tambah User

**Auto generate:**
1. Kirim `/adduser` atau tap "➕ Tambah User" di menu
2. Pilih profile (1 Hari, 2 Hari, 7 Hari, Keluarga)
3. Bot auto-generate username & password (format: `abc123` / `abc123`)

**Manual username:**
1. Kirim `/adduser nama` → username=password=nama
2. Atau `/adduser user pass` → custom username & password
3. Pilih profile, selesai!

### Generate Voucher
1. Kirim `/voucher`
2. Pilih profile
3. Pilih jumlah (3, 5, 10, atau 20)
4. Bot generate semua voucher sekaligus

### Hapus User
- Kirim `/deleteuser` → pilih dari daftar
- Atau langsung: `/deleteuser username123`
- User yang sedang online akan di-kick otomatis

### Laporan Pendapatan
- Kirim `/income` → pilih periode (hari ini, minggu ini, bulan ini, atau total)
- Income **hanya dihitung saat user pertama kali login** ke hotspot
- Breakdown per profile: jumlah × harga

### Auto-Cleanup
- Bot cek setiap **1 jam** apakah ada user yang masa aktifnya sudah habis
- User expired otomatis **di-kick + dihapus** dari MikroTik
- Admin mendapat **notifikasi** di Telegram setiap kali ada user yang dihapus

## 🔧 Kustomisasi Profile & Harga

Edit file `src/utils.js`:

```js
export const PROFILES = {
  '1hari': {
    name: '1hari',
    label: '1 Hari',
    'session-timeout': '1d 00:00:00',
    'rate-limit': '3M/10M',
    price: 3000,        // Harga dalam Rupiah
    validityDays: 1,    // Masa aktif (hari)
  },
  // Tambah profile baru di sini...
};
```

> ⚠️ Nama profile (`name`) harus **sama persis** dengan user-profile di MikroTik.

## 🏗 Arsitektur

```
┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
│ Admin        │     │  VPS Ubuntu       │     │  MikroTik    │
│ (Telegram)   │────▶│  MikroBot (Node)  │────▶│  RouterOS 7  │
│              │◀────│  Grammy + Axios   │◀────│  REST API    │
└──────────────┘     │  WireGuard Client │     │  WireGuard   │
                     │  ⏰ Scheduler      │     └──────────────┘
                     └───────────────────┘
                      10.10.10.1                10.10.10.2
```

### Alur Income
```
User dibuat → Belum login (income: 0)
           → Pertama login ke hotspot
           → Scheduler deteksi di active sessions
           → Income tercatat ✅
```

## 📁 Struktur Project

```
mikrobot/
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── scripts/
│   └── wg-watchdog.sh    # Auto-recovery WireGuard tunnel
├── hotspot/               # Template login MikroTik
│   ├── login.html         # Login (2 tab: Voucher + Manual)
│   ├── alogin.html        # After login + status
│   ├── status.html        # Status koneksi
│   ├── logout.html        # Logout + summary
│   ├── error.html         # Error page
│   ├── redirect.html      # Redirect page
│   └── md5.js             # CHAP authentication
├── src/
│   ├── index.js           # Entry point
│   ├── bot.js             # Grammy bot + admin middleware
│   ├── config.js          # Environment config
│   ├── mikrotik.js        # MikroTik REST API client
│   ├── database.js        # JSON-based logging + income tracking
│   ├── scheduler.js       # Auto-cleanup + activation checker
│   ├── utils.js           # Helpers + profile/price definitions
│   └── commands/
│       ├── start.js       # /start
│       ├── adduser.js     # /adduser (auto & manual)
│       ├── voucher.js     # /voucher
│       ├── listuser.js    # /listuser
│       ├── deleteuser.js  # /deleteuser
│       ├── activeuser.js  # /active
│       ├── serverinfo.js  # /info
│       ├── income.js      # /income
│       └── help.js        # /help
└── data/
    └── mikrobot.json      # Database (auto-created)
```

## 🔐 Keamanan

- REST API di-bind hanya ke IP WireGuard (`10.10.10.1/32`)
- Hanya admin (by Telegram ID) yang bisa mengakses bot
- Semua traffic terenkripsi melalui WireGuard tunnel
- Gunakan user API terpisah di MikroTik (jangan pakai admin)
- WireGuard watchdog auto-recovery jika tunnel putus (CGNAT)

## 📄 Lisensi

MIT License — Bebas dipakai dan dimodifikasi.

## 🙏 Credits

- [Grammy](https://grammy.dev/) — Telegram Bot framework
- [MikroTik REST API](https://help.mikrotik.com/docs/display/ROS/REST+API) — RouterOS 7.x
- [WireGuard](https://www.wireguard.com/) — VPN tunnel
