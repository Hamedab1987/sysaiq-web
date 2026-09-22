// UI kit barrel. Views import ONLY from '../ui.js', '../api.js' and
// '../strings.js'. The executable reference for every export is
// views/_ui.view.js (#/_ui).
export { h, svg, frag, clear, replace, on, icon, useStyles, uid, focusFirst, extLink } from './ui/dom.js';
export { toFaDigits, toEnDigits, formatNumber, formatToman, parseServerDate, formatJalali, jalaliParts, formatMobile, formatLandline, formatBytes, formatPercent, truncate, localDayKey, isToday } from './ui/format.js';
export { validators, validate, runValidators } from './ui/validate.js';
export { field, textareaField, selectField, switchField, numberField, moneyField, dateFieldJalali, tagsField, slugField, secretField, codeField, markdownField, createForm, submitButton, makeField, slugify, activeForm } from './ui/form.js';
export { bilingualField } from './ui/bilingual.js';
export { repeater } from './ui/repeater.js';
export { dataTable, filterBar, matchesQuery } from './ui/table.js';
export { modal, drawer, confirm, closeAllOverlays, overlayCount } from './ui/overlay.js';
export { toast, badge, statusBadge, STATUS_MAP, emptyState, errorState, skeleton, progressRing, checklist, statCard, copyToClipboard } from './ui/feedback.js';
export { pageHeader, card, tabs, stickyActionBar } from './ui/layout.js';
export { uploadImage, imageField } from './ui/upload.js';
export { registerShortcut, debounce, throttle, modKeyLabel } from './ui/shortcuts.js';
export { toJalali, toGregorian, isLeapJalali, jalaliMonthLength, JALALI_MONTHS, isoToJalaliInput, jalaliInputToIso, todayJalali } from './lib/jalali.js';
// topbar counter for a view that manages its own fields (createForm does this itself)
export { setDirty } from './store.js';

import * as dom from './ui/dom.js';
import { setDirty as setDirtyFn } from './store.js';
import * as format from './ui/format.js';
import * as validateMod from './ui/validate.js';
import * as form from './ui/form.js';
import * as bilingual from './ui/bilingual.js';
import * as repeaterMod from './ui/repeater.js';
import * as table from './ui/table.js';
import * as overlay from './ui/overlay.js';
import * as feedback from './ui/feedback.js';
import * as layout from './ui/layout.js';
import * as upload from './ui/upload.js';
import * as shortcuts from './ui/shortcuts.js';
import * as jalali from './lib/jalali.js';

// ctx.ui — the same surface as the named exports, as one object
export const ui = Object.freeze({
  ...dom, ...format, ...validateMod, ...form, ...bilingual, ...repeaterMod, ...table, ...overlay, ...feedback, ...layout, ...upload, ...shortcuts,
  toJalali: jalali.toJalali, toGregorian: jalali.toGregorian, isLeapJalali: jalali.isLeapJalali, jalaliMonthLength: jalali.jalaliMonthLength,
  JALALI_MONTHS: jalali.JALALI_MONTHS, isoToJalaliInput: jalali.isoToJalaliInput, jalaliInputToIso: jalali.jalaliInputToIso, todayJalali: jalali.todayJalali,
  setDirty: setDirtyFn,
});
export default ui;
