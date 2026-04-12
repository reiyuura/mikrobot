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


  usernameLength: Number(process.env.USERNAME_LENGTH) || 6,
  timezone: process.env.TIMEZONE || 'Asia/Jakarta',
};
