import { config } from './config.js';
import { getDb } from './db/index.js';
import { createApp } from './app.js';

getDb(); // initialise db + run migrations on boot

const app = createApp();

app.listen(config.port, () => {
  console.log(`[cpwork-api] listening on http://localhost:${config.port} (${config.env})`);
});
