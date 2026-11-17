// Applies the theme picked on this page before anything is drawn, so a dark
// choice never flashes light first. With no choice, the system decides.
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem('pilely-dashboard.theme');
  } catch (error) {
    theme = null;
  }
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
})();
