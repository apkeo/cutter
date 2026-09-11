module.exports = async function mainWindow(app) {
  await app.firstWindow();
  return app.windows().find(p => p.url().includes('page=index')) ||
    app.waitForEvent('window', { predicate: p => p.url().includes('page=index') });
};
