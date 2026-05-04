// HTML sanitizer for Orcanos field values. Some fields can contain HTML
// (per the source design doc). We allow a small set of formatting tags
// and strip everything else.

import DOMPurify from 'dompurify';

const CONFIG = {
  ALLOWED_TAGS: [
    'b', 'i', 'u', 'em', 'strong', 'span', 'br',
    'a', 'p', 'ul', 'ol', 'li', 'img',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style', 'src', 'alt', 'width', 'height'],
  ALLOW_DATA_ATTR: false,
  // Force any link to open in a new tab and never expose window.opener.
  ADD_ATTR: ['target', 'rel'],
};

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.tagName === 'IMG') {
    const src = node.getAttribute('src');
    if (src) {
      // Orcanos sometimes stores paths with extra leading slashes (e.g. ///covarisFTP/...).
      // Normalize by collapsing consecutive slashes in the path portion only.
      const fixed = src.replace(/^(https?:\/\/)([^/]+)(\/+)/, (_, proto, host) => `${proto}${host}/`);
      node.setAttribute('src', fixed);
    }
  }
});

export function sanitizeHtml(html) {
  if (html == null) return '';
  return DOMPurify.sanitize(String(html), CONFIG);
}
