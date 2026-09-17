const http = require('http'), fs = require('fs'), path = require('path');
const DIR = '/data/data/com.termux/files/home/Ztime';
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.end(); return; }
  if (req.method === 'POST' && req.url === '/upload') {
    const name = (req.headers['x-filename'] || 'out.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');
    const ws = fs.createWriteStream(path.join(DIR, name));
    // bytesWritten is only valid after the stream flushes: report on
    // 'finish', not on request 'end' (which fired early with bytes=0).
    ws.on('finish', () => res.end('saved ' + name + ' bytes=' + ws.bytesWritten));
    ws.on('error', (e) => { res.statusCode = 500; res.end('write failed: ' + e.message); });
    req.pipe(ws);
  } else { res.statusCode = 404; res.end('nope'); }
}).listen(8099, () => console.log('receiver on 8099 CORS-ok'));
