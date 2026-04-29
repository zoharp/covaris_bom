import React from 'react';

// Three icon states: BOM (root), Assembly (has children), Part (leaf).
// All icons share the same 16x16 viewBox so the layout is stable when icon
// swaps after first expand.

export function BomIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="3" width="12" height="10" rx="1.5"
            fill="var(--accent-primary)" opacity="0.18"
            stroke="var(--accent-primary)" strokeWidth="1.2"/>
      <line x1="2" y1="6" x2="14" y2="6"
            stroke="var(--accent-primary)" strokeWidth="1.2"/>
      <circle cx="4.5" cy="4.5" r="0.6" fill="var(--accent-primary)"/>
    </svg>
  );
}

export function AssemblyIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="2" width="6" height="6" rx="1"
            fill="none" stroke="var(--accent-orange)" strokeWidth="1.2"/>
      <rect x="8" y="8" width="6" height="6" rx="1"
            fill="none" stroke="var(--accent-orange)" strokeWidth="1.2"/>
      <line x1="5" y1="8" x2="5" y2="11" stroke="var(--accent-orange)"
            strokeWidth="1.2"/>
      <line x1="5" y1="11" x2="8" y2="11" stroke="var(--accent-orange)"
            strokeWidth="1.2"/>
    </svg>
  );
}

export function PartIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="4.5"
              fill="none" stroke="var(--text-secondary)" strokeWidth="1.2"/>
      <circle cx="8" cy="8" r="1.5" fill="var(--text-secondary)"/>
    </svg>
  );
}

export function ChevronIcon({ open, size = 12 }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={{
        transform: open ? 'rotate(90deg)' : 'rotate(0)',
        transition: 'transform 150ms ease',
      }}
    >
      <path d="M4 2 L8 6 L4 10" fill="none"
            stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// Used as the icon for a row of unknown subtype that hasn't been expanded yet.
// Once expanded it will be replaced with AssemblyIcon or PartIcon.
export function UnknownChildIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="3" width="10" height="10" rx="1.5"
            fill="none" stroke="var(--text-tertiary)" strokeWidth="1.2"
            strokeDasharray="2 2"/>
    </svg>
  );
}
