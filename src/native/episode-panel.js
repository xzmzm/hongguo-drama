function createEpisodePanelController({ ipcMain, screen, getMainWindow, getLayout, getWindowFor }) {
  let expansion = null;
  const requireMain = event => {
    const win = getMainWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('窗口请求无效');
    return win;
  };
  // 置顶对每个应用窗口（含独立播放窗口）单独生效；选集展开只属于主窗口。
  const requireWindow = event => {
    if (!getWindowFor) return requireMain(event);
    const win = getWindowFor(event);
    if (!win || win.isDestroyed()) throw new Error('窗口请求无效');
    return win;
  };
  const close = () => {
    if (!expansion) return 0;
    const previous = expansion;
    expansion = null;
    const main = getMainWindow();
    if (!main || main.isDestroyed()) return 0;
    const current = main.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    const width = Math.min(area.width, Math.max(main.getMinimumSize()[0], current.width - previous.width));
    const x = Math.max(area.x, Math.min(previous.x, area.x + area.width - width));
    main.setBounds({ ...current, x, width });
    return 0;
  };
  ipcMain.handle('get-always-on-top', event => requireWindow(event).isAlwaysOnTop());
  ipcMain.handle('set-always-on-top', (event, value) => {
    const main = requireWindow(event);
    if (typeof value !== 'boolean') throw new Error('置顶状态无效');
    main.setAlwaysOnTop(value);
    return main.isAlwaysOnTop();
  });
  ipcMain.handle('set-episode-panel-open', (event, value) => {
    // 播放窗口没有可展开的选集侧栏，收起请求直接视为完成。
    if (value === false && getWindowFor) {
      const win = getWindowFor(event);
      if (win && win !== getMainWindow()) return 0;
    }
    const main = requireMain(event);
    if (typeof value !== 'boolean') throw new Error('选集状态无效');
    if (!value) return close();
    if (getLayout() !== 'portrait') throw new Error('请在竖屏模式打开选集');
    if (expansion) return expansion.width;
    const current = main.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    const width = Math.min(current.width + 200, area.width);
    const x = Math.max(area.x, Math.min(current.x, area.x + area.width - width));
    main.setBounds({ ...current, x, width });
    expansion = { x: current.x, width: Math.max(0, main.getBounds().width - current.width) };
    return expansion.width;
  });
  return {
    close,
    attach(main) {
      main.on('close', close);
      main.webContents.on('did-start-loading', close);
    },
  };
}
module.exports = { createEpisodePanelController };
