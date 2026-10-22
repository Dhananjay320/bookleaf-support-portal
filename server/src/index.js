import { config } from './config.js';
import { getDb } from './db/index.js';
import { seedIfEmpty } from './db/seed.js';
import { createApp } from './app.js';
import { aiStatus } from './ai/llmClient.js';

getDb();
seedIfEmpty();

const app = createApp();
app.listen(config.port, () => {
  console.log(`[server] BookLeaf support API listening on http://localhost:${config.port} (${config.env})`);
  console.log(`[server] AI: ${aiStatus().message}`);
});
