import React, { useState } from 'react';
import '../styles/Modal.css';

/**
 * Modal per anteprima e configurazione PR
 */
function PRPreviewModal({ files, organizations, onConfirm, onCancel }) {
  const [options, setOptions] = useState({
    draft: false,
    prTitle: `SPID: Aggiunta ${files.length} enti - ${new Date().toLocaleDateString('it-IT')}`,
    notes: '',
    reviewers: '',
    labels: 'spid,metadata',
    validateBeforePR: true
  });

  const handleConfirm = () => {
    const processedOptions = {
      ...options,
      reviewers: options.reviewers.split(',').map(r => r.trim()).filter(Boolean),
      labels: options.labels.split(',').map(l => l.trim()).filter(Boolean)
    };
    onConfirm(processedOptions);
  };

  const totalSize = files.reduce((sum, f) => sum + (f.content?.length || 0), 0);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📋 Anteprima Pull Request</h2>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="preview-section">
            <h3>Riepilogo</h3>
            <div className="preview-stats">
              <div className="stat">
                <span className="stat-label">File da inviare:</span>
                <span className="stat-value">{files.length}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Organizzazioni:</span>
                <span className="stat-value">{organizations.length}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Dimensione totale:</span>
                <span className="stat-value">{(totalSize / 1024).toFixed(2)} KB</span>
              </div>
            </div>
          </div>

          <div className="preview-section">
            <h3>File inclusi</h3>
            <div className="file-list">
              {files.slice(0, 10).map((file, idx) => (
                <div key={idx} className="file-item">
                  <span className="file-icon">📄</span>
                  <span className="file-name">{file.filename}</span>
                </div>
              ))}
              {files.length > 10 && (
                <div className="file-item more">... e altri {files.length - 10} file</div>
              )}
            </div>
          </div>

          <div className="preview-section">
            <h3>Organizzazioni</h3>
            <div className="org-tags">
              {organizations.map((org, idx) => (
                <span key={idx} className="org-tag">{org}</span>
              ))}
            </div>
          </div>

          <div className="preview-section">
            <h3>Opzioni Pull Request</h3>
            
            <div className="form-group">
              <label>Titolo PR</label>
              <input
                type="text"
                value={options.prTitle}
                onChange={e => setOptions({...options, prTitle: e.target.value})}
                className="form-control"
              />
            </div>

            <div className="form-group">
              <label>Note aggiuntive (opzionale)</label>
              <textarea
                value={options.notes}
                onChange={e => setOptions({...options, notes: e.target.value})}
                placeholder="Aggiungi note o contesto per i reviewer..."
                rows={3}
                className="form-control"
              />
            </div>

            <div className="form-group">
              <label>Labels (separati da virgola)</label>
              <input
                type="text"
                value={options.labels}
                onChange={e => setOptions({...options, labels: e.target.value})}
                placeholder="spid,metadata"
                className="form-control"
              />
            </div>

            <div className="form-group">
              <label>Reviewers GitHub (usernames separati da virgola)</label>
              <input
                type="text"
                value={options.reviewers}
                onChange={e => setOptions({...options, reviewers: e.target.value})}
                placeholder="username1,username2"
                className="form-control"
              />
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={options.draft}
                  onChange={e => setOptions({...options, draft: e.target.checked})}
                />
                <span>Crea come Draft PR (richiede review prima del merge)</span>
              </label>
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={options.validateBeforePR}
                  onChange={e => setOptions({...options, validateBeforePR: e.target.checked})}
                />
                <span>Valida file prima della creazione (consigliato)</span>
              </label>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>
            Annulla
          </button>
          <button className="btn btn-primary" onClick={handleConfirm}>
            ✅ Conferma e Crea PR
          </button>
        </div>
      </div>
    </div>
  );
}

export default PRPreviewModal;
