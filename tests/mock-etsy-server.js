const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const port = Number(process.env.MOCK_ETSY_PORT || 8443);
const certPath = process.env.MOCK_ETSY_CERT;
const keyPath = process.env.MOCK_ETSY_KEY;
const pfxPath = process.env.MOCK_ETSY_PFX;
const pfxPassphrase = process.env.MOCK_ETSY_PFX_PASSPHRASE;

if (!pfxPath && (!certPath || !keyPath)) {
    throw new Error('Set MOCK_ETSY_PFX or both MOCK_ETSY_CERT and MOCK_ETSY_KEY');
}

const fixture = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'etsy-messages-mock.html')
);

const tlsOptions = pfxPath
    ? { pfx: fs.readFileSync(pfxPath), passphrase: pfxPassphrase }
    : { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };

const server = https.createServer(tlsOptions, (request, response) => {
    if (/^\/messages\/\d+/.test(request.url)) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(fixture);
        return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Mock Etsy HTTPS server listening on ${port}`);
});
