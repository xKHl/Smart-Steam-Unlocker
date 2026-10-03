/**
 * Card-idle worker: one child process per game.
 *
 * Started with child_process.fork (Electron runs it in Node mode). It
 * initialises Steamworks for a single App ID, which makes the Steam client
 * report that game as running so Trading Card drops accrue, without launching
 * the game itself. It exits as soon as the parent disconnects, so a crashed or
 * closed app never leaves games "running" in Steam.
 */

const appId = Number(process.argv[2]);

function send(message) {
  try {
    if (process.connected) process.send(message);
  } catch {
    // Parent already gone; the disconnect handler exits.
  }
}

if (!Number.isInteger(appId) || appId <= 0) {
  send({ type: 'error', appId: null, error: 'INVALID_APP_ID' });
  process.exit(2);
}

process.env.SteamAppId = String(appId);
process.env.SteamGameId = String(appId);

process.on('disconnect', () => process.exit(0));
process.on('message', (message) => {
  if (message?.type === 'stop') process.exit(0);
});

try {
  const steamworks = require('steamworks.js');
  steamworks.init(appId);
  send({ type: 'ready', appId });
} catch (error) {
  send({ type: 'error', appId, error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}

// steamworks.js pumps callbacks on its own interval; this keeps the event loop
// alive and lets the parent see that the worker is still healthy.
setInterval(() => send({ type: 'heartbeat', appId }), 60_000);
