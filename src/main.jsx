// 红果短剧 8.4 正式版：界面入口；发行记录与验证范围见 docs/release-8.4.md。
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PlayerWindow from './PlayerWindow';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import { initializePosterSize } from './theme';

import { initializeLanguage } from './i18n';

initializePosterSize();

// 独立播放窗口与主窗口共用同一页面，按地址中的 #player 区分。
const Root = /^#player(\?|$)/.test(window.location.hash) ? PlayerWindow : App;

initializeLanguage().then(() => ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
));
