// Classic script also runs when index.html is opened directly via file://.
if (location.protocol === 'http:' || location.protocol === 'https:') {
  document.getElementById('launch-help').hidden = true;
  document.getElementById('app-shell').hidden = false;
  const app = document.createElement('script');
  app.type = 'module';
  app.src = './app.js';
  document.head.append(app);
}
