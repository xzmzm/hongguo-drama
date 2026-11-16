const assert = require('node:assert/strict');
const { test } = require('node:test');
const net = require('node:net');
const { gzipSync } = require('node:zlib');
const { createUsbSigner } = require('./usb-signer');

const identity = { device_id: '9007199254740993', iid: '9007199254741993' };
const signatures = () => Object.fromEntries(['Argus', 'Gorgon', 'Helios', 'Ladon', 'Medusa'].map(name => ['X-' + name, 'native-' + name])
    .concat([['X-Khronos', '1794829500'], ['X-Neptune', 'native-neptune']]));
function request(body = null) {
    return { url: 'https://api5-normal-sinfonlineb.fqnovel.com'
        + (body ? '/novel/player/multi_video_model/v1/' : '/reading/bookapi/video_tab/multi_video_model/v1/')
        + '?device_id=' + identity.device_id + '&iid=' + identity.iid + '&ts=1794829500&query=a%20b',
    method: body ? 'POST' : 'GET', body, headers: { 'X-ARGUS': 'old-argus', 'x-ladon': 'old-ladon',
        'User-Agent': 'fixture', 'Content-Encoding': 'gzip', 'x-ss-stub': 'actual-gzip-md5' } };
}
async function server(t, handle) {
    const sockets = new Set();
    const listener = net.createServer(socket => {
        sockets.add(socket); socket.on('close', () => sockets.delete(socket));
        let data = '';
        socket.on('data', chunk => { data += chunk; if (data.includes('\n')) handle(JSON.parse(data.split('\n')[0]), socket); });
    });
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    t.after(() => { for (const socket of sockets) socket.destroy(); return new Promise(resolve => listener.close(resolve)); });
    return listener.address().port;
}

test('default-off bridge does no adb or socket work and preserves the original request', async () => {
    const signer = createUsbSigner({ port: 1, runFile: () => assert.fail('must not start adb') });
    const original = request();
    await signer.prepare();
    assert.equal(await signer.sign(original, identity), original);
});

for (const body of [null, gzipSync(Buffer.from('{"episodes":["123"],"text":"字节"}'))]) {
    test('signs the exact final ' + (body ? 'gzip POST' : 'GET') + ' and replaces case-insensitive signatures', async t => {
        let sent;
        const port = await server(t, (value, socket) => {
            if (value.op === 'ping') return socket.end('{"ready":true}\n');
            sent = value;
            const headers = { ...signatures(), Cookie: 'never-forward', 'Content-Encoding': 'bad', Authorization: 'never-forward' };
            const line = JSON.stringify({ headers });
            socket.write(line.slice(0, 20)); setImmediate(() => socket.end(line.slice(20) + '\n'));
        });
        const signer = createUsbSigner({ port, isEnabled: () => true, runFile: () => assert.fail('ready service needs no adb') });
        await signer.prepare();
        const original = request(body), result = await signer.sign(original, identity);
        assert.equal(sent.url, original.url); assert.equal(sent.body_b64, body?.toString('base64') || '');
        assert.equal(sent.did, identity.device_id); assert.equal(sent.iid, identity.iid);
        assert.equal(result.url, original.url); assert.equal(result.body, body); assert.equal(result.method, original.method);
        assert.equal(result.headers['x-argus'], 'native-Argus'); assert.equal(result.headers['X-ARGUS'], undefined);
        assert.equal(result.headers['x-ladon'], 'native-Ladon'); assert.equal(result.headers['x-khronos'], '1794829500');
        assert.equal(result.headers['Content-Encoding'], 'gzip'); assert.equal(result.headers['x-ss-stub'], 'actual-gzip-md5');
        assert.equal(result.headers.Cookie, undefined); assert.equal(result.headers.Authorization, undefined);
        assert.equal(original.headers['X-ARGUS'], 'old-argus', 'does not mutate a shared request');
    });
}

