// Boot only: config → createApp() → listen on loopback (nginx fronts it).
import { config } from './config.js';
import { createApp } from './app.js';

const app = await createApp();
app.listen(config.port, '127.0.0.1', () => {
  console.log(`SysaiQ server (${config.env}) on http://127.0.0.1:${config.port}`);
});
