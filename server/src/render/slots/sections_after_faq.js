// Home-page slot SECTIONS_AFTER_FAQ: every published section placed
// after_faq, in sort order. The engine lives in sections_after_about.js.
import { renderSectionsFor } from './sections_after_about.js';

export const renderSectionsAfterFaq = lang => renderSectionsFor('after_faq', lang);
export default renderSectionsAfterFaq;
