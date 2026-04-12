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
          const msg = error.response.data.message || error.response.data.detail || 'Unknown error';
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

  async addUser({ name, password, profile, server, comment }) {
    const { data } = await this.client.put('/ip/hotspot/user', {
      name,
      password,
      profile,
      server: server || config.hotspotServer,
      comment: comment || '',
    });
    return data;
  }

  async removeUser(id) {
    await this.client.delete(`/ip/hotspot/user/${id}`);
  }

  // ═══════════════════════════════════
  //  USER PROFILES
  // ═══════════════════════════════════

  async getUserProfiles() {
    const { data } = await this.client.get('/ip/hotspot/user-profile');
    return data;
  }

  // ═══════════════════════════════════
  //  ACTIVE SESSIONS
  // ═══════════════════════════════════

  async getActiveSessions() {
    const { data } = await this.client.get('/ip/hotspot/active');
    return data;
  }

  async kickUser(id) {
    await this.client.delete(`/ip/hotspot/active/${id}`);
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
