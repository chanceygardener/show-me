// Test-only companion to the show-me extension. When SHOW_ME_HARNESS names a
// socket, it answers {"call":"touch"} lines by calling the real extension's
// exported touch(), which is what gaining window focus does.
const net = require('node:net');
const vscode = require('vscode');

exports.activate = async () => {
  const address = process.env.SHOW_ME_HARNESS;
  if (!address) return;
  const showMe = vscode.extensions.all.find(e => e.packageJSON.name === 'show-me');
  const api = await showMe.activate();
  const calls = { touch: () => api.touch() };
  net.createServer(socket => {
    let buffered = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffered += chunk;
      const end = buffered.indexOf('\n');
      if (end < 0) return;
      const { call } = JSON.parse(buffered.slice(0, end));
      calls[call]?.();
      socket.end(`${JSON.stringify({ ok: call in calls })}\n`);
    });
  }).listen(address);
};
