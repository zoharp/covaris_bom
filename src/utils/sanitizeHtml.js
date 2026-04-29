// HTML sanitizer for Orcanos field values. Some fields can contain HTML
// (per the source design doc). We allow a small set of formatting tags
// and strip everything else.

import DOMPurify from 'dompurify';

const CONFIG = {
  ALLOWED_TAGS: [
    'b', 'i', 'u', 'em', 'strong', 'span', 'br',
    'a', 'p', 'ul', 'ol', 'li',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
  ALLOW_DATA_ATTR: false,
  // Force any link to open in a new tab and never expose window.opener.
  ADD_ATTR: ['target', 'rel'],
};

// Add a hook so any rendered <a> opens safely in a new tab.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function sanitizeHtml(html) {
  if (html == null) return '';
  return DOMPurify.sanitize(String(html), CONFIG);
}
