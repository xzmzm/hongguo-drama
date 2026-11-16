// Opt-in live check: authorized USB phone + installed com.sign.oracle required.
// Uses a new isolated profile and a random real Hongguo episode; keeps all artifacts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { connect, sleep } = require('./fixtures/cdp.cjs');

const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-usb-signer-'));
const profile = path.join(directory, 'profile');
const downloads = path.join(directory, 'downloads');
fs.mkdirSync(profile); fs.mkdirSync(downloads);
fs.writeFileSync(path.join(profile, 'data.json'), JSON.stringify({
    settings: { root: downloads, app_updates_enabled: false, watch_updates_enabled: false,
        watch_sequels_enabled: false, cache_next_episode: false, auto_delete_watched: false,
        fast_cdn_host: true, max_concurrent: 1 },
    announcement: { preferences: { normalEnabled: false, emergencyEnabled: false } }, tasks: [],
}));
const result = { at: new Date().toISOString(), directory, profile, mutedAtLaunch: true };
const receipt = path.join(directory, 'result.json');
function stage(value) { result.stage = value; fs.writeFileSync(receipt, JSON.stringify(result, null, 2)); console.log(value); }
async function freePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve)); return port;
}
async function until(probe, timeout = 30000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await probe(); if (value) return value; await sleep(200); }
    throw new Error('Timed out during ' + result.stage);
}

async function playSample(evaluate, series, episode) {
    const previousSrc = await evaluate('document.querySelector("video")?.currentSrc || ""');
    await evaluate('window.__usbPlayClicks = []; window.__usbReadyAt = 0; window.__usbPlaceholderClicked = false');
    assert.ok((await evaluate(`window.electronAPI.playSeries(${JSON.stringify({ seriesId: series.series_id, vidIndex: episode.vid_index })})`)).success);
    const playback = await until(async () => evaluate(`(() => {
        const start = [...document.querySelectorAll('.player-placeholder button.btn-primary')].find(el => /播放本集|在线播放|Play episode|Play this episode|Play online/.test(el.textContent));
        if (start && !window.__usbPlaceholderClicked) { start.click(); window.__usbPlaceholderClicked = true; }
        const video = document.querySelector('video');
        window.__usbPlaybackProbe = { present: !!video, readyState: video?.readyState, time: video?.currentTime,
            paused: video?.paused, width: video?.videoWidth, error: video?.error?.code,
            status: document.querySelector('.player-placeholder')?.innerText?.slice(0, 1800) || '' };
        if (!video) return null;
        video.muted = true; video.volume = 0;
        if (!video.currentSrc || video.currentSrc === ${JSON.stringify(previousSrc)}) return null;
        if (video.readyState >= 2 && !window.__usbReadyAt) window.__usbReadyAt = performance.now();
        const lastClick = window.__usbPlayClicks.at(-1)?.at || 0;
        if (video.readyState >= 2 && video.paused && performance.now() - window.__usbReadyAt > 500
            && performance.now() - lastClick > 1000 && window.__usbPlayClicks.length < 3) {
            const button = document.querySelector('[aria-label="播放"],[aria-label="Play"]');
            if (button) { window.__usbPlayClicks.push({ at: performance.now(), time: video.currentTime }); button.click(); }
        }
        if (video.currentTime < 10 || !video.videoWidth || video.error) return null;
        video.pause(); return { time: video.currentTime, muted: video.muted, volume: video.volume,
            paused: video.paused, width: video.videoWidth, height: video.videoHeight,
            sourceScheme: new URL(video.currentSrc).protocol, playClicks: window.__usbPlayClicks.length,
            error: video.error?.code || null };
    })()`), 90000);
    assert.ok(playback.muted && playback.volume === 0 && playback.paused && !playback.error);
    return playback;
}

