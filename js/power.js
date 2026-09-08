window.AU = window.AU || {};

AU.power = (() => {
  const STORAGE_KEY = 'analysis-power-store-profile-v1';
  const GEO_ENDPOINT = 'https://data.geopf.fr/geocodage/search/';
  const DEFAULT_PROFILE = Object.freeze({
    name: 'Point de vente',
    address: '',
    immediateRadius: 100,
    commercialRadius: 500,
    extendedRadius: 2000,
    lat: null,
    lon: null,
    city: '',
    postcode: '',
    citycode: '',
    geocodeLabel: '',
    geocodedAt: null
  });

  const asNumber = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const esc = v => AU.util?.escapeHtml ? AU.util.escapeHtml(String(v ?? '')) : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  function loadProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_PROFILE };
      return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
    } catch (_) { return { ...DEFAULT_PROFILE }; }
  }

  function saveProfile(profile) {
    const p = {
      ...DEFAULT_PROFILE,
      ...profile,
      immediateRadius: Math.max(25, asNumber(profile.immediateRadius, 100)),
      commercialRadius: Math.max(100, asNumber(profile.commercialRadius, 500)),
      extendedRadius: Math.max(250, asNumber(profile.extendedRadius, 2000))
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    return p;
  }

  async function fetchJson(url, options = {}) {
    const r = await fetch(url, { ...options, cache: 'no-store', signal: AbortSignal.timeout(7000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function bootstrapProfile() {
    let p = loadProfile();
    if (p.address) return p;
    try {
      const cfg = await fetchJson('config/store.json');
      if (cfg?.address) {
        p = saveProfile({
          ...p,
          name: cfg.name || p.name,
          address: cfg.address,
          immediateRadius: cfg.immediate_radius_m || p.immediateRadius,
          commercialRadius: cfg.commercial_radius_m || p.commercialRadius,
          extendedRadius: cfg.extended_radius_m || p.extendedRadius
        });
      }
    } catch (_) {}
    return p;
  }

  async function geocode(address) {
    const q = String(address || '').trim();
    if (!q) throw new Error('Adresse vide.');
    const url = `${GEO_ENDPOINT}?${new URLSearchParams({ q, limit: '1' })}`;
    const json = await fetchJson(url);
    const f = json?.features?.[0];
    if (!f?.geometry?.coordinates?.length) throw new Error('Adresse introuvable dans le géocodeur national.');
    const [lon, lat] = f.geometry.coordinates;
    const pr = f.properties || {};
    return {
      lat: Number(lat), lon: Number(lon),
      city: pr.city || pr.municipality || '',
      postcode: pr.postcode || '',
      citycode: pr.citycode || '',
      geocodeLabel: pr.label || q,
      geocodeScore: Number(pr.score || 0),
      geocodedAt: new Date().toISOString(),
      geocodeSource: 'Géoplateforme / Base Adresse Nationale',
      geocodeUrl: url
    };
  }

  function haversine(lat1, lon1, lat2, lon2) {
    if (![lat1, lon1, lat2, lon2].every(v => Number.isFinite(Number(v)))) return null;
    const R = 6371000, rad = x => Number(x) * Math.PI / 180;
    const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function sourceLabel(url = '', sourceType = '') {
    const u = String(url || '');
    if (/clermontmetropole\.eu/i.test(u)) return 'Clermont Auvergne Métropole';
    if (/clermont-ferrand\.fr/i.test(u)) return 'Ville de Clermont-Ferrand';
    if (/opendata\.clermont/i.test(u)) return 'Open Data Clermont';
    if (/open-meteo\.com/i.test(u)) return 'Open-Meteo';
    if (/transport\.data\.gouv\.fr/i.test(u)) return 'transport.data.gouv.fr';
    if (/data\.gouv\.fr/i.test(u)) return 'data.gouv.fr';
    if (sourceType === 'official_page') return 'Source publique officielle';
    if (sourceType === 'clermont_api') return 'Open Data Métropole';
    return 'Source publique';
  }

  function enrichEvent(event, profile) {
    const e = { ...event };
    if (Number.isFinite(Number(e.distance_m))) e.distanceMeters = Math.round(Number(e.distance_m));
    const lat = Number(e.lat ?? e.latitude);
    const lon = Number(e.lon ?? e.lng ?? e.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(profile.lat) && Number.isFinite(profile.lon)) {
      e.distanceMeters = Math.round(haversine(profile.lat, profile.lon, lat, lon));
      if (e.distanceMeters <= profile.immediateRadius) e.proximityBand = 'immédiat';
      else if (e.distanceMeters <= profile.commercialRadius) e.proximityBand = 'commercial';
      else if (e.distanceMeters <= profile.extendedRadius) e.proximityBand = 'étendu';
      else e.proximityBand = 'hors zone';
    }
    e.sourceLabel = e.sourceLabel || e.source_label || sourceLabel(e.source || e.url, e.source_type);
    e.sourceUrl = e.sourceUrl || e.source || e.url || '';
    e.officialDescription = e.officialDescription || e.official_description || e.text || e.description || '';
    return e;
  }

  async function hydrateContext(model) {
    if (!model) return model;
    await bootstrapProfile();
    let profile = loadProfile();
    if (profile.address && (!Number.isFinite(profile.lat) || !Number.isFinite(profile.lon))) {
      try { profile = saveProfile({ ...profile, ...(await geocode(profile.address)) }); }
      catch (e) { console.warn('Power Context geocoding unavailable', e); }
    }
    model.storeProfile = profile;
    if (model.publicContext) {
      model.publicContext.store_profile = profile;
      for (const key of ['works','works_history','agenda','agenda_history','parking','cvelo','bike_counts']) {
        if (Array.isArray(model.publicContext[key])) model.publicContext[key] = model.publicContext[key].map(x => enrichEvent(x, profile));
      }
    }
    return model;
  }

  function profileSummary(profile = loadProfile()) {
    if (!profile.address) return { configured: false, label: 'Adresse commerce non configurée' };
    return {
      configured: true,
      label: profile.geocodeLabel || profile.address,
      coords: Number.isFinite(profile.lat) && Number.isFinite(profile.lon) ? `${profile.lat.toFixed(5)}, ${profile.lon.toFixed(5)}` : 'géocodage en attente',
      radius: `${profile.immediateRadius} m · ${profile.commercialRadius} m · ${profile.extendedRadius} m`
    };
  }

  function causeVisible(c) {
    return !!c && c.tested && ['strong','moderate'].includes(c.status) && Array.isArray(c.retainedCauses) && c.retainedCauses.length > 0;
  }

  function primaryCause(c) {
    return causeVisible(c) ? c.retainedCauses[0] : null;
  }

  function officialSourceCard(work) {
    if (!work) return '';
    const source = work.sourceLabel || sourceLabel(work.source || work.sourceUrl, work.source_type);
    const url = work.sourceUrl || work.source || '';
    const safeUrl = /^https?:\/\//i.test(String(url)) ? String(url) : '';
    const dates = [work.startDate, work.endDate].filter(Boolean).map(d => AU.util?.formatDate ? AU.util.formatDate(d) : String(d)).join(' → ');
    const distance = Number.isFinite(work.distanceMeters) ? `${work.distanceMeters} m du commerce` : '';
    const meta = [dates, distance, work.last_seen ? `collecté ${String(work.last_seen).slice(0,10)}` : ''].filter(Boolean).join(' · ');
    return `<article class="power-source-card">
      <div class="power-source-head"><span>SOURCE OFFICIELLE</span><strong>${esc(source)}</strong></div>
      <h4>${esc(work.place || work.sector || 'Événement public')}</h4>
      <p class="power-official-quote">${esc(work.officialDescription || work.text || '')}</p>
      ${meta ? `<div class="power-source-meta">${esc(meta)}</div>` : ''}
      ${safeUrl ? `<a class="power-source-link" href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir la source officielle ↗</a>` : ''}
    </article>`;
  }

  function bindProfileModal() {
    const modal = document.getElementById('storeModal');
    const btns = document.querySelectorAll('[data-open-store]');
    const close = () => modal?.classList.add('hidden');
    btns.forEach(b => b.addEventListener('click', () => {
      const p = loadProfile();
      document.getElementById('storeName').value = p.name || '';
      document.getElementById('storeAddress').value = p.address || '';
      document.getElementById('radiusImmediate').value = p.immediateRadius || 100;
      document.getElementById('radiusCommercial').value = p.commercialRadius || 500;
      document.getElementById('radiusExtended').value = p.extendedRadius || 2000;
      const s = document.getElementById('storeGeoStatus');
      if (s) s.textContent = p.geocodeLabel ? `✓ ${p.geocodeLabel}` : 'Adresse à géocoder';
      modal?.classList.remove('hidden');
    }));
    modal?.querySelectorAll('[data-close-store]').forEach(x => x.addEventListener('click', close));
    document.getElementById('saveStoreBtn')?.addEventListener('click', async () => {
      const saveBtn = document.getElementById('saveStoreBtn');
      const status = document.getElementById('storeGeoStatus');
      const base = {
        ...loadProfile(),
        name: document.getElementById('storeName').value.trim() || 'Point de vente',
        address: document.getElementById('storeAddress').value.trim(),
        immediateRadius: Number(document.getElementById('radiusImmediate').value || 100),
        commercialRadius: Number(document.getElementById('radiusCommercial').value || 500),
        extendedRadius: Number(document.getElementById('radiusExtended').value || 2000)
      };
      try {
        saveBtn.disabled = true; saveBtn.textContent = 'Vérification de l’adresse…';
        status.textContent = 'Vérification de l’adresse via le service public…';
        const geo = await geocode(base.address);
        const p = saveProfile({ ...base, ...geo });
        status.textContent = `✓ Adresse reconnue : ${p.geocodeLabel}`;
        document.getElementById('storeProfileBadge').textContent = p.city || 'Adresse configurée';
        const refreshed = await AU.app?.refreshContextFromStore?.();
        AU.ui?.toast?.(refreshed ? 'Adresse enregistrée · contexte et causalité recalculés.' : 'Adresse commerce enregistrée.', 'good');
        setTimeout(close, 500);
      } catch (e) {
        status.textContent = `Échec : ${e.message || e}`;
        AU.ui?.toast?.('Impossible de valider cette adresse.', 'bad');
      } finally { saveBtn.disabled = false; saveBtn.textContent = 'Enregistrer et vérifier autour du magasin'; }
    });
    const p = loadProfile();
    const badge = document.getElementById('storeProfileBadge');
    if (badge) badge.textContent = p.city || (p.address ? 'Adresse configurée' : 'Configurer le commerce');
  }

  function init() {
    bindProfileModal();
    bootstrapProfile().then(p=>{
      const badge=document.getElementById('storeProfileBadge');
      if(badge) badge.textContent=p.city || (p.address ? 'Adresse configurée' : 'Configurer le commerce');
    });
  }

  return { loadProfile, saveProfile, bootstrapProfile, geocode, hydrateContext, profileSummary, haversine, sourceLabel, causeVisible, primaryCause, officialSourceCard, init };
})();

document.addEventListener('DOMContentLoaded', () => AU.power?.init?.());
