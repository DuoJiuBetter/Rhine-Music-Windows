if (process.platform !== 'win32') throw new Error('This live check uses the Windows WebView2 media runtime. Run check:online for portable backend/component checks.');
process.env.RHINE_CHECK_NETEASE_LIVE = '1';
await import('./check-desktop-window.mjs');
