// Structured data (schema.org JSON-LD) for the public pages.
//   professionalService('fa') → ProfessionalService with the Qazvin address + the visible phones
//   breadcrumb([{name, url}]) → BreadcrumbList
//   faqPage([{q, a}])         → FAQPage
//   jsonLdScript(obj|[obj])   → <script type="application/ld+json">…</script>
// Serialised with jsonForScript(): "<" becomes <, so a "</script>" typed
// into any admin field can never close the element.
// Only what the owner shows on the page goes to the crawlers: getSiteInfo()
// already applies show.* (hidden phone → not in `telephone`, hidden e-mail /
// street address / postal code / geo / socials / hours → key omitted). City,
// region and country stay: "based in Qazvin" is in the public tagline.
import { config } from '../config.js';
import { jsonForScript } from './html.js';
import { getSiteInfo } from './siteinfo.js';

const DAY_NAME = { Mo: 'Monday', Tu: 'Tuesday', We: 'Wednesday', Th: 'Thursday', Fr: 'Friday', Sa: 'Saturday', Su: 'Sunday' };
const base = () => config.publicBaseUrl;
const absolute = p => (/^https?:\/\//.test(p) ? p : `${base()}${p.startsWith('/') ? '' : '/'}${p}`);

export function professionalService(lang = 'fa') {
  const s = getSiteInfo(lang);
  const telephone = s.phones.filter(p => p.visible).map(p => p.e164);
  const out = {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    '@id': `${base()}/#organization`,
    name: s.brand,
    url: `${base()}/${s.lang}/`,
    image: `${base()}/og.jpg`,
    logo: `${base()}/assets/logo-mark-160.png`,
    founder: { '@type': 'Person', name: s.owner_name },
    address: {
      '@type': 'PostalAddress',
      ...(s.address ? { streetAddress: s.address } : {}),
      addressLocality: s.city,
      addressRegion: s.region,
      addressCountry: s.country,
      ...(s.postal_code ? { postalCode: s.postal_code } : {}),
    },
    ...(telephone.length === 1 ? { telephone: telephone[0] } : telephone.length ? { telephone } : {}),
    ...(s.email ? { email: s.email } : {}),
    areaServed: { '@type': 'Country', name: s.country },
    inLanguage: s.lang === 'fa' ? 'fa-IR' : 'en',
  };
  if (s.geo) out.geo = { '@type': 'GeoCoordinates', latitude: s.geo.lat, longitude: s.geo.lng };
  if (s.socials.length) out.sameAs = s.socials.map(x => x.url);
  if (s.hours_spec.length) {
    out.openingHoursSpecification = s.hours_spec.map(h => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.days.map(d => DAY_NAME[d]).filter(Boolean),
      opens: h.opens,
      closes: h.closes,
    }));
  }
  return out;
}

// items: [{name, url}] in order; url may be site-relative
export function breadcrumb(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: (items || []).map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: String(it.name ?? ''),
      item: absolute(String(it.url ?? '/')),
    })),
  };
}

// items: [{q, a}] — plain text answers (already-rendered HTML is not wanted here)
export function faqPage(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: (items || []).map(it => ({
      '@type': 'Question',
      name: String(it.q ?? ''),
      acceptedAnswer: { '@type': 'Answer', text: String(it.a ?? '') },
    })),
  };
}

export const serialise = obj => jsonForScript(obj);

// one element per object; an array renders one <script> per item
export function jsonLdScript(objs) {
  const list = (Array.isArray(objs) ? objs : [objs]).filter(Boolean);
  return list.map(o => `<script type="application/ld+json">${jsonForScript(o)}</script>`).join('\n');
}
