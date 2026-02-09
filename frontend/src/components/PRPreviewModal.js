import React from 'react';
import './PRPreviewModal.css';

export function PRPreviewModal({ preview, onConfirm, onCancel, loading }) {
  if (!preview) return null;

  const hasErrors = preview.validation?.errors?.length > 0;
  const hasWarnings = preview.validation?.warnings?.length > 0;
  const hasDuplicates = preview.validation?.duplicates?.length > 0;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📋 Anteprima Pull Request</h2>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>

        <div className="modal-body">
          {/* Titolo e Descrizione */}
          <div className="preview-section">
            <h3>Titolo PR</h3>
            <div className="preview-value">{preview.title}</div>
          </div>

          {preview.body && (
            <div className="preview-section">
              <h3>Descrizione</h3>
              <div className="preview-value preview-body">{preview.body}</div>
            </div>
          )}

          {/* Statistiche */}
          <div className="preview-stats">
            <div className="stat-card">
              <div className="stat-icon">📁</div>
              <div className="stat-content">
                <div className="stat-value">{preview.fileCount}</div>
                <div className="stat-label">File</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">🏢</div>
              <div className="stat-content">
                <div className="stat-value">{preview.organizations.length}</div>
                <div className="stat-label">Organizzazioni</div>
              </div>
            </div>
            {hasWarnings && (
              <div className="stat-card warning">
                <div className="stat-icon">⚠️</div>
                <div className="stat-content">
                  <div className="stat-value">{preview.validation.warnings.length}</div>
                  <div className="stat-label">Warning</div>
                </div>
              </div>
            )}
            {hasErrors && (
              <div className="stat-card error">
                <div className="stat-icon">❌</div>
                <div className="stat-content">
                  <div className="stat-value">{preview.validation.errors.length}</div>
                  <div className="stat-label">Errori</div>
                </div>
              </div>
            )}
          </div>

          {/* Organizzazioni */}
          <div className="preview-section">
            <h3>Organizzazioni ({preview.organizations.length})</h3>
            <div className="organizations-list">
              {preview.organizations.map((org, idx) => (
                <span key={idx} className="org-tag">{org}</span>
              ))}
            </div>
          </div>

          {/* Errori */}
          {hasErrors && (
            <div className="preview-section validation-section error">
              <h3>⚠️ Errori di Validazione ({preview.validation.errors.length})</h3>
              <ul className="validation-list">
                {preview.validation.errors.map((error, idx) => (
                  <li key={idx}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Warning */}
          {hasWarnings && (
            <div className="preview-section validation-section warning">
              <h3>⚠️ Warning ({preview.validation.warnings.length})</h3>
              <ul className="validation-list">
                {preview.validation.warnings.map((warning, idx) => (
                  <li key={idx}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Duplicati */}
          {hasDuplicates && (
            <div className="preview-section validation-section warning">
              <h3>🔄 EntityID Duplicati ({preview.validation.duplicates.length})</h3>
              <ul className="validation-list">
                {preview.validation.duplicates.map((dup, idx) => (
                  <li key={idx}>
                    <strong>{dup.entityID}</strong>
                    <div style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 4 }}>
                      File: {dup.files.join(', ')}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button 
            className="btn btn-secondary" 
            onClick={onCancel}
            disabled={loading}
          >
            Annulla
          </button>
          <button 
            className="btn btn-success" 
            onClick={onConfirm}
            disabled={loading || hasErrors}
          >
            {loading ? 'Creazione in corso...' : 'Conferma e Crea PR'}
          </button>
        </div>
      </div>
    </div>
  );
}
