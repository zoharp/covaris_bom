import React from 'react';

// Three icon states: BOM (root), Assembly (has children), Part (leaf).
// All icons share the same 16x16 viewBox so the layout is stable when icon
// swaps after first expand.

// BOM — root hierarchy. Filled top node, three outlined leaves connected by
// branch lines. Reads visually as "this is the root of a tree".
export function BomIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <line x1="8" y1="4.6" x2="8" y2="8.4"
            stroke="var(--accent-primary)" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="3" y1="8.4" x2="13" y2="8.4"
            stroke="var(--accent-primary)" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="3" y1="8.4" x2="3" y2="11.5"
            stroke="var(--accent-primary)" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="8" y1="8.4" x2="8" y2="11.5"
            stroke="var(--accent-primary)" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="13" y1="8.4" x2="13" y2="11.5"
            stroke="var(--accent-primary)" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="8" cy="3" r="2" fill="var(--accent-primary)"/>
      <circle cx="3" cy="13" r="1.6"
              fill="#fff" stroke="var(--accent-primary)" strokeWidth="1.3"/>
      <circle cx="8" cy="13" r="1.6"
              fill="#fff" stroke="var(--accent-primary)" strokeWidth="1.3"/>
      <circle cx="13" cy="13" r="1.6"
              fill="#fff" stroke="var(--accent-primary)" strokeWidth="1.3"/>
    </svg>
  );
}

// Assembly — a gear / cog. Suggests an engineered sub-grouping.
export function AssemblyIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="var(--accent-orange)" strokeWidth="1.3" strokeLinecap="round" fill="none">
        <circle cx="8" cy="8" r="3"/>
        <line x1="8" y1="2.2" x2="8" y2="3.6"/>
        <line x1="8" y1="12.4" x2="8" y2="13.8"/>
        <line x1="2.2" y1="8" x2="3.6" y2="8"/>
        <line x1="12.4" y1="8" x2="13.8" y2="8"/>
        <line x1="3.9" y1="3.9" x2="4.9" y2="4.9"/>
        <line x1="11.1" y1="11.1" x2="12.1" y2="12.1"/>
        <line x1="12.1" y1="3.9" x2="11.1" y2="4.9"/>
        <line x1="4.9" y1="11.1" x2="3.9" y2="12.1"/>
      </g>
      <circle cx="8" cy="8" r="1.1" fill="var(--accent-orange)"/>
    </svg>
  );
}

// Part — a hex nut / fastener. A single discrete component.
export function PartIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <polygon points="8,2 13.2,5 13.2,11 8,14 2.8,11 2.8,5"
               fill="none" stroke="var(--text-secondary)" strokeWidth="1.3"
               strokeLinejoin="round"/>
      <circle cx="8" cy="8" r="1.9" fill="var(--text-secondary)"/>
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

// Where Used — magnifier over a small hierarchy. Click-to-find-where-it's-used.
export function WhereUsedIcon({ size = 14 }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="6.5" cy="6.5" r="3.6"
              fill="none" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="9.4" y1="9.4" x2="13" y2="13"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <line x1="4.8" y1="6.5" x2="8.2" y2="6.5"
            stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="6.5" y1="4.8" x2="6.5" y2="8.2"
            stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

// Locate — a target/crosshair. Used in Where-Used results to expand a BOM
// and scroll to the matching descendant.
export function LocateIcon({ size = 14 }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="5"
              fill="none" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="8" cy="8" r="1.6" fill="currentColor"/>
      <line x1="8" y1="1.4" x2="8" y2="3.4"
            stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="8" y1="12.6" x2="8" y2="14.6"
            stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="1.4" y1="8" x2="3.4" y2="8"
            stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="12.6" y1="8" x2="14.6" y2="8"
            stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
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
