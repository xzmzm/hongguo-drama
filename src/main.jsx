// 红果短剧 4.8：界面入口；目录双线与验证范围见 docs/release-4.8.md。
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PlayerWindow from './PlayerWindow';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import { initializePosterSize } from './theme';

initializePosterSize();

// 独立播放窗口与主窗口共用同一页面，按地址中的 #player 区分。
const Root = /^#player(\?|$)/.test(window.location.hash) ? PlayerWindow : App;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
);
