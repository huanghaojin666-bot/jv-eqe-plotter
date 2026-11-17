(function () {
  'use strict';
  const version = document.querySelector('meta[name="br-report-version"]')?.content || '';
  function href(page, params) {
    const target = new URL(page, location.href);
    if (version) target.searchParams.set('v', version);
    if (params) target.hash = params.toString();
    return target.href;
  }
  window.ReportNavigation = { href, version };
  document.querySelectorAll('.header-tabs a[href]').forEach(link => {
    link.href = href(link.getAttribute('href'));
  });
})();
