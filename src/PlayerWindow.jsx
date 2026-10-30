import React, { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import Player from './components/Player';
import { initializeTheme } from './theme';

// 独立播放窗口：只显示播放器，可与主窗口和其他播放窗口同时播放。
// 地址形如 #player?seriesId=…&vidIndex=…&resume=1（由主进程创建窗口时写入）。
function readTarget() {
  const params = new URLSearchParams(window.location.hash.replace(/^#player\??/, ''));
  return {
    seriesId: params.get('seriesId') || '',
    vidIndex: Number(params.get('vidIndex')) || 0,
    resume: params.get('resume') !== '0',
    ts: Date.now(),
  };
}

export default function PlayerWindow() {
  useLayoutEffect(() => initializeTheme(), []);
  const [target, setTarget] = useState(readTarget);
  const [title, setTitle] = useState('');
  const [actionsHidden, setActionsHidden] = useState(false);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [isMac, setIsMac] = useState(/Mac/.test(navigator.platform));

  useEffect(() => { document.title = title ? `${title} - 红果短剧` : '红果短剧 · 播放'; }, [title]);
  useEffect(() => {
    window.electronAPI.getAlwaysOnTop?.().then(setAlwaysOnTop).catch(() => {});
    window.electronAPI.getAppInfo?.().then(info => { if (info?.platform) setIsMac(info.platform === 'darwin'); }).catch(() => {});
  }, []);
  useEffect(() => window.electronAPI.onStorageError?.((data) => {
    setNotice(data === null ? '' : data?.error || '数据保存失败，请检查磁盘空间和目录权限后重试。');
  }), []);
  // 只处理本窗口自己发起的播放请求（例如在本窗口里找到续集后点播放）。
  useEffect(() => window.electronAPI.onNavigate?.((data) => {
    if (data?.page === 'player' && data.payload) setTarget({ ...data.payload, ts: Date.now() });
  }), []);

  const rememberSeries = useCallback((seriesId) => {
    setTarget(current => ({ seriesId, resume: true, autoplay: false, ts: current?.ts }));
  }, []);

  // 播放器里的「发现短剧」「设置」等入口交给主窗口打开。
  const openInMain = useCallback(async (page) => {
    try {
      const result = await window.electronAPI.showMainWindow(page);
      if (!result?.success) throw new Error(result?.error);
    } catch (error) {
      setNotice(error.message || '无法打开主窗口，请重试。');
    }
  }, []);

  return (
    <div className={`app-layout player-window layout-landscape player-focused ${isMac ? 'platform-mac' : ''}`}>
      <div className="main-wrapper">
        <header className="window-toolbar">
          <span className="toolbar-location" title={title}>{title || '播放窗口'}</span>
          <div className="toolbar-actions">
            <button className="btn btn-outline btn-sm" onClick={() => openInMain()} title="回到主窗口继续找剧，本窗口保持播放">主窗口</button>
            <button className="btn btn-outline btn-sm player-actions-toggle" aria-pressed={actionsHidden}
              onClick={() => setActionsHidden(hidden => !hidden)}>{actionsHidden ? '显示按钮' : '隐藏按钮'}</button>
            <button className="btn btn-outline btn-sm pin-toggle" aria-pressed={alwaysOnTop} disabled={pinBusy}
              aria-label={alwaysOnTop ? '取消置顶' : '置顶'} title={alwaysOnTop ? '取消置顶' : '置顶'}
              onClick={async () => {
                setPinBusy(true);
                try { setAlwaysOnTop(await window.electronAPI.setAlwaysOnTop(!alwaysOnTop)); }
                catch { setNotice('置顶切换失败，请重试。'); }
                finally { setPinBusy(false); }
              }}><svg width="17" height="17" viewBox="0 0 24 24" fill={alwaysOnTop ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3h8l-1 6 4 4v2H5v-2l4-4-1-6Z" /><path d="M12 15v6" /></svg></button>
          </div>
        </header>
        {notice && <div className="app-storage-error" role="alert"><span>{notice}</span><button className="btn btn-outline btn-sm" onClick={() => setNotice('')}>关闭提示</button></div>}
        <main className="main-content" data-page="player">
          <Player target={target} onSeriesSelected={rememberSeries} onNavigate={openInMain}
            onTitleChange={setTitle} actionsHidden={actionsHidden}
            episodesOpen={episodesOpen} setEpisodesOpen={setEpisodesOpen} />
        </main>
      </div>
    </div>
  );
}