for (const reply of [{ headers: { 'X-Neptune': 'only' } }, { error: 'private native error and signed URL' },
    { headers: { ...signatures(), 'X-Argus': 'bad\r\nCookie: secret' } },
    { headers: { ...signatures(), 'x-argus': 'duplicate' } }]) {
    test('rejects incomplete, native-error, injected or duplicate signatures without exposing the response', async t => {
        const port = await server(t, (_, socket) => socket.end(JSON.stringify(reply) + '\n'));
        const signer = createUsbSigner({ port, isEnabled: () => true });
        await assert.rejects(signer.sign(request(), identity), error => {
            assert.equal(error.code, 'USB_SIGNER_UNAVAILABLE');
            assert.doesNotMatch(error.message, /private|secret|Cookie|native-/); return true;
        });
    });
}

test('a hung or disconnected service has a bounded wait', async t => {
    const port = await server(t, () => {});
    const signer = createUsbSigner({ port, isEnabled: () => true });
    const started = Date.now();
    await assert.rejects(signer.sign(request(), identity, { deadline: Date.now() + 40 }), { code: 'USB_SIGNER_UNAVAILABLE' });
    assert.ok(Date.now() - started < 1500);
});

test('canceling an in-flight signature closes the request without returning late headers', async t => {
    const controller = new AbortController();
    const port = await server(t, (_, socket) => { controller.abort(); setTimeout(() => socket.end(JSON.stringify({ headers: signatures() }) + '\n'), 10); });
    const signer = createUsbSigner({ port, isEnabled: () => true });
    await assert.rejects(signer.sign(request(), identity, { signal: controller.signal }), { code: 'ERR_CANCELED' });
});

test('turning signing off while the phone is signing prevents the late result from being used', async t => {
    let enabled = true;
    const port = await server(t, (_, socket) => { enabled = false; socket.end(JSON.stringify({ headers: signatures() }) + '\n'); });
    await assert.rejects(createUsbSigner({ port, isEnabled: () => enabled }).sign(request(), identity), { code: 'USB_SIGNER_UNAVAILABLE' });
});

test('startup selects one USB device, starts the installed service and never rebinds another forward', async t => {
    let ready = false;
    const port = await server(t, (_, socket) => socket.end(JSON.stringify({ ready }) + '\n'));
    const calls = [];
    const signer = createUsbSigner({ port, isEnabled: () => true, runFile: async (file, args, options) => {
        calls.push(args); assert.equal(options.windowsHide, true); assert.ok(options.signal);
        if (args.includes('get-serialno')) return { stdout: 'test-usb-phone\n' };
        if (args.includes('--list')) return { stdout: '' };
        if (args.includes('--no-rebind')) ready = true;
        return { stdout: '' };
    } });
    await signer.prepare();
    assert.deepEqual(calls[0], ['-d', 'get-serialno']);
    assert.ok(calls.some(args => args.includes('com.sign.oracle/.SignService')));
    assert.deepEqual(calls.at(-1), ['-s', 'test-usb-phone', 'forward', '--no-rebind', `tcp:${port}`, 'tcp:8762']);
});

test('a forward belonging to another device is preserved', async t => {
    const port = await server(t, (_, socket) => socket.end('{"ready":false}\n'));
    const calls = [];
    const signer = createUsbSigner({ port, isEnabled: () => true, runFile: async (_file, args) => {
        calls.push(args);
        return { stdout: args.includes('get-serialno') ? 'test-usb-phone' : `other-phone tcp:${port} tcp:8762\n` };
    } });
    await assert.rejects(signer.prepare(), { code: 'USB_SIGNER_UNAVAILABLE' });
    assert.equal(calls.length, 2, 'does not start a service or replace the occupied forward');
});

test('only final official playback requests with matching device IDs reach the phone', async () => {
    const signer = createUsbSigner({ port: 1, isEnabled: () => true });
    await assert.rejects(signer.sign({ ...request(), url: 'https://example.com/?device_id=secret' }, identity), { code: 'USB_SIGNER_UNAVAILABLE' });
    await assert.rejects(signer.sign(request(), { ...identity, iid: '123' }), { code: 'USB_SIGNER_UNAVAILABLE' });
});
