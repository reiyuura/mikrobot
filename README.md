# 🤖 MikroBot

Telegram Bot untuk manajemen **Hotspot MikroTik** via REST API. Buat, kelola, dan hapus user hotspot langsung dari Telegram.

Pengganti [MiHKMon](https://github.com/laksa19/mihkmon) yang sudah outdated dan buggy di RouterOS 7.x.

## ✨ Fitur

| Command | Deskripsi |
|---------|-----------|
| `/start` | Menu utama dengan inline keyboard |
| `/adduser` | Buat 1 user hotspot baru (pilih profile → auto generate) |
| `/voucher` | Generate batch voucher (3/5/10/20 sekaligus) |
| `/listuser` | Lihat semua user dengan pagination |
| `/deleteuser` | Hapus user + kick session aktif |
| `/active` | Lihat user yang sedang online |
| `/info` | Info server (CPU, RAM, uptime) |
| `/help` | Panduan penggunaan |

### Highlight
- 🔐 **Admin-only** — hanya Telegram ID tertentu yang bisa akses
- 🔗 **WireGuard** — koneksi aman VPS ↔ MikroTik (support CGNAT)
- ⚡ **REST API** — native RouterOS 7.x, tanpa library tambahan
- 📊 **Logging** — semua user yang dibuat tercatat di database
- 🎫 **Batch Voucher** — generate banyak user sekaligus
- 📋 **Username = Password** — format simple, tinggal copy

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
# Enable www service (hanya allow dari WireGuard IP)
/ip service set www address=10.10.10.1/32 disabled=no port=80

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

# Hotspot
HOTSPOT_SERVER=hsprof1

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
| `HOTSPOT_SERVER` | Nama hotspot server di MikroTik |
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

## 📱 Cara Pakai

### Tambah User
1. Kirim `/adduser` atau tap "➕ Tambah User" di menu
2. Pilih profile (1 Hari, 2 Hari, 7 Hari, Keluarga)
3. Bot auto-generate username & password (format: `abc123` / `abc123`)
4. Copy username/password, berikan ke customer

### Generate Voucher
1. Kirim `/voucher`
2. Pilih profile
3. Pilih jumlah (3, 5, 10, atau 20)
4. Bot generate semua voucher sekaligus

### Hapus User
- Kirim `/deleteuser` → pilih dari daftar
- Atau langsung: `/deleteuser username123`
- User yang sedang online akan di-kick otomatis

## 🔧 Kustomisasi Profile

Edit file `src/utils.js` untuk menyesuaikan profile hotspot:

```js
export const PROFILES = {
  '1hari': {
    name: '1hari',
    label: '1 Hari',
    'session-timeout': '1d 00:00:00',
    'rate-limit': '3M/10M',
  },
  // Tambah profile baru di sini...
};
```

> Profile harus **sama persis** dengan nama user profile di MikroTik.

## 🏗 Arsitektur

```
┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
│ Admin        │     │  VPS Ubuntu       │     │  MikroTik    │
│ (Telegram)   │────▶│  MikroBot (Node)  │────▶│  RouterOS 7  │
│              │◀────│  Grammy + Axios   │◀────│  REST API    │
└──────────────┘     │  WireGuard Client │     │  WireGuard   │
                     └───────────────────┘     └──────────────┘
                      10.10.10.1                10.10.10.2
```

## 📁 Struktur Project

```
mikrobot/
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── src/
│   ├── index.js          # Entry point
│   ├── bot.js            # Grammy bot + admin middleware
│   ├── config.js         # Environment config
│   ├── mikrotik.js       # MikroTik REST API client
│   ├── database.js       # JSON-based logging
│   ├── utils.js          # Helpers + profile definitions
│   └── commands/
│       ├── start.js      # /start
│       ├── adduser.js    # /adduser
│       ├── voucher.js    # /voucher
│       ├── listuser.js   # /listuser
│       ├── deleteuser.js # /deleteuser
│       ├── activeuser.js # /active
│       ├── serverinfo.js # /info
│       └── help.js       # /help
└── data/
    └── mikrobot.json     # Database (auto-created)
```

## 🔐 Keamanan

- REST API di-bind hanya ke IP WireGuard (`10.10.10.1/32`)
- Hanya admin (by Telegram ID) yang bisa mengakses bot
- Semua traffic terenkripsi melalui WireGuard tunnel
- Gunakan user API terpisah di MikroTik (jangan pakai admin)

## 📄 Lisensi

MIT License — Bebas dipakai dan dimodifikasi.

## 🙏 Credits

- [Grammy](https://grammy.dev/) — Telegram Bot framework
- [MikroTik REST API](https://help.mikrotik.com/docs/display/ROS/REST+API) — RouterOS 7.x
- [WireGuard](https://www.wireguard.com/) — VPN tunnel
