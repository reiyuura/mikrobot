# 🤖 MikroBot

Telegram Bot untuk manajemen **Hotspot MikroTik** via REST API. Buat, kelola, dan hapus user hotspot langsung dari Telegram — plus **anti-tether** untuk voucher & WiFi tetangga.

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
| `/tether` | Status & setting anti-tether (runtime) |
| `/reboot` | Reboot MikroTik (dengan konfirmasi) |
| `/help` | Panduan penggunaan |

### Highlight
- 🔐 **Admin-only** — hanya Telegram ID tertentu yang bisa akses
- 🔗 **WireGuard** — koneksi aman VPS ↔ MikroTik (support CGNAT)
- ⚡ **REST API** — native RouterOS 7.x, tanpa library tambahan
- 🧹 **Auto-cleanup** — user otomatis dihapus saat masa aktif habis
- 💰 **Income tracking** — pendapatan dihitung saat user pertama kali login
- 🎫 **Batch Voucher** — generate banyak user sekaligus
- 📋 **Username = Password** — format simple, tinggal copy
- 🛡 **Anti-tether** — blok HP share hotspot (voucher + WiFi tetangga)
- 📡 **Multi-segment** — hotspot voucher + plain DHCP tetangga
- 🌐 **WebFig Proxy** — akses MikroTik WebFig dari mana saja via HTTPS
- 🔄 **Reboot** — restart router dari Telegram dengan auto status check

---

## 🛡 Anti-Tether

Blok user yang **share / tethering ulang** internet (HP → hotspot → HP lain).

### Cara kerja (3 layer)

```
1) TTL=1  → paket ke client di-set TTL 1 (HP di belakang gak bisa route)
2) Drop   → paket masuk dengan TTL 63/127 (ciri Android/iOS tether) di-drop
3) Mark   → IP offender masuk address-list → bot notif + punish
```

| Segment | Interface (default) | Subnet | Identitas | Punish |
|---------|---------------------|--------|-----------|--------|
| **Hotspot voucher** | `ether4` | `192.168.20.0/24` | username hotspot | kick session + disable user N menit |
| **WiFi tetangga** | `ether2` | `192.168.30.0/24` | DHCP lease (IP/MAC) | ban IP + disable lease N menit |

### Topologi tetangga (recommended)

```
Internet
   └── MikroTik
          ├── ether4  → Hotspot voucher (192.168.20.0/24)
          └── ether2  → WiFi tetangga (192.168.30.0/24)
                          └── AP TL-WR840N (mode AP/bridge, DHCP MATI)
                                 ├── HP tetangga .10
                                 ├── AP sendiri  .11  ← whitelist
                                 ├── HP tetangga .12
                                 └── HP tetangga .14
```

> **Penting:** AP secondary (TL-WR840N dll) harus **mode Access Point / bridge**, DHCP server di AP **mati**.  
> Client harus dapat IP **langsung dari MikroTik** biar anti-tether & limit 5 device akurat.  
> Kalau AP masih NAT, MikroTik cuma liat 1 IP (gateway) → gak bisa deteksi tether per-HP.

### Whitelist secondary AP

Router/AP yang cuma nerusin WiFi (bukan client) di-whitelist biar **gak kena ban**:

| Env | Contoh | Fungsi |
|-----|--------|--------|
| `TETHER_WHITELIST_IPS` | `192.168.30.11` | IP AP di DHCP MikroTik |
| `TETHER_WHITELIST_MACS` | `40:3F:8C:DF:43:EA` | MAC AP |

Bot + firewall MikroTik skip ban/mark/drop untuk IP/MAC ini.

### Limit 5 device tetangga

Pool DHCP `pool-tetangga` di-lock ke **5 IP** (default `.10`–`.14`).  
Device ke-6 **gak dapat IP**.

### Command `/tether`

```
/tether                 → status + tombol
/tether on | off        → nyala/mati monitor
/tether poll <detik>    → interval cek (10–3600)
/tether cooldown <m>    → jeda notif admin
/tether punish <m>      → lama ban
/tether autopunish on|off
/tether hits [user]     → riwayat hit
/tether unban <user>    → lepas ban sekarang
/tether reset [user|all]
/tether scan            → scan manual
/tether help
```

Setting runtime disimpan di `data/mikrobot.json` (survive restart).

### Notif & punish

| Siapa | Apa yang terjadi |
|-------|------------------|
| **Admin Telegram** | Notif: segment, IP, MAC, hit count, aksi |
| **User voucher** | Kick + disable account N menit (internet mati = "notif") |
| **Device tetangga** | IP ban list + lease disable N menit |
| **Setelah ban habis** | Auto re-enable / unban |

Default: poll **30s**, punish **5 menit**, cooldown notif **10 menit**.

---

## 💰 Harga Default

