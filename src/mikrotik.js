import axios from 'axios';
import { config } from './config.js';

class MikroTikAPI {
  constructor() {
    this.client = axios.create({
      baseURL: `http://${config.router.host}:${config.router.port}/rest`,
      auth: {
        username: config.router.user,
        password: config.router.pass,
      },
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Error interceptor — parse MikroTik error responses
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.data) {
          const errData = error.response.data;
          const msg = errData.message || errData.detail || JSON.stringify(errData);
          throw new Error(`MikroTik: ${msg}`);
        }
        if (error.code === 'ECONNREFUSED') {
          throw new Error('Router tidak dapat dihubungi. Periksa koneksi WireGuard.');
        }
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
          throw new Error('Koneksi ke router timeout. Periksa WireGuard tunnel.');
        }
        throw error;
      }
    );
  }

  // ═══════════════════════════════════
  //  HOTSPOT USERS
  // ═══════════════════════════════════

  async getUsers() {
    const { data } = await this.client.get('/ip/hotspot/user');
    return data;
  }

  async getUserByName(name) {
    const users = await this.getUsers();
    return users.find((u) => u.name === name) || null;
  }

  async addUser({ name, password, profile, comment }) {
    // Use PUT (CRUD style, tested & working on RouterOS 7.21.3)
    const body = { name, password, profile };
    if (comment) body.comment = comment;

    const { data } = await this.client.put('/ip/hotspot/user', body);
    return data;
  }

  async removeUser(id) {
    const { data } = await this.client.delete(`/ip/hotspot/user/${id}`);
    return data;
  }

  // ═══════════════════════════════════
  //  USER PROFILES
  // ═══════════════════════════════════

  async getUserProfiles() {
    // Try multiple possible endpoints (varies by RouterOS version)
    const endpoints = [
      '/ip/hotspot/user/profile',
      '/ip/hotspot/user-profile',
      '/ip/hotspot/profile',
    ];

    for (const endpoint of endpoints) {
      try {
        const { data } = await this.client.get(endpoint);
        return data;
      } catch {
        continue;
      }
    }

    // If all fail, return null (caller should use fallback)
    return null;
  }

  // ═══════════════════════════════════
  //  ACTIVE SESSIONS
  // ═══════════════════════════════════

  async getActiveSessions() {
    const { data } = await this.client.get('/ip/hotspot/active');
    return data;
  }

  async kickUser(id) {
    // REST CRUD style preferred; fallback to set-style
    try {
      await this.client.delete(`/ip/hotspot/active/${id}`);
    } catch {
      await this.client.post('/ip/hotspot/active/remove', { '.id': id });
    }
  }

  async kickUserByName(username) {
    const sessions = await this.getActiveSessions();
    const hits = sessions.filter((s) => s.user === username);
    for (const s of hits) {
      await this.kickUser(s['.id']);
    }
    return hits.length;
  }

  async setUserDisabled(id, disabled, comment) {
    const body = { disabled: disabled ? 'true' : 'false' };
    if (comment !== undefined) body.comment = comment;
    const { data } = await this.client.patch(`/ip/hotspot/user/${id}`, body);
    return data;
  }

  async getAddressList(listName) {
    const { data } = await this.client.get('/ip/firewall/address-list');
    if (!listName) return data;
    return data.filter((e) => e.list === listName);
  }

  async removeAddressListEntry(id) {
    await this.client.delete(`/ip/firewall/address-list/${id}`);
  }

  // ═══════════════════════════════════
  //  SYSTEM
  // ═══════════════════════════════════

  async getSystemResource() {
    const { data } = await this.client.get('/system/resource');
    return data;
  }

  // ═══════════════════════════════════
  //  REBOOT
  // ═══════════════════════════════════

  async reboot() {
    // RouterOS REST API: POST /system/reboot
    await this.client.post('/system/reboot');
  }

  // ═══════════════════════════════════
  //  HEALTH CHECK
  // ═══════════════════════════════════

  async ping() {
    try {
      await this.client.get('/system/resource');
      return true;
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════
  //  ANTI-TETHER / ANTI-HOTSPOT SHARE
  //  HP modern bisa WiFi client + hotspot
  //  bersamaan. shared-users=1 TIDAK cukup.
  //
  //  1) TTL=1 ke client hotspot → device di
  //     belakang HP (via tether) gagal reply
  //  2) Drop packet TTL 63/127 dari subnet
  //     hotspot (telltale device di belakang
  //     NAT phone)
  //  3) Bind MAC saat first login → voucher
  //     terkunci ke 1 device
  // ═══════════════════════════════════

  async getMangleRules() {
    const { data } = await this.client.get('/ip/firewall/mangle');
    return data;
  }

  async getFilterRules() {
    const { data } = await this.client.get('/ip/firewall/filter');
    return data;
  }

  async ensureAntiTether({
    hotspotInterface = 'ether4',
    hotspotSubnet = '192.168.20.0/24',
    tetherList = 'mikrobot-tether',
    tetherListTimeout = '10m',
  } = {}) {
    const result = {
      ttlMangle: 'skip',
      markTtl63: 'skip',
      markTtl127: 'skip',
      dropTtl63: 'skip',
      dropTtl127: 'skip',
      errors: [],
    };

    // --- 1) postrouting change-ttl set:1 ---
    try {
      const mangles = await this.getMangleRules();
      const existing = mangles.find(
        (r) => (r.comment || '').includes('MikroBot anti-tether TTL=1')
      );

      if (!existing) {
        await this.client.put('/ip/firewall/mangle', {
          chain: 'postrouting',
          action: 'change-ttl',
          'new-ttl': 'set:1',
          'out-interface': hotspotInterface,
          passthrough: 'yes',
          comment: 'MikroBot anti-tether TTL=1',
        });
        result.ttlMangle = 'created';
      } else {
        const needsPatch =
          existing['out-interface'] !== hotspotInterface ||
          existing['new-ttl'] !== 'set:1' ||
          existing.chain !== 'postrouting';
        if (needsPatch) {
          await this.client.patch(`/ip/firewall/mangle/${existing['.id']}`, {
            chain: 'postrouting',
            action: 'change-ttl',
            'new-ttl': 'set:1',
            'out-interface': hotspotInterface,
            passthrough: 'yes',
          });
          result.ttlMangle = 'updated';
        } else {
          result.ttlMangle = 'exists';
        }
      }
    } catch (err) {
      result.ttlMangle = 'error';
      result.errors.push(`ttlMangle: ${err.message}`);
    }

    // --- 2) filter: mark offender IP to address-list, then drop ---
    // Order matters: mark BEFORE drop so bot can map IP → hotspot user.
    const markTargets = [
      { ttl: 'equal:63', key: 'markTtl63', comment: 'MikroBot mark-tether TTL63' },
      { ttl: 'equal:127', key: 'markTtl127', comment: 'MikroBot mark-tether TTL127' },
    ];
    const dropTargets = [
      { ttl: 'equal:63', key: 'dropTtl63', comment: 'MikroBot detect-tether TTL63' },
      { ttl: 'equal:127', key: 'dropTtl127', comment: 'MikroBot detect-tether TTL127' },
    ];

    let filters = [];
    try {
      filters = await this.getFilterRules();
    } catch (err) {
      result.errors.push(`filter list: ${err.message}`);
      return result;
    }

    for (const target of markTargets) {
      try {
        const existing = filters.find((r) => (r.comment || '').includes(target.comment));
        const dropSibling = filters.find((r) =>
          (r.comment || '').includes(target.comment.replace('mark-tether', 'detect-tether'))
        );

        if (!existing) {
          const body = {
            chain: 'forward',
            action: 'add-src-to-address-list',
            'address-list': tetherList,
            'address-list-timeout': tetherListTimeout,
            'src-address': hotspotSubnet,
            ttl: target.ttl,
            comment: target.comment,
          };
          // Must run BEFORE drop twin, else packets never reach mark
          if (dropSibling?.['.id']) {
            body['place-before'] = dropSibling['.id'];
          }
          await this.client.put('/ip/firewall/filter', body);
          result[target.key] = 'created';
        } else {
          // If mark sits after drop, move it before drop
          if (dropSibling?.['.id'] && existing['.id']) {
            try {
              // numbers after destination means move before destination in many ROS versions
              await this.client.post('/ip/firewall/filter/move', {
                numbers: existing['.id'],
                destination: dropSibling['.id'],
              });
            } catch {
              // ignore move errors; rule still works if already ordered
            }
          }
          result[target.key] = existing.invalid === 'true' ? 'invalid' : 'exists';
        }
      } catch (err) {
        result[target.key] = 'error';
        result.errors.push(`${target.key}: ${err.message}`);
      }
    }

    // refresh after mark inserts
    try {
      filters = await this.getFilterRules();
    } catch {
      // keep previous
    }

    for (const target of dropTargets) {
      try {
        const existing = filters.find((r) => (r.comment || '').includes(target.comment));
        if (!existing) {
          await this.client.put('/ip/firewall/filter', {
            chain: 'forward',
            action: 'drop',
            'src-address': hotspotSubnet,
            ttl: target.ttl,
            comment: target.comment,
          });
          result[target.key] = 'created';
        } else if (existing.invalid === 'true') {
          result[target.key] = 'invalid';
        } else {
          result[target.key] = 'exists';
        }
      } catch (err) {
        result[target.key] = 'error';
        result.errors.push(`${target.key}: ${err.message}`);
      }
    }

    return result;
  }

  async ensureMacBindOnProfiles() {
    const profiles = await this.getUserProfiles();
    if (!profiles) return { updated: [], skipped: [], errors: ['no profiles'] };

    const macSnippet =
      ':local mac $"mac-address"; /ip hotspot user set mac-address=$mac [find where name=$user]';
    const updated = [];
    const skipped = [];
    const errors = [];

    for (const profile of profiles) {
      const name = profile.name;
      if (!name || name === 'default') continue;

      const onLogin = profile['on-login'] || '';
      if (onLogin.includes('set mac-address')) {
        skipped.push(name);
        continue;
      }

      try {
        const newLogin = onLogin.trim()
          ? `${onLogin}; ${macSnippet}`
          : `{${macSnippet}}`;
        await this.client.patch(`/ip/hotspot/user/profile/${profile['.id']}`, {
          'on-login': newLogin,
        });
        updated.push(name);
      } catch (err) {
        errors.push(`${name}: ${err.message}`);
      }
    }

    return { updated, skipped, errors };
  }
}

export const mikrotik = new MikroTikAPI();
