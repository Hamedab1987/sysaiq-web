// SysaiQ AI assistant.
// Grounds every answer in the admin-managed knowledge base, auto-detects
// the visitor's language (fa/en) and replies in kind, and can quietly
// capture a qualified lead. Uses OpenAI's chat completions.
import OpenAI from 'openai';
import { db } from './db.js';

import { getSetting } from './db.js';

// The OpenAI key + model can be set two ways: in .env, or (preferred, so
// the admin can manage it without SSH) via the admin panel, which stores
// them in the settings table. The DB value wins when present.
function aiConfig() {
  const s = getSetting('ai_config', {}) || {};
  return {
    key: s.openai_key || process.env.OPENAI_API_KEY || '',
    model: s.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };
}

let client = null, clientKey = null;
function openai() {
  const { key } = aiConfig();
  if (!key) return null;
  if (!client || clientKey !== key) { client = new OpenAI({ apiKey: key }); clientKey = key; }
  return client;
}

// crude but effective language detection: any Persian/Arabic block → fa
function detectLang(text = '') {
  return /[؀-ۿ]/.test(text) ? 'fa' : 'en';
}

// pull the enabled knowledge base, formatted for the system prompt
function knowledgeContext(lang) {
  const rows = db.prepare('SELECT title, body_en, body_fa, tags FROM knowledge WHERE enabled=1').all();
  if (!rows.length) return '';
  return rows.map(r => {
    const body = lang === 'fa' ? (r.body_fa || r.body_en) : (r.body_en || r.body_fa);
    return `### ${r.title}${r.tags ? ` [${r.tags}]` : ''}\n${body}`;
  }).join('\n\n');
}

function systemPrompt(lang) {
  const kb = knowledgeContext(lang);
  const base = lang === 'fa'
    ? `تو دستیار هوشمند و فروشنده‌ی وب‌سایت SysaiQ هستی — یک لابراتوار نرم‌افزار و هوش مصنوعی که وب‌سایت اختصاصی، اپلیکیشن، AI Agent، اتوماسیون و سیستم‌های حسابداری و معاملاتی می‌سازد.
- فقط بر اساس دانشِ زیر پاسخ بده. اگر چیزی را نمی‌دانی، صادقانه بگو و پیشنهاد بده کاربر پروژه‌اش را ثبت کند.
- کوتاه، حرفه‌ای و گرم پاسخ بده. اصطلاحات فنی (AI, Agent, RAG, API) را انگلیسی نگه دار.
- اگر شغل یا صنف بازدیدکننده را نمی‌دانی، با یک سؤال کوتاه و دوستانه بپرس چه کسب‌وکاری دارد.
- وقتی صنفش را گفت، از ورودی «Pitch» همان صنف در دانش استفاده کن: ۲-۳ دردِ رایج آن کسب‌وکار را به اسم ببر، راه‌حل SysaiQ را معرفی کن و لینک صفحه‌ی پروژه‌ی مرتبط را بده (برای فارسی از مسیرهای /fa/work/... استفاده کن).
- در پایان هر پیچ، پیشنهاد بده نام و شماره تماس یا ایمیلش را بگذارد تا مشاوره‌ی رایگان و بدون تعهد بگیرد. هرگز پرفشار نباش؛ همیشه مشخص و مفید.`
    : `You are the AI assistant and salesperson for SysaiQ — an AI & software lab building custom websites, apps, AI agents, automation, and accounting & trading systems.
- Answer ONLY from the knowledge below. If you don't know, say so honestly and invite the visitor to start a project.
- Be concise, professional and warm.
- If you don't know the visitor's industry yet, ask one short friendly question about what business they run.
- Once they tell you, use that industry's "Pitch" knowledge entry: name 2-3 of that business's real pains, present the matching SysaiQ solutions, and share the relevant project link (/en/work/... for English).
- End each pitch by inviting them to leave their name and phone/email for a free, no-obligation consult. Never pushy; always concrete.`;
  return kb ? `${base}\n\n---\nKNOWLEDGE BASE:\n${kb}` : base;
}

const FALLBACK = {
  fa: 'دستیار هوشمند هنوز فعال نشده است (کلید OpenAI تنظیم نشده). لطفاً پروژه‌تان را از فرم تماس ثبت کنید یا به hello@sysaiq.com ایمیل بزنید.',
  en: "The AI assistant isn't configured yet (missing OpenAI key). Please use the contact form or email hello@sysaiq.com.",
};

export async function chat({ sessionId, message, history = [] }) {
  const lang = detectLang(message);
  const api = openai();

  // log the user turn
  db.prepare('INSERT INTO conversations (session_id, role, content, language) VALUES (?,?,?,?)')
    .run(sessionId, 'user', message, lang);

  if (!api) {
    return { reply: FALLBACK[lang], lang, configured: false };
  }

  const messages = [
    { role: 'system', content: systemPrompt(lang) },
    ...history.slice(-8).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  let reply;
  try {
    const res = await api.chat.completions.create({
      model: aiConfig().model,
      messages,
      temperature: 0.4,
      max_tokens: 500,
    });
    reply = res.choices[0]?.message?.content?.trim() || FALLBACK[lang];
  } catch (err) {
    console.error('AI error:', err.message);
    reply = FALLBACK[lang];
  }

  db.prepare('INSERT INTO conversations (session_id, role, content, language) VALUES (?,?,?,?)')
    .run(sessionId, 'assistant', reply, lang);

  return { reply, lang, configured: true };
}
