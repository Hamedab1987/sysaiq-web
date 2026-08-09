// Server-rendered project detail page — /:lang/work/:slug.
// Matches the site's dark aesthetic (mint/violet on navy), fully bilingual
// with RTL for fa. Pure HTML string; no framework needed.
import { db } from './db.js';

function esc(s = '') {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const J = (s, d = []) => { try { return JSON.parse(s); } catch { return d; } };

export function findProject(slug) {
  return db.prepare('SELECT * FROM projects WHERE slug=? AND published=1').get(slug);
}

export function allProjects() {
  return db.prepare('SELECT * FROM projects WHERE published=1 ORDER BY sort, id').all();
}

// /:lang/work — the full portfolio grid, server-rendered from the DB.
export function renderWorkIndex(lang) {
  const fa = lang === 'fa';
  const other = fa ? 'en' : 'fa';
  const projects = allProjects();
  const L = fa ? {
    title: 'همه‌ی پروژه‌ها', sub: 'نمونه‌کارهای SysaiQ — سیستم‌ها و وب‌سایت‌هایی برای صنف‌ها و شرکت‌های مختلف',
    home: '← صفحه‌ی اصلی', cta: 'شروع پروژه', open: 'مشاهده‌ی پروژه',
  } : {
    title: 'All work', sub: 'SysaiQ portfolio — systems and websites across industries and trades',
    home: '← Home', cta: 'Start a project', open: 'View project',
  };
  const cards = projects.map(p => {
    const title = fa ? p.title_fa : p.title_en;
    const tag = fa ? (p.tagline_fa || p.desc_fa) : (p.tagline_en || p.desc_en);
    return `<a class="card" href="/${lang}/work/${esc(p.slug)}">
      <span class="thumb"><img src="${esc(p.image || p.cover_en)}" alt="${esc(title)}" loading="lazy"></span>
      <span class="cbody"><b>${esc(title)}</b><p>${esc(tag)}</p>
      <i dir="ltr">${esc(p.tags)}</i><em>${esc(L.open)} →</em></span>
    </a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="${lang}"${fa ? ' dir="rtl"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(L.title)} — SysaiQ</title>
<meta name="description" content="${esc(L.sub)}">
<link rel="canonical" href="https://sysaiq.com/${lang}/work">
<link rel="alternate" hreflang="en" href="https://sysaiq.com/en/work">
<link rel="alternate" hreflang="fa" href="https://sysaiq.com/fa/work">
<style>
  :root{--mint:#7dffd9;--violet:#8b6bff;--ink:#eceaf6;--dim:rgba(236,234,246,.6);
    --faint:rgba(236,234,246,.35);--line:rgba(236,234,246,.1);--bg:#070a12;--panel:#0e1422;}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--ink);line-height:1.6;
    font-family:${fa ? "'Vazirmatn'," : ''}-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    background-image:radial-gradient(120% 80% at 50% -10%, rgba(139,107,255,.10), transparent 55%);}
  ${fa ? `@font-face{font-family:'Vazirmatn';src:url(/assets/vazirmatn-var.woff2) format('woff2-variations');font-weight:100 900;font-display:swap;}` : ''}
  a{color:inherit;text-decoration:none}
  .wrap{max-width:1160px;margin:0 auto;padding:0 24px}
  header{position:sticky;top:0;z-index:20;backdrop-filter:blur(16px);
    background:rgba(7,10,18,.7);border-bottom:1px solid var(--line)}
  header .wrap{display:flex;align-items:center;justify-content:space-between;height:60px}
  .brand{display:flex;align-items:center;gap:9px;font-weight:700}
  .brand img{width:26px;height:26px}
  .brand span{background:linear-gradient(135deg,var(--mint),var(--violet));-webkit-background-clip:text;background-clip:text;color:transparent}
  .btn{display:inline-block;background:linear-gradient(135deg,var(--mint),var(--violet));
    color:#06101f;font-weight:600;padding:8px 16px;border-radius:10px;font-size:13px}
  .top-actions{display:flex;align-items:center;gap:16px;font-size:13px}
  .top-actions a.lang{color:var(--faint)} .top-actions a.lang:hover{color:var(--ink)}
  h1{font-size:clamp(30px,5vw,50px);font-weight:300;margin:44px 0 8px;letter-spacing:${fa ? '0' : '-.02em'}}
  .sub{color:var(--dim);margin-bottom:40px;max-width:640px}
  .back{display:inline-block;margin-top:28px;color:var(--dim);font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:22px;margin-bottom:70px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden;
    display:flex;flex-direction:column;transition:transform .3s cubic-bezier(.2,.6,.2,1),box-shadow .3s;}
  .card:hover{transform:translateY(-6px);box-shadow:0 30px 60px -28px rgba(139,107,255,.55);}
  .thumb{display:block;aspect-ratio:16/9;overflow:hidden;background:#081428}
  .thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .5s;}
  .card:hover .thumb img{transform:scale(1.05);}
  .cbody{display:block;padding:18px 20px 20px}
  .cbody b{display:block;font-size:16px;font-weight:500;margin-bottom:6px}
  .cbody p{font-size:12.5px;color:var(--dim);line-height:1.7;min-height:42px}
  .cbody i{display:block;font-style:normal;margin-top:10px;font-size:9.5px;letter-spacing:.14em;
    color:var(--mint);font-family:"SF Mono",ui-monospace,Menlo,monospace;text-align:start;}
  .cbody em{display:inline-block;font-style:normal;margin-top:12px;font-size:12px;color:var(--mint);opacity:.85}
  footer{border-top:1px solid var(--line);padding:26px 0;color:var(--faint);font-size:12px}
  footer .wrap{display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px}
</style>
</head>
<body>
<header><div class="wrap">
  <a class="brand" href="/${lang}/"><img src="/assets/logo-mark-160.png" alt=""><span>SysaiQ</span></a>
  <div class="top-actions">
    <a class="lang" href="/${other}/work">${other.toUpperCase()}</a>
    <a class="btn" href="/${lang}/#contact">${esc(L.cta)}</a>
  </div>
</div></header>
<main class="wrap">
  <a class="back" href="/${lang}/">${esc(L.home)}</a>
  <h1>${esc(L.title)}</h1>
  <p class="sub">${esc(L.sub)}</p>
  <div class="grid">${cards}</div>
</main>
<footer><div class="wrap">
  <span>© 2026 SysaiQ · Hamed Systems Lab</span>
  <a href="/${lang}/" style="color:var(--dim)">sysaiq.com</a>
</div></footer>
</body>
</html>`;
}

export function renderProjectPage(p, lang) {
  const fa = lang === 'fa';
  const t = (en, faStr) => (fa ? faStr || en : en);
  const dir = fa ? 'rtl' : 'ltr';
  const other = fa ? 'en' : 'fa';
  const title = fa ? p.title_fa : p.title_en;
  const tagline = fa ? p.tagline_fa : p.tagline_en;
  const overview = fa ? p.overview_fa : p.overview_en;
  const cover = (fa ? p.cover_fa : p.cover_en) || p.cover_en || p.image;
  const industries = J(p.industries).map(x => (fa ? x.fa || x.en : x.en));
  const features = J(p.features);
  const pages = J(p.pages);

  const L = fa ? {
    back: '← بازگشت به پروژه‌ها', overview: 'معرفی', industries: 'صنایع هدف',
    features: 'قابلیت‌های متمایز', featuresSub: 'چیزهایی که در محصولات مشابه معمولاً نیست',
    pages: 'صفحات و رابط کاربری', cta: 'پروژه‌ای مشابه می‌خواهید؟', ctaBtn: 'شروع پروژه',
    ui: 'نمای رابط کاربری',
  } : {
    back: '← Back to work', overview: 'Overview', industries: 'Target industries',
    features: 'What makes it different', featuresSub: "Capabilities you won't usually find in similar products",
    pages: 'Screens & UI', cta: 'Want something like this?', ctaBtn: 'Start a project',
    ui: 'Interface preview',
  };

  return `<!DOCTYPE html>
<html lang="${lang}"${fa ? ' dir="rtl"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — SysaiQ</title>
<meta name="description" content="${esc(tagline)}">
<link rel="canonical" href="https://sysaiq.com/${lang}/work/${esc(p.slug)}">
<link rel="alternate" hreflang="en" href="https://sysaiq.com/en/work/${esc(p.slug)}">
<link rel="alternate" hreflang="fa" href="https://sysaiq.com/fa/work/${esc(p.slug)}">
<meta property="og:title" content="${esc(title)} — SysaiQ">
<meta property="og:description" content="${esc(tagline)}">
<meta property="og:image" content="https://sysaiq.com${esc(cover)}">
<style>
  :root{--mint:#7dffd9;--violet:#8b6bff;--ink:#eceaf6;--dim:rgba(236,234,246,.6);
    --faint:rgba(236,234,246,.35);--line:rgba(236,234,246,.1);--bg:#070a12;--panel:#0e1422;}
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{background:var(--bg);color:var(--ink);line-height:1.6;
    font-family:${fa ? "'Vazirmatn'," : ''}-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    background-image:radial-gradient(120% 80% at 50% -10%, rgba(139,107,255,.10), transparent 55%),
      radial-gradient(90% 60% at 100% 0%, rgba(125,255,217,.06), transparent 50%);}
  ${fa ? `@font-face{font-family:'Vazirmatn';src:url(/assets/vazirmatn-var.woff2) format('woff2-variations');font-weight:100 900;font-display:swap;}` : ''}
  a{color:inherit;text-decoration:none}
  .wrap{max-width:1080px;margin:0 auto;padding:0 24px}
  header{position:sticky;top:0;z-index:20;backdrop-filter:blur(16px);
    background:rgba(7,10,18,.7);border-bottom:1px solid var(--line)}
  header .wrap{display:flex;align-items:center;justify-content:space-between;height:60px}
  .brand{display:flex;align-items:center;gap:9px;font-weight:700}
  .brand img{width:26px;height:26px}
  .brand span{background:linear-gradient(135deg,var(--mint),var(--violet));-webkit-background-clip:text;background-clip:text;color:transparent}
  .top-actions{display:flex;align-items:center;gap:16px;font-size:13px}
  .top-actions a.lang{color:var(--faint)} .top-actions a.lang:hover{color:var(--ink)}
  .back{display:inline-block;margin:30px 0 8px;color:var(--dim);font-size:13px}
  .back:hover{color:var(--mint)}
  h1{font-size:clamp(30px,5vw,52px);font-weight:300;letter-spacing:${fa ? '0' : '-.02em'};line-height:1.08;margin-bottom:14px}
  .tagline{font-size:clamp(15px,2.2vw,20px);color:var(--mint);margin-bottom:22px;font-weight:400}
  .tags{font-family:${fa ? 'inherit' : "'SF Mono',ui-monospace,Menlo,monospace"};font-size:11px;letter-spacing:.12em;color:var(--faint);margin-bottom:30px}
  .hero-img{width:100%;border-radius:16px;border:1px solid var(--line);display:block;
    box-shadow:0 40px 90px -30px rgba(0,0,0,.7);margin-bottom:8px}
  .hero-cap{font-size:11px;color:var(--faint);text-align:center;margin-bottom:50px;
    font-family:${fa ? 'inherit' : "'SF Mono',ui-monospace,Menlo,monospace"};letter-spacing:.08em}
  section.blk{margin:46px 0}
  h2{font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);
    margin-bottom:18px;font-weight:500;${fa ? 'letter-spacing:.05em;' : ''}}
  .lead{font-size:clamp(17px,2.4vw,22px);font-weight:300;color:var(--ink);max-width:760px;line-height:1.55}
  .chips{display:flex;flex-wrap:wrap;gap:10px}
  .chip{border:1px solid var(--line);background:var(--panel);border-radius:100px;padding:9px 16px;font-size:13.5px;color:var(--dim)}
  .feat-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .feat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px}
  .feat .n{font-family:${fa ? 'inherit' : "'SF Mono',ui-monospace,Menlo,monospace"};font-size:12px;color:var(--mint);margin-bottom:10px}
  .feat h3{font-size:16px;font-weight:500;margin-bottom:8px}
  .feat p{font-size:13.5px;color:var(--dim);line-height:1.7}
  .pages-list{display:flex;flex-direction:column;gap:2px}
  .pg{display:flex;gap:16px;padding:16px 4px;border-top:1px solid var(--line);align-items:baseline}
  .pg:last-child{border-bottom:1px solid var(--line)}
  .pg .pn{flex:0 0 190px;font-weight:500;font-size:14.5px}
  .pg .pd{color:var(--dim);font-size:13.5px}
  .cta{text-align:center;margin:70px 0 40px;padding:44px 20px;border:1px solid var(--line);
    border-radius:18px;background:linear-gradient(160deg,rgba(139,107,255,.10),rgba(125,255,217,.05))}
  .cta h2{color:var(--ink);font-size:clamp(22px,3.5vw,32px);text-transform:none;letter-spacing:-.01em;font-weight:300;margin-bottom:20px}
  .btn{display:inline-block;background:linear-gradient(135deg,var(--mint),var(--violet));
    color:#06101f;font-weight:600;padding:13px 30px;border-radius:10px;font-size:14px}
  footer{border-top:1px solid var(--line);margin-top:30px;padding:26px 0;color:var(--faint);font-size:12px}
  footer .wrap{display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px}
  @media (max-width:720px){.feat-grid{grid-template-columns:1fr}.pg{flex-direction:column;gap:4px}.pg .pn{flex-basis:auto}}
</style>
</head>
<body>
<header><div class="wrap">
  <a class="brand" href="/${lang}/"><img src="/assets/logo-mark-160.png" alt=""><span>SysaiQ</span></a>
  <div class="top-actions">
    <a class="lang" href="/${other}/work/${esc(p.slug)}">${other.toUpperCase()}</a>
    <a class="btn" style="padding:8px 16px" href="/${lang}/#contact">${esc(L.ctaBtn)}</a>
  </div>
</div></header>

<main class="wrap">
  <a class="back" href="/${lang}/#work">${esc(L.back)}</a>
  <h1>${esc(title)}</h1>
  <p class="tagline">${esc(tagline)}</p>
  <p class="tags">${esc(p.tags)}</p>

  <img class="hero-img" src="${esc(cover)}" alt="${esc(title)} UI" loading="eager">
  <p class="hero-cap">${esc(L.ui)}${fa && p.slug === 'trading' ? ' · EN' : ''}</p>

  <section class="blk">
    <h2>${esc(L.overview)}</h2>
    <p class="lead">${esc(overview)}</p>
  </section>

  ${industries.length ? `<section class="blk">
    <h2>${esc(L.industries)}</h2>
    <div class="chips">${industries.map(i => `<span class="chip">${esc(i)}</span>`).join('')}</div>
  </section>` : ''}

  ${features.length ? `<section class="blk">
    <h2>${esc(L.features)}</h2>
    <p class="lead" style="font-size:14px;color:var(--dim);margin-bottom:22px">${esc(L.featuresSub)}</p>
    <div class="feat-grid">${features.map((f, i) => `
      <div class="feat"><div class="n">[ 0${i + 1} ]</div>
        <h3>${esc(fa ? f.title_fa : f.title_en)}</h3>
        <p>${esc(fa ? f.desc_fa : f.desc_en)}</p></div>`).join('')}</div>
  </section>` : ''}

  ${pages.length ? `<section class="blk">
    <h2>${esc(L.pages)}</h2>
    <div class="pages-list">${pages.map(pg => `
      <div class="pg"><div class="pn">${esc(fa ? pg.name_fa : pg.name_en)}</div>
        <div class="pd">${esc(fa ? pg.desc_fa : pg.desc_en)}</div></div>`).join('')}</div>
  </section>` : ''}

  <div class="cta">
    <h2>${esc(L.cta)}</h2>
    <a class="btn" href="/${lang}/#contact">${esc(L.ctaBtn)}</a>
  </div>
</main>

<footer><div class="wrap">
  <span>© 2026 SysaiQ · Hamed Systems Lab</span>
  <a href="/${lang}/" style="color:var(--dim)">sysaiq.com</a>
</div></footer>
</body>
</html>`;
}
