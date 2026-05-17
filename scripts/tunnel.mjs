#!/usr/bin/env node
import ngrok from '@ngrok/ngrok';

const port = Number(process.env.PORT) || 3100;
const authtoken = process.env.NGROK_AUTHTOKEN;

if (!authtoken) {
  console.error('[tunnel] NGROK_AUTHTOKEN is not set.');
  console.error('[tunnel] Export it in your shell (e.g. ~/.zshrc) and re-run:');
  console.error('[tunnel]   export NGROK_AUTHTOKEN=<your-token>');
  process.exit(1);
}

const listener = await ngrok.forward({ addr: port, authtoken });
const url = listener.url();

console.log('');
console.log(`[tunnel] Public URL: ${url}`);
console.log('[tunnel] Inspector:  http://127.0.0.1:4040');
console.log('');

const shutdown = async (signal) => {
  console.log(`\n[tunnel] received ${signal}, closing tunnel...`);
  try {
    await listener.close();
  } catch {
    // best-effort
  }
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Keep the event loop alive — the tunnel runs in a native subprocess, so without
// a pending handle the script would exit immediately and concurrently would tear
// down the server. Top-level await with a never-resolving Promise triggers
// Node 24's "unsettled top-level await" exit, so use an idle timer instead.
setInterval(() => {}, 1 << 30);