let child, cdp;
(async () => {
    const port = await freePort();
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    stage('launch-isolated-app');
    child = spawn(require('electron'), ['.', '--user-data-dir=' + profile, '--mute-audio',
        '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
        '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port],
    { cwd: root, env, windowsHide: true, stdio: 'ignore' });
    child.on('error', () => { result.launchError = true; });
    cdp = await connect(port);
    const evaluate = expression => cdp.evaluate(expression);
    await until(() => evaluate('Boolean(window.electronAPI && document.querySelector("#root")?.children.length)'));
    const info = await evaluate('window.electronAPI.getAppInfo()');
    assert.equal(path.resolve(info.dataDir).toLowerCase(), profile.toLowerCase());
    assert.equal((await evaluate('window.electronAPI.getSettings()')).usb_signer, false);
    result.defaultOff = true;
    assert.equal((await evaluate('window.electronAPI.saveSettings({usb_signer:"true"})')).success, false);
    stage('save-toggle-through-settings-ui');
    assert.equal(await evaluate(`(() => {
        const button = [...document.querySelectorAll('button.sidebar-item')].find(el => /^(设置|Settings)$/.test(el.textContent.trim()));
        button?.click(); return !!button;
    })()`), true);
    await until(() => evaluate('!!document.querySelector(\'[aria-label="USB 手机签名"],[aria-label="USB phone signing"]\')'));
    assert.equal(await evaluate(`(() => {
        const input = document.querySelector('[aria-label="USB 手机签名"],[aria-label="USB phone signing"]');
        if (input.checked) throw new Error('USB signing should default off in UI'); input.click(); return input.checked;
    })()`), true);
    await sleep(200);
    assert.equal(await evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find(el => /^(保存设置|Save settings)$/.test(el.textContent.trim()));
        button?.click(); return !!button;
    })()`), true);
    await until(async () => (await evaluate('window.electronAPI.getSettings()')).usb_signer === true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'data.json'), 'utf8')).settings.usb_signer, true);
    result.toggleSavedThroughUI = true;

    stage('random-real-hongguo-selection');
    const catalog = await require('../src/native/hongguo-app-catalog').browseList({ category: 'hot-real-drama' });
    assert.ok(catalog.success && catalog.results?.length, 'Real Hongguo catalog is required');
    const candidates = [...catalog.results].sort(() => Math.random() - 0.5).slice(0, 3);
    let series, episode, onlineEpisode;
    for (const candidate of candidates) {
        const resolved = await evaluate(`window.electronAPI.searchResolve(${JSON.stringify(candidate.series_id)})`);
        const unlocked = resolved.data?.episodes?.filter(item => !item.locked) || [];
        if (!resolved.success || unlocked.length < 2) continue;
        series = resolved.data; episode = unlocked[Math.floor(Math.random() * unlocked.length)];
        onlineEpisode = unlocked.find(item => item.vid !== episode.vid); break;
    }
    assert.ok(series && episode, 'A real unlocked episode is required');
    result.material = { seriesId: series.series_id, title: series.series_title, vid: episode.vid, index: episode.vid_index,
        selection: 'Random drama and unlocked episode from current Hongguo hot-real-drama catalog' };
    stage('muted-online-playback-with-phone-signing');
    assert.equal((await evaluate('window.electronAPI.getDownloadTasks()')).length, 0);
    result.onlinePlayback = { vid: onlineEpisode.vid, index: onlineEpisode.vid_index,
        ...await playSample(evaluate, series, onlineEpisode) };
    stage('real-app-download-queue');
    const submission = await evaluate(`window.electronAPI.hongguoDownloadBatch(${JSON.stringify({
        seriesId: series.series_id, seriesTitle: series.series_title, episodes: [episode], quality: '1080p',
    })})`);
    assert.ok(submission.success && submission.count === 1, 'App must accept the random episode');
    const task = await until(async () => {
        const tasks = await evaluate('window.electronAPI.getDownloadTasks()');
        const task = tasks.find(item => String(item.hongguoInfo?.vid) === String(episode.vid));
        if (task?.status === 'failed') throw new Error('App download failed: ' + task.error);
        return task?.status === 'completed' ? task : false;
    }, 180000);
    const relative = path.relative(downloads, task.savePath);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    const probe = JSON.parse(execFileSync(path.join(root, 'build/ffmpeg/ffprobe.exe'),
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', task.savePath], { encoding: 'utf8', windowsHide: true }));
    const video = probe.streams.find(stream => stream.codec_type === 'video');
    assert.ok(video && Math.min(video.width, video.height) >= 1080 && Number(probe.format.duration) > 10);
    result.download = { throughAppQueue: true, file: task.savePath, bytes: fs.statSync(task.savePath).size,
        codec: video.codec_name, width: video.width, height: video.height, duration: Number(probe.format.duration) };
    const bound = await evaluate(`window.electronAPI.getSeriesEpisodes(${JSON.stringify(series.series_id)})`);
    assert.ok(bound.success && bound.data.episodes.find(item => item.vid_index === episode.vid_index)?.fileUrl,
        'The completed episode must be bound to its downloaded local file');
    // Verify persisted local playback after a fresh renderer initialization;
    // stream-to-file switching is a separate player acceptance concern.
    await evaluate('window.__usbReloadMarker = true; location.reload(); true');
    await until(async () => {
        try { return await evaluate('!window.__usbReloadMarker && Boolean(window.electronAPI && document.querySelector("#root")?.children.length)'); }
        catch { return false; }
    });
    stage('muted-playback-real-downloaded-episode');
    result.playback = await playSample(evaluate, series, episode);
    assert.ok((await evaluate('window.electronAPI.saveSettings({usb_signer:false})')).success);
    assert.equal((await evaluate('window.electronAPI.getSettings()')).usb_signer, false);
    result.toggleDisabled = true;
    stage('passed'); result.success = true;
})().catch(async error => {
    result.success = false;
    result.error = String(error.message).replace(/https?:\/\/[^\s<>"')]+/g, '[URL redacted]');
    try { result.playerProbe = await cdp?.evaluate('window.__usbPlaybackProbe', 2000); } catch {}
    process.exitCode = 1;
}).finally(async () => {
    try { await cdp?.evaluate('(() => { document.querySelectorAll("video").forEach(v => { v.muted=true; v.volume=0; v.pause(); }); return true; })()', 2000); } catch {}
    cdp?.close(); child?.kill();
    fs.writeFileSync(receipt, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
});
