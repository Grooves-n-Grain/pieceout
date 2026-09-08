const http = require('http');
const { proxyRelief } = require('./server/reliefProxy.js');
const { serveStatic } = require('./server/staticFiles.js');

function createServer({ root = __dirname, reliefUrl = process.env.RELIEF_API_URL || 'http://127.0.0.1:8766' } = {}) {
    const target = new URL(reliefUrl);
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('RELIEF_API_URL must use HTTP or HTTPS.');
    return http.createServer((req, res) => {
        if (req.url.startsWith('/api/relief/')) proxyRelief(req, res, reliefUrl);
        else serveStatic(req, res, root);
    });
}

if (require.main === module) {
    const port = Number(process.env.PORT || 8765);
    createServer().listen(port, '0.0.0.0', () => console.log(`PieceOut running on http://0.0.0.0:${port}`));
}
module.exports = { createServer };
