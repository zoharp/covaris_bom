import React, { useState } from 'react';
import { exportJson, exportCsv, exportHtml, exportPdf } from './exportUtils';

const FORMATS = [
  { id: 'json', label: 'JSON' },
  { id: 'csv',  label: 'CSV' },
  { id: 'html', label: 'HTML (interactive)' },
  { id: 'pdf',  label: 'PDF' },
];

export default function ExportModal({ rootNode, columns, onClose }) {
  const [format, setFormat] = useState('html');
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    const bomName = rootNode.row.objName || rootNode.row.userPrefix || 'BOM';
    setExporting(true);
    try {
      const opts = { bomName };
      if (format === 'json') await exportJson(rootNode.row, columns, opts);
      else if (format === 'csv') await exportCsv(rootNode.row, columns, opts);
      else if (format === 'html') await exportHtml(rootNode.row, columns, opts);
      else if (format === 'pdf') await exportPdf(rootNode.row, columns, opts);
      onClose();
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Export BOM</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <p className="export-modal-bom-name">
            {rootNode.row.objName || rootNode.row.userPrefix || 'BOM'}
          </p>

          <fieldset className="export-format-group">
            <legend className="export-section-label">Format</legend>
            {FORMATS.map((f) => (
              <label key={f.id} className="export-format-option">
                <input
                  type="radio"
                  name="export-format"
                  value={f.id}
                  checked={format === f.id}
                  onChange={() => setFormat(f.id)}
                />
                {f.label}
              </label>
            ))}
          </fieldset>

        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={exporting}>Cancel</button>
          <button className="btn-primary" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Fetching…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
