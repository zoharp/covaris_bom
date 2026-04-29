import React from 'react';

// Compact CSS-only spinner. Sized via the `size` prop (px). Inline-styled so
// it can drop into any context (next to a chevron, in a button, etc.).
export default function Spinner({ size = 16, color = 'var(--accent-primary)' }) {
  const s = size + 'px';
  return (
    <span
      className="spinner-ring"
      style={{
        width: s,
        height: s,
        borderColor: 'var(--accent-border)',
        borderTopColor: color,
      }}
      aria-label="Loading"
    />
  );
}
