import React, { useEffect, useState } from 'react';
import { fetchRelatedEcos, orcanosItemUrl } from '../api/orcanosClient';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import Spinner from '../ui/Spinner';

export default function EcoModal({ row, onClose, onAuthExpired }) {
  const [ecos, setEcos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchRelatedEcos({ row })
      .then(({ rows }) => {
        if (!cancelled) { setEcos(rows); setLoading(false); }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        if (err.httpCode === 401) { onAuthExpired?.(); onClose(); }
        else setError(err.message || 'Failed to load ECOs.');
      });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = ecos && ecos.length > 0
    ? ecos[0].fields.map((f) => ({ key: f.Name, title: f.Title || f.Name }))
    : [];

  function isKeyColumn(c) {
    return c.key === 'User_Prefix' || String(c.title || '').trim().toLowerCase() === 'key';
  }

  function cellValue(ecoRow, colKey) {
    return ecoRow.byName(colKey) || ecoRow.byTitle(colKey) || '';
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal eco-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            Related ECOs{row.objName ? ` — ${row.objName}` : ''}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body eco-modal-body">
          {loading && (
            <div className="eco-modal-state">
              <Spinner size={20} />
              <p>Loading ECOs…</p>
            </div>
          )}
          {!loading && error && (
            <div className="eco-modal-state">
              <p className="eco-modal-error">{error}</p>
            </div>
          )}
          {!loading && !error && ecos && ecos.length === 0 && (
            <div className="eco-modal-state">
              <p>No ECOs found for this item.</p>
            </div>
          )}
          {!loading && !error && ecos && ecos.length > 0 && (
            <div className="eco-modal-table-wrap">
              <table className="bom-grid eco-modal-table">
                <thead>
                  <tr>
                    {columns.map((c) => <th key={c.key}>{c.title}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ecos.map((ecoRow, i) => (
                    <tr key={i}>
                      {columns.map((c) => {
                        const value = cellValue(ecoRow, c.key);
                        const tooltip = String(value).replace(/<[^>]+>/g, '').trim();
                        if (isKeyColumn(c) && ecoRow.itemId) {
                          const href = orcanosItemUrl({ type: 'CR', itemId: ecoRow.itemId });
                          return (
                            <td key={c.key} className="bom-col-key" title={tooltip}>
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }}
                              />
                            </td>
                          );
                        }
                        return (
                          <td key={c.key} className="bom-col-text" title={tooltip}>
                            <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