| Profile | Harga | Masa Aktif | Speed |
|---------|-------|------------|-------|
| 1 Hari | Rp 3.000 | 1 hari | ↓10M / ↑3M |
| 2 Hari | Rp 5.000 | 2 hari | ↓15M / ↑3M |
| 7 Hari | Rp 15.000 | 7 hari | ↓20M / ↑4M |
| Keluarga | Rp 50.000 | 30 hari | ↓20M / ↑5M |

> Edit `src/utils.js` untuk menyesuaikan harga dan profile.  
> Profile voucher juga di-set **MAC bind on-login** (1 device per voucher).

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
git clone https://github.com/reiyuura/mikrobot.git /opt/mikrobot
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

# Anti-tether hotspot voucher
ANTI_TETHER=true
HOTSPOT_INTERFACE=ether4
HOTSPOT_SUBNET=192.168.20.0/24

# Anti-tether WiFi tetangga (plain DHCP)
ANTI_TETHER_TETANGGA=true
TETANGGA_INTERFACE=ether2
TETANGGA_SUBNET=192.168.30.0/24
TETANGGA_POOL_NAME=pool-tetangga
TETANGGA_MAX_DEVICES=5

# Whitelist AP secondary (TL-WR840N dll)
TETHER_WHITELIST_IPS=192.168.30.11
TETHER_WHITELIST_MACS=40:3F:8C:DF:43:EA

# Tether monitor
TETHER_LIST=mikrobot-tether
TETHER_LIST_TIMEOUT=10m
TETHER_POLL_SECONDS=30
TETHER_NOTIFY_COOLDOWN_MIN=10
TETHER_PUNISH_MIN=5
TETHER_AUTO_PUNISH=true
```

| Variable | Deskripsi |
|----------|-----------|
| `BOT_TOKEN` | Token dari @BotFather |
| `ADMIN_IDS` | Telegram user ID admin (pisah koma untuk multi admin) |
| `ROUTER_HOST` | IP MikroTik di WireGuard network |
| `ROUTER_PORT` | Port REST API (default: 80) |
| `ROUTER_USER` / `ROUTER_PASS` | Kredensial API MikroTik |
| `USERNAME_LENGTH` | Panjang username generate (default: 6) |
| `TIMEZONE` | Timezone format tanggal |
| `ANTI_TETHER` | Master switch anti-tether |
| `HOTSPOT_INTERFACE` / `HOTSPOT_SUBNET` | Segment voucher |
| `ANTI_TETHER_TETANGGA` | ON/OFF anti-tether WiFi tetangga |
| `TETANGGA_INTERFACE` / `TETANGGA_SUBNET` | Segment DHCP tetangga |
| `TETANGGA_POOL_NAME` | Nama IP pool DHCP tetangga |
| `TETANGGA_MAX_DEVICES` | Max IP di pool (default: 5) |
| `TETHER_WHITELIST_IPS` | IP AP secondary, koma-separated |
| `TETHER_WHITELIST_MACS` | MAC AP secondary, koma-separated |
| `TETHER_POLL_SECONDS` | Interval cek offender (default: 30) |
| `TETHER_PUNISH_MIN` | Lama ban (menit, default: 5) |
| `TETHER_NOTIFY_COOLDOWN_MIN` | Jeda notif admin per user (default: 10) |
| `TETHER_AUTO_PUNISH` | Auto kick/ban saat deteksi tether |

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

Saat boot, bot **auto-ensure**:
1. Rule anti-tether hotspot + tetangga (idempotent)
2. Lock pool tetangga ke max devices
3. Whitelist AP secondary
4. MAC bind di profile voucher

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

### Anti-Tether
- Kirim `/tether` → lihat status multi-segment + whitelist
- Toggle ON/OFF, poll, punish dari keyboard atau command
- Kalau ada yang share: admin dapat notif, offender di-ban sementara

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
┌──────────────┐     ┌───────────────────┐     ┌──────────────────────────┐
│ Admin        │     │  VPS Ubuntu       │     │  MikroTik RouterOS 7     │
│ (Telegram)   │────▶│  MikroBot (Node)  │────▶│  REST API                │
│              │◀────│  Grammy + Axios   │◀────│  WireGuard 10.10.10.2    │
└──────────────┘     │  WireGuard Client │     │                          │
                     │  ⏰ Scheduler      │     │  ether4 → Hotspot        │
                     │  🛡 Tether poll    │     │  ether2 → DHCP tetangga  │
                     └───────────────────┘     │       └── AP (bridge)    │
                      10.10.10.1               └──────────────────────────┘
```

### Alur Income
```
User dibuat → Belum login (income: 0)
           → Pertama login ke hotspot
           → Scheduler deteksi di active sessions
           → Income tercatat ✅
```

### Alur Anti-Tether
```
Client share hotspot
  → paket TTL 63/127
  → filter mark → address-list mikrobot-tether
  → filter drop (traffic mati)
  → bot poll 30s → map IP → user/lease
  → notif admin + punish (kick/ban)
  → setelah N menit → auto restore
```

