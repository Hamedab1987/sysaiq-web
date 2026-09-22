// Home-page slot SECTIONS_AFTER_WORK: every published section placed
// after_work, in sort order. The engine lives in sections_after_about.js.
import { renderSectionsFor } from './sections_after_about.js';

export const renderSectionsAfterWork = lang => renderSectionsFor('after_work', lang);
export default renderSectionsAfterWork;
