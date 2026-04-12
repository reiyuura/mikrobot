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
    await this.client.post('/ip/hotspot/active/remove', {
      '.id': id,
    });
  }

  // ═══════════════════════════════════
  //  SYSTEM
  // ═══════════════════════════════════

  async getSystemResource() {
    const { data } = await this.client.get('/system/resource');
    return data;
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
}

export const mikrotik = new MikroTikAPI();
