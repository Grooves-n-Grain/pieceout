const fs = require('fs');
const path = require('path');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
    '.webmanifest': 'application/manifest+json' };

async function serveStatic(req, res, root) {
    const missing = () => { res.writeHead(404); res.end('Not Found'); };
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let name;
    try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html'; }
    catch { missing(); return; }
    // The repository also contains model code and private job data. Serve only web assets.
    const allowed = ['index.html', 'favicon.ico', 'test-sample.svg', 'demo-video/out/pieceout-demo.mp4'].includes(name)
        || /^(js\/[a-zA-Z0-9_/-]+\.js|css\/[a-zA-Z0-9_/-]+\.css|assets\/icons\/[a-zA-Z0-9_-]+\.(png|svg|webmanifest))$/.test(name);
    if (!allowed || name.split('/').some(segment => segment.startsWith('.'))) { missing(); return; }
    try {
        const file = await fs.promises.realpath(path.join(root, name));
        if (!file.startsWith(root + path.sep)) { missing(); return; }
        const stat = await fs.promises.stat(file);
        if (!stat.isFile()) { missing(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch { missing(); }
}
module.exports = { serveStatic };
