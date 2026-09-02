const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const publicDirectory = __dirname;
const publicRealDirectory = fs.realpathSync(publicDirectory);
const maxUrlLength = 2048;
const allowedRootFiles = new Set(['index.html', 'style.css', 'script.js']);
const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
};

const securityHeaders = {
    'Content-Security-Policy': [
        "default-src 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self' mailto:",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "img-src 'self' https://images.unsplash.com data:",
        "connect-src 'self'",
        "upgrade-insecure-requests"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
};

if (process.env.ENABLE_HSTS === 'true') {
    securityHeaders['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
}

function sendResponse(response, statusCode, contentType, body) {
    response.writeHead(statusCode, { ...securityHeaders, 'Content-Type': contentType });
    response.end(body);
}

const server = http.createServer({ maxHeaderSize: 8192 }, (request, response) => {
    const logSecurityEvent = (statusCode) => {
        if (statusCode >= 400) {
            console.warn(`Request rejected: ${request.method} ${requestPathForLog} (${statusCode})`);
        }
    };
    const requestPathForLog = request.url ? request.url.split('?')[0].slice(0, 120) : '<missing>';

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        logSecurityEvent(405);
        sendResponse(response, 405, 'text/plain; charset=utf-8', 'Method not allowed');
        return;
    }

    if (!request.url || request.url.length > maxUrlLength) {
        logSecurityEvent(414);
        sendResponse(response, 414, 'text/plain; charset=utf-8', 'Request URI too long');
        return;
    }

    let requestPath;
    try {
        requestPath = decodeURIComponent(request.url.split('?')[0]);
    } catch {
        logSecurityEvent(400);
        sendResponse(response, 400, 'text/plain; charset=utf-8', 'Bad request');
        return;
    }

    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const requestedExtension = path.extname(relativePath).toLowerCase();
    const filePath = path.resolve(publicDirectory, relativePath);
    const isAllowedPublicFile = relativePath.startsWith('images/')
        || allowedRootFiles.has(relativePath);

    if (filePath !== publicDirectory && !filePath.startsWith(`${publicDirectory}${path.sep}`)) {
        logSecurityEvent(403);
        sendResponse(response, 403, 'text/plain; charset=utf-8', 'Forbidden');
        return;
    }

    if (!contentTypes[requestedExtension] || !isAllowedPublicFile) {
        logSecurityEvent(404);
        sendResponse(response, 404, 'text/plain; charset=utf-8', 'Not found');
        return;
    }

    fs.realpath(filePath, (realPathError, realFilePath) => {
        if (realPathError || !realFilePath.startsWith(`${publicRealDirectory}${path.sep}`)) {
            logSecurityEvent(404);
            sendResponse(response, 404, 'text/plain; charset=utf-8', 'Not found');
            return;
        }

        fs.stat(realFilePath, (error, stats) => {
            if (error || !stats.isFile()) {
                logSecurityEvent(404);
                sendResponse(response, 404, 'text/plain; charset=utf-8', 'Not found');
                return;
            }

            const contentType = contentTypes[requestedExtension];
            response.writeHead(200, { ...securityHeaders, 'Content-Type': contentType });
            if (request.method === 'HEAD') {
                response.end();
                return;
            }

            const stream = fs.createReadStream(realFilePath);
            stream.on('error', () => {
                if (!response.headersSent) {
                    sendResponse(response, 500, 'text/plain; charset=utf-8', 'Internal server error');
                } else {
                    response.destroy();
                }
            });
            stream.pipe(response);
        });
    });
});

server.headersTimeout = 10000;
server.requestTimeout = 10000;

server.listen(PORT, HOST, () => {
    console.log(`Credin Homes is running at http://localhost:${PORT}`);
    console.log(`For another device on the same network, use this computer's LAN IP with port ${PORT}.`);
});
