'use strict';

// Stands in for Google's Antigravity extension: serves the quota API on a free local port
// and exports that port with its csrf token, as the real extension does.
const crypto = require('node:crypto');
const { EventEmitter, once } = require('node:events');
const http = require('node:http');
const quotaSummary = require('../quota-summary.json');

const RESPONSES = {
    GetUserStatus: { userStatus: { userTier: { name: 'Pro' } } },
    RetrieveUserQuotaSummary: quotaSummary,
};

async function activate(context) {
    const csrfToken = crypto.randomUUID();
    const requests = [];
    const received = new EventEmitter();

    const server = http.createServer((req, res) => {
        const request = { method: req.url.split('/').pop(), csrfToken: req.headers['x-codeium-csrf-token'] };
        requests.push(request);
        received.emit('request');

        const status = request.csrfToken !== csrfToken ? 401 : RESPONSES[request.method] ? 200 : 404;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status === 200 ? RESPONSES[request.method] : {}));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    context.subscriptions.push({ dispose: () => server.close() });

    return {
        csrfToken,
        get port() {
            return server.address()?.port;
        },
        // For the tests: resolves with the first request for `method`, received or to come.
        async received(method) {
            for (;;) {
                const request = requests.find(r => r.method === method);
                if (request) return request;
                await once(received, 'request');
            }
        },
    };
}

module.exports = { activate };
