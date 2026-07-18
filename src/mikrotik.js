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

  async getDhcpLeases() {
    const { data } = await this.client.get('/ip/dhcp-server/lease');
    return data;
  }

  async getDhcpLeaseByAddress(address) {
    const leases = await this.getDhcpLeases();
    return (
      leases.find(
        (l) =>
          (l['active-address'] === address || l.address === address) &&
          l.status === 'bound'
      ) ||
      leases.find((l) => l['active-address'] === address || l.address === address) ||
      null
    );
  }

  async makeDhcpLeaseStatic(id) {
    try {
      await this.client.post('/ip/dhcp-server/lease/make-static', { '.id': id });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Punish DHCP device (tetangga):
   * 1) make-static if dynamic
   * 2) disable lease (blocked param tidak ada di beberapa ROS)
   * 3) put IP into mikrobot-tether-ban address-list with timeout → drop filter
   */
  async punishDhcpAddress(address, { minutes = 5, banList = 'mikrobot-tether-ban' } = {}) {
    const result = { leaseDisabled: false, banListed: false, leaseId: null, mac: null };

    // Ensure drop rule for ban list exists
    try {
      const filters = await this.getFilterRules();
      const has = filters.some((r) => (r.comment || '') === 'MikroBot drop-tether-ban');
      if (!has) {
        await this.client.put('/ip/firewall/filter', {
          chain: 'forward',
          action: 'drop',
          'src-address-list': banList,
          comment: 'MikroBot drop-tether-ban',
        });
      }
    } catch {
      /* non-fatal */
    }

    // Address-list ban with timeout (works even if lease ops fail)
    try {
      await this.client.put('/ip/firewall/address-list', {
        list: banList,
        address,
        timeout: `${Math.max(1, minutes)}m`,
        comment: `MikroBot tether-ban ${minutes}m`,
      });
      result.banListed = true;
    } catch (err) {
      // already exists → patch timeout
      try {
        const list = await this.getAddressList(banList);
        const existing = list.find((e) => e.address === address);
        if (existing) {
          await this.client.patch(`/ip/firewall/address-list/${existing['.id']}`, {
            timeout: `${Math.max(1, minutes)}m`,
            comment: `MikroBot tether-ban ${minutes}m`,
          });
          result.banListed = true;
        } else {
          throw err;
        }
      } catch (e2) {
        result.banError = e2.message;
      }
    }

    // Lease disable
    try {
      let lease = await this.getDhcpLeaseByAddress(address);
      if (lease) {
        result.leaseId = lease['.id'];
        result.mac = lease['active-mac-address'] || lease['mac-address'] || null;
        if (lease.dynamic === 'true') {
          await this.makeDhcpLeaseStatic(lease['.id']);
          // re-fetch id after make-static (usually same)
          lease = (await this.getDhcpLeaseByAddress(address)) || lease;
          result.leaseId = lease['.id'];
        }
        await this.client.patch(`/ip/dhcp-server/lease/${lease['.id']}`, {
          disabled: 'true',
        });
        result.leaseDisabled = true;
      }
    } catch (err) {
      result.leaseError = err.message;
    }

    return result;
  }

  async unpunishDhcpAddress(address, { banList = 'mikrobot-tether-ban' } = {}) {
    const result = { leaseEnabled: false, banRemoved: false };
    try {
      const lease = await this.getDhcpLeaseByAddress(address);
      if (lease && lease.disabled === 'true') {
        await this.client.patch(`/ip/dhcp-server/lease/${lease['.id']}`, {
          disabled: 'false',
        });
        result.leaseEnabled = true;
      }
    } catch (err) {
      result.leaseError = err.message;
    }
    try {
      const list = await this.getAddressList(banList);
      for (const e of list.filter((x) => x.address === address)) {
        await this.removeAddressListEntry(e['.id']);
        result.banRemoved = true;
      }
    } catch (err) {
      result.banError = err.message;
    }
    return result;
  }

  // legacy name used earlier — map to disable
  async setDhcpLeaseBlocked(id, blocked) {
    // Prefer disabled; blocked unknown on this ROS
    const { data } = await this.client.patch(`/ip/dhcp-server/lease/${id}`, {
      disabled: blocked ? 'true' : 'false',
    });
    return data;
  }

  async getIpPools() {
    const { data } = await this.client.get('/ip/pool');
    return data;
  }

  /**
   * Lock DHCP pool to exactly maxDevices consecutive IPs from first IP in range.
   * e.g. 192.168.30.10-192.168.30.15 + max 5 → 192.168.30.10-192.168.30.14
   */
  async ensurePoolMaxDevices(poolName, maxDevices) {
    const pools = await this.getIpPools();
    const pool = pools.find((p) => p.name === poolName);
    if (!pool) return { status: 'missing', poolName };

    const ranges = String(pool.ranges || '');
    // support single range a.b.c.d-a.b.c.e
    const m = ranges.match(
      /^(\d+\.\d+\.\d+\.)(\d+)-(\d+\.\d+\.\d+\.)(\d+)$/
    );
    if (!m) return { status: 'unsupported-range', ranges };

    const prefixStart = m[1];
    const startHost = Number(m[2]);
    const prefixEnd = m[3];
    const endHost = Number(m[4]);
    if (prefixStart !== prefixEnd) return { status: 'cross-prefix', ranges };

    const desiredEnd = startHost + maxDevices - 1;
    const desired = `${prefixStart}${startHost}-${prefixEnd}${desiredEnd}`;
    if (ranges === desired) {
      return { status: 'exists', ranges, total: maxDevices };
    }

    await this.client.patch(`/ip/pool/${pool['.id']}`, { ranges: desired });
    return {
      status: 'updated',
      from: ranges,
      to: desired,
      total: maxDevices,
      previousEnd: endHost,
    };
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

  /**
   * Ensure anti-tether rules for one or more network segments.
   * segments: [{ name, interface, subnet, commentPrefix }]
   * commentPrefix examples: "MikroBot" (hotspot) / "MikroBot tetangga"
   */
  async ensureAntiTether({
    segments = [],
    tetherList = 'mikrobot-tether',
    tetherListTimeout = '10m',
    // backward-compat single-segment args
    hotspotInterface,
    hotspotSubnet,
  } = {}) {
    if (!segments.length) {
      segments = [
        {
          name: 'hotspot',
          interface: hotspotInterface || 'ether4',
          subnet: hotspotSubnet || '192.168.20.0/24',
          commentPrefix: 'MikroBot',
        },
      ];
    }

    const all = { segments: {}, errors: [] };

    for (const seg of segments) {
      const prefix = seg.commentPrefix || 'MikroBot';
      const iface = seg.interface;
      const subnet = seg.subnet;
      const segResult = {
        name: seg.name,
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
        const ttlComment = `${prefix} anti-tether TTL=1`;
        // Match exact prefix comment; also accept legacy hotspot comment without iface
        const existing = mangles.find((r) => {
          const c = r.comment || '';
          if (c === ttlComment) return true;
          // legacy: "MikroBot anti-tether TTL=1" for hotspot only
          if (seg.name === 'hotspot' && c === 'MikroBot anti-tether TTL=1') return true;
          return false;
        });

        if (!existing) {
          await this.client.put('/ip/firewall/mangle', {
            chain: 'postrouting',
            action: 'change-ttl',
            'new-ttl': 'set:1',
            'out-interface': iface,
            passthrough: 'yes',
            comment: ttlComment,
          });
          segResult.ttlMangle = 'created';
        } else {
          const needsPatch =
            existing['out-interface'] !== iface ||
            existing['new-ttl'] !== 'set:1' ||
            existing.chain !== 'postrouting';
          if (needsPatch) {
            await this.client.patch(`/ip/firewall/mangle/${existing['.id']}`, {
              chain: 'postrouting',
              action: 'change-ttl',
              'new-ttl': 'set:1',
              'out-interface': iface,
              passthrough: 'yes',
              comment: ttlComment,
            });
            segResult.ttlMangle = 'updated';
          } else {
            segResult.ttlMangle = 'exists';
          }
        }
      } catch (err) {
        segResult.ttlMangle = 'error';
        segResult.errors.push(`ttlMangle: ${err.message}`);
      }

      // --- 2) mark then drop TTL 63/127 ---
      // hardDetect=false (tetangga soft): TTL=1 only — mark/drop TTL63 false-positive massal di client normal
      const hardDetect = Boolean(seg.hardDetect);
      const markTargets = [
        { ttl: 'equal:63', key: 'markTtl63', comment: `${prefix} mark-tether TTL63` },
        { ttl: 'equal:127', key: 'markTtl127', comment: `${prefix} mark-tether TTL127` },
      ];
      const dropTargets = [
        { ttl: 'equal:63', key: 'dropTtl63', comment: `${prefix} detect-tether TTL63` },
        { ttl: 'equal:127', key: 'dropTtl127', comment: `${prefix} detect-tether TTL127` },
      ];

      let filters = [];
      try {
        filters = await this.getFilterRules();
      } catch (err) {
        segResult.errors.push(`filter list: ${err.message}`);
        all.segments[seg.name] = segResult;
        all.errors.push(...segResult.errors);
        continue;
      }

      // Soft mode: force-disable mark/drop for this segment (keep rules for optional hard later)
      if (!hardDetect) {
        for (const target of [...markTargets, ...dropTargets]) {
          const existing = filters.find((r) => (r.comment || '') === target.comment);
          if (!existing) {
            segResult[target.key] = 'soft-off';
            continue;
          }
          try {
            if (existing.disabled !== 'true') {
              await this.client.patch(`/ip/firewall/filter/${existing['.id']}`, {
                disabled: 'true',
              });
              segResult[target.key] = 'soft-disabled';
            } else {
              segResult[target.key] = 'soft-off';
            }
          } catch (err) {
            segResult[target.key] = 'error';
            segResult.errors.push(`${target.key}: ${err.message}`);
          }
        }
        // also keep drop-tether-ban disabled when no hard segment needs it
        all.segments[seg.name] = segResult;
        all.errors.push(...segResult.errors.map((e) => `${seg.name}: ${e}`));
        continue;
      }

      // Exclude secondary AP whitelist from mark/drop (NAT gateway / TL-WR840N)
      const wlList = '!mikrobot-tether-whitelist';
      const applyWlExclude = seg.name === 'tetangga' || prefix.includes('tetangga');

      for (const target of markTargets) {
        try {
          const existing = filters.find((r) => (r.comment || '') === target.comment);
          const dropSibling = filters.find(
            (r) => (r.comment || '') === target.comment.replace('mark-tether', 'detect-tether')
          );

          if (!existing) {
            const body = {
              chain: 'forward',
              action: 'add-src-to-address-list',
              'address-list': tetherList,
              'address-list-timeout': tetherListTimeout,
              'src-address': subnet,
              ttl: target.ttl,
              comment: target.comment,
            };
            if (applyWlExclude) body['src-address-list'] = wlList;
            if (dropSibling?.['.id']) body['place-before'] = dropSibling['.id'];
            await this.client.put('/ip/firewall/filter', body);
            segResult[target.key] = 'created';
          } else {
            // Patch exclude whitelist on existing tetangga mark rules
            if (applyWlExclude && existing['src-address-list'] !== wlList) {
              try {
                await this.client.patch(`/ip/firewall/filter/${existing['.id']}`, {
                  'src-address-list': wlList,
                });
                segResult[target.key] = 'updated-wl';
              } catch {
                segResult[target.key] = existing.invalid === 'true' ? 'invalid' : 'exists';
              }
            } else {
              segResult[target.key] = existing.invalid === 'true' ? 'invalid' : 'exists';
            }
            if (dropSibling?.['.id'] && existing['.id']) {
              try {
                await this.client.post('/ip/firewall/filter/move', {
                  numbers: existing['.id'],
                  destination: dropSibling['.id'],
                });
              } catch {
                /* ignore */
              }
            }
          }
        } catch (err) {
          segResult[target.key] = 'error';
          segResult.errors.push(`${target.key}: ${err.message}`);
        }
      }

      try {
        filters = await this.getFilterRules();
      } catch {
        /* keep */
      }

      for (const target of dropTargets) {
        try {
          const existing = filters.find((r) => (r.comment || '') === target.comment);
          if (!existing) {
            const body = {
              chain: 'forward',
              action: 'drop',
              'src-address': subnet,
              ttl: target.ttl,
              comment: target.comment,
            };
            if (applyWlExclude) body['src-address-list'] = wlList;
            await this.client.put('/ip/firewall/filter', body);
            segResult[target.key] = 'created';
          } else if (existing.invalid === 'true') {
            // ROS sometimes marks new rules invalid briefly; leave and report
            segResult[target.key] = 'invalid';
          } else {
            if (applyWlExclude && existing['src-address-list'] !== wlList) {
              try {
                await this.client.patch(`/ip/firewall/filter/${existing['.id']}`, {
                  'src-address-list': wlList,
                });
                segResult[target.key] = 'updated-wl';
              } catch {
                segResult[target.key] = 'exists';
              }
            } else {
              segResult[target.key] = 'exists';
            }
          }
        } catch (err) {
          segResult[target.key] = 'error';
          segResult.errors.push(`${target.key}: ${err.message}`);
        }
      }

      all.segments[seg.name] = segResult;
      all.errors.push(...segResult.errors.map((e) => `${seg.name}: ${e}`));
    }

    // Flatten primary (hotspot) keys for backward-compatible logs
    const primary = all.segments.hotspot || Object.values(all.segments)[0] || {};
    return {
      ...primary,
      segments: all.segments,
      errors: all.errors,
    };
  }

  /**
   * Secondary AP/router whitelist (TL-WR840N):
   * - address-list mikrobot-tether-whitelist
   * - accept filter before mark/drop tether
   * - mangle TTL=1 skip dst whitelist (NAT AP butuh TTL normal)
   */
  async ensureTetherWhitelist({
    ips = [],
    macs = [],
    listName = 'mikrobot-tether-whitelist',
  } = {}) {
    const result = {
      list: listName,
      ips: [],
      acceptRule: 'skip',
      mangleSkip: 'skip',
      errors: [],
    };
    if (!ips.length && !macs.length) return result;

    // 1) address-list entries for IPs
    try {
      const existing = await this.getAddressList(listName);
      const byAddr = new Map(existing.map((e) => [e.address, e]));
      for (const ip of ips) {
        if (byAddr.has(ip)) {
          result.ips.push({ ip, status: 'exists' });
          continue;
        }
        try {
          await this.client.put('/ip/firewall/address-list', {
            list: listName,
            address: ip,
            comment: 'MikroBot tether whitelist (secondary AP)',
          });
          result.ips.push({ ip, status: 'created' });
        } catch (err) {
          result.ips.push({ ip, status: 'error', error: err.message });
          result.errors.push(`list ${ip}: ${err.message}`);
        }
      }
    } catch (err) {
      result.errors.push(`list: ${err.message}`);
    }

    // 2) accept rule early in forward so mark/drop tether never hit whitelist
    try {
      const filters = await this.getFilterRules();
      const comment = 'MikroBot tether-whitelist accept';
      let accept = filters.find((r) => (r.comment || '') === comment);

      // place before first MikroBot mark-tether rule if possible
      const firstMark = filters.find((r) =>
        String(r.comment || '').includes('mark-tether')
      );

      if (!accept) {
        const body = {
          chain: 'forward',
          action: 'accept',
          'src-address-list': listName,
          comment,
        };
        if (firstMark?.['.id']) body['place-before'] = firstMark['.id'];
        await this.client.put('/ip/firewall/filter', body);
        result.acceptRule = 'created';
      } else {
        // ensure correct match + move before mark if needed
        if (accept['src-address-list'] !== listName || accept.action !== 'accept') {
          await this.client.patch(`/ip/firewall/filter/${accept['.id']}`, {
            chain: 'forward',
            action: 'accept',
            'src-address-list': listName,
            comment,
          });
          result.acceptRule = 'updated';
        } else {
          result.acceptRule = 'exists';
        }
        if (firstMark?.['.id']) {
          try {
            await this.client.post('/ip/firewall/filter/move', {
              numbers: accept['.id'],
              destination: firstMark['.id'],
            });
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      result.acceptRule = 'error';
      result.errors.push(`accept: ${err.message}`);
    }

    // 3) mangle TTL=1: skip packets destined to whitelist (NAT secondary AP)
    //    MikroBot tetangga anti-tether TTL=1 should not break clients behind WR840N
    try {
      const mangles = await this.getMangleRules();
      for (const m of mangles) {
        const c = m.comment || '';
        if (!c.includes('anti-tether TTL=1')) continue;
        // hotspot: keep as-is (no whitelist AP there typically)
        // tetangga / any with whitelist: add dst-address-list exclude
        const needs =
          m['dst-address-list'] !== `!${listName}` &&
          // only patch rules that might hit secondary AP subnet
          (c.includes('tetangga') || m['out-interface'] === 'ether2');
        if (!needs) {
          if (m['dst-address-list'] === `!${listName}`) result.mangleSkip = 'exists';
          continue;
        }
        await this.client.patch(`/ip/firewall/mangle/${m['.id']}`, {
          'dst-address-list': `!${listName}`,
        });
        result.mangleSkip = 'updated';
      }
      if (result.mangleSkip === 'skip') result.mangleSkip = 'none';
    } catch (err) {
      result.mangleSkip = 'error';
      result.errors.push(`mangle: ${err.message}`);
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
