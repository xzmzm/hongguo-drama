// SPDX-License-Identifier: GPL-3.0-only
// Optional local phone bridge. Importing this module never starts adb or connects.
const net = require('node:net');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { abortError, throwIfAborted, boundedSignal } = require('./request-signal');

const PORT = 8762;
const MAX_RESPONSE = 64 * 1024;
const REQUIRED_HEADERS = ['x-argus', 'x-gorgon', 'x-helios', 'x-khronos', 'x-ladon', 'x-medusa'];
const SIGNATURE_HEADERS = new Set([...REQUIRED_HEADERS, 'x-neptune']);
const UNAVAILABLE = 'USB 手机签名不可用，请连接已授权的手机并确认签名服务已安装；也可在设置中关闭 USB 手机签名';
const unavailable = () => Object.assign(new Error(UNAVAILABLE), { code: 'USB_SIGNER_UNAVAILABLE' });

function exchange(payload, { port = PORT, signal, timeout = 2000 } = {}) {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        let socket, timer, size = 0, chunks = [], settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
            socket?.destroy();
            error ? reject(error) : resolve(value);
        };
        const cancel = () => finish(abortError(signal));
        signal?.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(() => finish(unavailable()), Math.max(1, timeout));
        try {
            socket = net.createConnection({ host: '127.0.0.1', port });
            socket.setNoDelay(true);
            socket.on('error', () => finish(unavailable()));
            socket.on('end', () => finish(unavailable()));
            socket.on('close', () => finish(unavailable()));
            socket.on('connect', () => {
                if (!settled) socket.write(JSON.stringify(payload) + '\n');
            });
            socket.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_RESPONSE) return finish(unavailable());
                chunks.push(chunk);
                if (!chunk.includes(10)) return;
                try {
                    const value = JSON.parse(Buffer.concat(chunks).toString('utf8').split('\n', 1)[0]);
                    if (!value || typeof value !== 'object' || Array.isArray(value) || value.error) return finish(unavailable());
                    finish(null, value);
                } catch { finish(unavailable()); }
            });
        } catch { finish(unavailable()); }
    });
}

function createUsbSigner({ isEnabled = () => false, port = PORT,
    adbPath = process.env.HONGGUO_ADB_PATH || ((process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME)
        ? path.join(process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb'),
    runFile = promisify(execFile),
} = {}) {
    async function adb(args, signal) {
        throwIfAborted(signal);
        try {
            const result = await runFile(adbPath, args, { windowsHide: true, timeout: 4000, maxBuffer: 64 * 1024, signal });
            throwIfAborted(signal);
            if (/\b(?:error|exception|failure)\b/i.test(result.stdout || '')) throw unavailable();
            return String(result.stdout || '').trim();
        } catch {
            throwIfAborted(signal);
            throw unavailable(); // Never expose adb output, paths, device IDs or native errors.
        }
    }

    // Prepare before constructing the timestamped URL, so cold service startup
    // cannot make the final query/signature stale. Each model retry calls this again.
    async function prepare({ signal, deadline = Date.now() + 8000 } = {}) {
        if (!isEnabled()) return;
        throwIfAborted(signal);
        const budget = Math.min(8000, deadline - Date.now());
        if (budget <= 0) throw unavailable();
        const operation = boundedSignal(signal, budget);
        const ready = async () => {
            try { return (await exchange({ op: 'ping' }, { port, signal: operation.signal, timeout: 300 })).ready === true; }
            catch { throwIfAborted(operation.signal); return false; }
        };
        try {
            if (await ready()) return;
            // -d selects a single physical USB device; never choose a random phone
            // or emulator when more than one device is connected.
            const serial = await adb(['-d', 'get-serialno'], operation.signal);
            if (!/^[a-z0-9._:-]{1,100}$/i.test(serial) || serial === 'unknown') throw unavailable();
            const mappings = await adb(['forward', '--list'], operation.signal);
            const existing = mappings.split(/\r?\n/).filter(Boolean).map(line => line.trim().split(/\s+/))
                .find(row => row[1] === `tcp:${port}`);
            if (existing && (existing[0] !== serial || existing[2] !== `tcp:${PORT}`)) throw unavailable();
            await adb(['-s', serial, 'shell', 'am', 'start-foreground-service', '-n', 'com.sign.oracle/.SignService'], operation.signal);
            if (!existing) await adb(['-s', serial, 'forward', '--no-rebind', `tcp:${port}`, `tcp:${PORT}`], operation.signal);
            while (!await ready()) await delay(150, undefined, { signal: operation.signal });
        } catch {
            throwIfAborted(signal);
            throw unavailable();
        } finally { operation.dispose(); }
    }

    async function sign(request, identity, { signal, deadline = Date.now() + 2000 } = {}) {
        if (!isEnabled()) return request;
        throwIfAborted(signal);
        const timeout = Math.min(2000, deadline - Date.now());
        if (timeout <= 0) throw unavailable();
        const url = new URL(request.url);
        if (url.protocol !== 'https:' || url.hostname !== 'api5-normal-sinfonlineb.fqnovel.com' || url.port
            || url.username || url.password || !['/reading/bookapi/video_tab/multi_video_model/v1/', '/novel/player/multi_video_model/v1/'].includes(url.pathname)
            || ![identity?.device_id, identity?.iid].every(value => typeof value === 'string' && /^\d{1,30}$/.test(value))
            || url.searchParams.get('device_id') !== identity.device_id || url.searchParams.get('iid') !== identity.iid) throw unavailable();
        const response = await exchange({ url: request.url, body_b64: request.body ? request.body.toString('base64') : '',
            did: identity.device_id, iid: identity.iid }, { port, signal, timeout });
        throwIfAborted(signal);
        if (!isEnabled()) throw unavailable();
        const native = {};
        if (!response.headers || typeof response.headers !== 'object' || Array.isArray(response.headers)) throw unavailable();
        for (const [name, value] of Object.entries(response.headers)) {
            const key = name.toLowerCase();
            if (!SIGNATURE_HEADERS.has(key)) continue;
            if (Object.hasOwn(native, key) || typeof value !== 'string' || !value || value.length > 16384 || /[\r\n\0]/.test(value)) throw unavailable();
            native[key] = value;
        }
        if (!REQUIRED_HEADERS.every(name => native[name]) || !/^\d{10}$/.test(native['x-khronos'])) throw unavailable();
        // Replace case-insensitively; retaining even a differently-cased old Argus
        // would allow the HTTP library to send a mismatched or duplicate signature.
        const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !SIGNATURE_HEADERS.has(name.toLowerCase())));
        return { ...request, headers: { ...headers, ...native } };
    }
    return { prepare, sign, enabled: () => isEnabled() === true };
}

let signer = createUsbSigner(); // Default off, including the Docker/server entry.
function configureUsbSigner(options) { signer = createUsbSigner(options); }
module.exports = { createUsbSigner, configureUsbSigner,
    usbSignerEnabled: () => signer.enabled(),
    prepareUsbSigner: options => signer.prepare(options),
    signPlaybackRequest: (request, identity, options) => signer.sign(request, identity, options),
};
