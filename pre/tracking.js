(() => {
  const META_PIXEL_ID = "";
  const GA_MEASUREMENT_ID = "";
  const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  const params = new URLSearchParams(window.location.search);
  utmKeys.forEach((key) => {
    const value = params.get(key);
    if (value) sessionStorage.setItem(key, value);
  });

  document.addEventListener("click", (event) => {
    const cta = event.target.closest("[data-cta-location]");
    if (!cta) return;
    const data = { cta_location: cta.dataset.ctaLocation, page_path: window.location.pathname };
    utmKeys.forEach((key) => { data[key] = sessionStorage.getItem(key) || ""; });
    if (META_PIXEL_ID && window.fbq) window.fbq("trackCustom", "WhatsAppGroupClick", data);
    if (GA_MEASUREMENT_ID && window.gtag) window.gtag("event", "whatsapp_group_click", data);
  });
})();