## 📁 Struktur Project

```
mikrobot/
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── scripts/
│   └── wg-watchdog.sh       # Auto-recovery WireGuard tunnel
├── hotspot/                 # Template login MikroTik
│   ├── login.html
│   ├── alogin.html
│   ├── status.html
│   ├── logout.html
│   ├── error.html
│   ├── redirect.html
│   └── md5.js
├── src/
│   ├── index.js             # Entry point + ensure anti-tether on boot
│   ├── bot.js               # Grammy bot + admin middleware
│   ├── config.js            # Env + tether runtime settings
│   ├── mikrotik.js          # REST client, anti-tether, whitelist, pool
│   ├── database.js          # JSON DB: users, income, tether state
│   ├── scheduler.js         # Cleanup + tether poll/punish/restore
│   ├── utils.js             # Helpers + profile/price
│   └── commands/
│       ├── start.js
│       ├── adduser.js
│       ├── voucher.js
│       ├── listuser.js
│       ├── deleteuser.js
│       ├── activeuser.js
│       ├── serverinfo.js
│       ├── income.js
│       ├── tether.js        # /tether settings
│       ├── reboot.js
│       └── help.js
└── data/
    └── mikrobot.json        # Database (gitignored, auto-created)
```

## 🔐 Keamanan

- REST API di-bind hanya ke IP WireGuard (`10.10.10.1/32`)
- Hanya admin (by Telegram ID) yang bisa mengakses bot
- Semua traffic terenkripsi melalui WireGuard tunnel
- Gunakan user API terpisah di MikroTik (jangan pakai admin)
- WireGuard watchdog auto-recovery jika tunnel putus (CGNAT)
- Secondary AP di-whitelist biar gak salah-ban; client di belakang AP tetap di-monitor kalau dapat IP dari MikroTik

## 🌐 WebFig Reverse Proxy (Opsional)

Akses MikroTik WebFig dari mana saja melalui domain HTTPS, tanpa perlu expose port router langsung.

### Cara Kerja

```
Browser → https://mikro.domain.com → Nginx (VPS) → WireGuard → MikroTik WebFig (10.10.10.2:80)
```

### Setup

#### 1. DNS Record

Tambahkan A record di DNS provider:

```
mikro.domain.com → IP_VPS
```

> Jika pakai Cloudflare, set **DNS Only** (grey cloud) agar SSL certbot bisa jalan.

#### 2. Nginx Config

```bash
sudo nano /etc/nginx/sites-available/mikro-webfig
```

```nginx
server {
    listen 80;
    server_name mikro.domain.com;

    # Basic auth (wajib! jangan expose WebFig tanpa password)
    auth_basic "MikroTik WebFig";
    auth_basic_user_file /etc/nginx/.htpasswd-mikro;

    location / {
        proxy_pass http://10.10.10.2/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (untuk WebFig terminal)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/mikro-webfig /etc/nginx/sites-enabled/

# Buat password file
sudo apt install apache2-utils -y
sudo htpasswd -c /etc/nginx/.htpasswd-mikro admin

# Test & reload
sudo nginx -t && sudo systemctl reload nginx
```

#### 3. SSL (Let's Encrypt)

```bash
sudo certbot --nginx -d mikro.domain.com
```

#### 4. Verifikasi

Buka `https://mikro.domain.com` di browser → masukkan basic auth → WebFig muncul.

### ⚠️ Keamanan

- **Selalu pakai basic auth** — WebFig punya login sendiri, tapi basic auth menambah layer proteksi
- **Gunakan password kuat** untuk basic auth dan user MikroTik
- **Jangan disable HTTPS** — semua traffic harus terenkripsi
- Traffic mengalir: Browser → HTTPS → Nginx → WireGuard (encrypted) → MikroTik
- Pertimbangkan whitelist IP di nginx jika hanya diakses dari lokasi tertentu:

```nginx
# Tambahkan di dalam block server
allow 123.456.789.0/24;  # IP kantor/rumah
deny all;
```

## 📝 Changelog (ringkas)

| Commit | Isi |
|--------|-----|
| `13a3502` | Whitelist secondary AP (TL-WR840N) dari ban tether |
| `bab3e34` | Anti-tether WiFi tetangga + lock pool 5 device |
| `51b3eda` | Command `/tether` runtime settings |
| `2a29ae3` | Notif admin + punish (kick/disable) |
| `f0c7fe1` | Anti-tether hotspot voucher (TTL + MAC bind) |

## 📄 Lisensi

MIT License — Bebas dipakai dan dimodifikasi.

## 🙏 Credits

- [Grammy](https://grammy.dev/) — Telegram Bot framework
- [MikroTik REST API](https://help.mikrotik.com/docs/display/ROS/REST+API) — RouterOS 7.x
- [WireGuard](https://www.wireguard.com/) — VPN tunnel
