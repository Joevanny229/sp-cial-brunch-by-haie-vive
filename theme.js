(function () {
  var KEY = 'rotaract-theme';

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  var theme = stored();
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);

  function refresh(button) {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    button.textContent = dark ? '☀️' : '🌙';
    button.setAttribute(
      'aria-label',
      dark ? 'Passer au thème clair' : 'Passer au thème sombre'
    );
  }

  function init() {
    var button = document.getElementById('theme-toggle');
    if (!button) return;
    refresh(button);
    button.addEventListener('click', function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      var next = dark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      refresh(button);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();