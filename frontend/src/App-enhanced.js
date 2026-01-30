import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Toast from './components/Toast';
import ProgressBar from './components/ProgressBar';
import PRPreviewModal from './components/PRPreviewModal';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';

/**
 * Hook per gestione toast notifications
 */
function useToast() {
  const [toasts, setToasts] = useState([]);

  const showToast = (message, type = 'info', duration = 5000) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type, duration }]);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return { toasts, showToast, removeToast };
}

/**
 * Helper functions
 */
function getOrganizationDisplayName(org) {
  if (!org || !org['md:OrganizationDisplayName']) return 'Senza Nome';
  const val = org['md:OrganizationDisplayName'];
  if (Array.isArray(val)) return val.map(e => e._ || e).join(' / ');
  return val._ || val;
}

/**
 * Main Page Component
 */
function MainPage() {
  const [files, setFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [search, setSearch] = useState('');
  const [enteTypeFilter, setEnteTypeFilter] = useState('all');
  const [warningsFilter, setWarningsFilter] = useState(false);
  const [registryCache, setRegistryCache] = useState({});
  const [showPRModal, setShowPRModal] = useState(false);
  const [prProgress, setPrProgress] = useState(null);
  const [healthStatus, setHealthStatus] = useState(null);
  
  const { toasts, showToast, removeToast } = useToast();
  const fileInputRef = useRef();

  // Check server health on mount
  useEffect(() => {
    axios.get(`${API_URL}/health`)
      .then(res => {
        setHealthStatus(res.data);
        if (res.data.github?.connected) {
          showToast(`Connesso a GitHub come ${res.data.github.user}`, 'success', 3000);
        } else {
          showToast('Attenzione: GitHub non configurato correttamente', 'warning');
        }
      })
      .catch(() => {
        showToast('Errore: impossibile connettersi al server', 'error');
      });
  }, []);

  // Load files
  useEffect(() => {
    loadFiles();
  }, [search, enteTypeFilter, warningsFilter]);

  const loadFiles = () => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (enteTypeFilter !== 'all') params.append('enteType', enteTypeFilter);
    if (warningsFilter) params.append('hasWarnings', 'true');

    axios.get(`${API_URL}/files?${params.toString()}`)
      .then(res => setFiles(res.data))
      .catch(err => showToast('Errore caricamento file', 'error'));
  };

  // Registry data fetching for selected files
  useEffect(() => {
    const entityIDs = selectedFiles
      .map(f => f.entityID)
      .filter(id => id && !registryCache[id]);

    if (entityIDs.length > 0) {
      axios.post(`${API_URL}/registry/batch`, { entityIDs })
        .then(res => {
          setRegistryCache(prev => ({ ...prev, ...res.data }));
        })
        .catch(err => console.error('Errore registry lookup:', err));
    }
  }, [selectedFiles]);

  /**
   * Handle file upload
   */
  const handleFilesUpload = async (e) => {
    const filesList = Array.from(e.target.files);
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (let i = 0; i < filesList.length; i++) {
      const file = filesList[i];
      
      try {
        const formData = new FormData();
        formData.append('xmlfile', file);
        formData.append('creationDate', new Date(file.lastModified).toISOString());
        
        const res = await axios.post(`${API_URL}/upload`, formData);
        
        if (res.data.success) {
          successCount++;
        }
      } catch (err) {
        errorCount++;
        errors.push({
          filename: file.name,
          error: err.response?.data?.error || 'Errore sconosciuto'
        });
      }
    }

    // Show results
    if (successCount > 0) {
      showToast(`✅ ${successCount} file caricati con successo`, 'success');
      loadFiles();
    }
    
    if (errorCount > 0) {
      showToast(`❌ ${errorCount} file con errori`, 'error');
      errors.forEach(err => {
        console.error(`${err.filename}: ${err.error}`);
      });
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Handle PR creation
   */
  const handleCreatePR = async (options) => {
    setShowPRModal(false);
    
    const steps = [
      'Preparazione file',
      'Validazione XML',
      'Creazione branch',
      'Upload file',
      'Creazione PR'
    ];

    setPrProgress({ steps, currentStep: 0 });

    try {
      const filenames = selectedFiles.map(f => f.filename);
      const organizations = [...new Set(selectedFiles.map(f => 
        getOrganizationDisplayName(f.organization)
      ))];

      // Step 1: Get file contents
      setPrProgress(prev => ({ ...prev, currentStep: 0 }));
      const filesRes = await axios.post(`${API_URL}/get-xml-contents`, { filenames });
      
      if (!filesRes.data || filesRes.data.length === 0) {
        throw new Error('Nessun contenuto XML recuperato');
      }

      // Step 2: Validation (if enabled)
      if (options.validateBeforePR) {
        setPrProgress(prev => ({ ...prev, currentStep: 1 }));
        const validationRes = await axios.post(`${API_URL}/validate-batch`, { filenames });
        
        if (validationRes.data.invalid > 0) {
          showToast(
            `⚠️ Attenzione: ${validationRes.data.invalid} file con errori di validazione`,
            'warning',
            7000
          );
        }
      }

      // Steps 3-5: Create PR
      setPrProgress(prev => ({ ...prev, currentStep: 2 }));
      
      const prRes = await axios.post(`${API_URL}/create-pull-request`, {
        filenames,
        organizations,
        options
      });

      setPrProgress(prev => ({ ...prev, currentStep: 4 }));

      if (prRes.data.success) {
        showToast(
          `🎉 Pull Request #${prRes.data.pr.number} creata con successo!`,
          'success',
          7000
        );
        
        // Open PR in new tab
        window.open(prRes.data.pr.url, '_blank');
        
        // Clear selection
        setSelectedFiles([]);
      } else {
        throw new Error(prRes.data.error || 'Errore nella creazione della PR');
      }

    } catch (err) {
      showToast(
        `Errore: ${err.response?.data?.error || err.message}`,
        'error',
        10000
      );
    } finally {
      setTimeout(() => setPrProgress(null), 2000);
    }
  };

  /**
   * Handle file selection
   */
  const handleSelect = (file) => {
    setSelectedFiles(prev => 
      prev.includes(file) 
        ? prev.filter(f => f !== file)
        : [...prev, file]
    );
  };

  const selectAll = () => setSelectedFiles([...files]);
  const deselectAll = () => setSelectedFiles([]);

  /**
   * Handle file deletion
   */
  const handleDeleteSelected = async () => {
    if (!window.confirm(`Eliminare ${selectedFiles.length} file?`)) return;

    try {
      const filenames = selectedFiles.map(f => f.filename);
      await axios.post(`${API_URL}/delete-xml-files`, { filenames });
      
      showToast(`🗑️ ${filenames.length} file eliminati`, 'success');
      setSelectedFiles([]);
      loadFiles();
    } catch (err) {
      showToast('Errore durante eliminazione', 'error');
    }
  };

  /**
   * Prepare data for PR
   */
  const preparePRData = () => {
    const organizations = [...new Set(selectedFiles.map(f => 
      getOrganizationDisplayName(f.organization)
    ))];

    return {
      files: selectedFiles,
      organizations
    };
  };

  return (
    <div className="app-container">
      {/* Toast Notifications */}
      <div className="toast-container">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>

      {/* PR Progress */}
      {prProgress && (
        <div className="progress-overlay">
          <div className="progress-card">
            <h3>🚀 Creazione Pull Request</h3>
            <ProgressBar 
              steps={prProgress.steps} 
              currentStep={prProgress.currentStep} 
            />
          </div>
        </div>
      )}

      {/* PR Preview Modal */}
      {showPRModal && (
        <PRPreviewModal
          {...preparePRData()}
          onConfirm={handleCreatePR}
          onCancel={() => setShowPRModal(false)}
        />
      )}

      {/* Header */}
      <header className="app-header">
        <div className="header-content">
          <h1>📋 SPID Metadata App v2.0</h1>
          {healthStatus?.github?.connected && (
            <div className="github-status">
              <span className="status-indicator status-connected"></span>
              <span>GitHub: {healthStatus.github.user}</span>
            </div>
          )}
        </div>
        <Link to="/history" className="btn btn-link">
          🗂️ Storico PR
        </Link>
      </header>

      <div className="main-content">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="upload-section">
            <h3>📤 Carica File</h3>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml"
              multiple
              onChange={handleFilesUpload}
              style={{ display: 'none' }}
            />
            <button 
              className="btn btn-primary btn-block"
              onClick={() => fileInputRef.current?.click()}
            >
              Scegli File XML
            </button>
          </div>

          <div className="filters-section">
            <h3>🔍 Filtri</h3>
            
            <div className="filter-group">
              <label>Ricerca</label>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Nome file, ente, entityID..."
                className="form-control"
              />
            </div>

            <div className="filter-group">
              <label>Tipo Ente</label>
              <select 
                value={enteTypeFilter}
                onChange={e => setEnteTypeFilter(e.target.value)}
                className="form-control"
              >
                <option value="all">Tutti</option>
                <option value="Pubblico">Pubblico</option>
                <option value="Privato">Privato</option>
              </select>
            </div>

            <div className="filter-group">
              <label>
                <input
                  type="checkbox"
                  checked={warningsFilter}
                  onChange={e => setWarningsFilter(e.target.checked)}
                />
                <span>Solo file con warning</span>
              </label>
            </div>
          </div>

          <div className="actions-section">
            <h3>⚙️ Azioni</h3>
            
            <button 
              className="btn btn-secondary btn-block"
              onClick={selectAll}
              disabled={files.length === 0}
            >
              Seleziona tutti ({files.length})
            </button>
            
            <button 
              className="btn btn-secondary btn-block"
              onClick={deselectAll}
              disabled={selectedFiles.length === 0}
            >
              Deseleziona tutti
            </button>

            <button 
              className="btn btn-success btn-block"
              onClick={() => setShowPRModal(true)}
              disabled={selectedFiles.length === 0}
            >
              ✅ Crea PR ({selectedFiles.length})
            </button>

            <button 
              className="btn btn-danger btn-block"
              onClick={handleDeleteSelected}
              disabled={selectedFiles.length === 0}
            >
              🗑️ Elimina selezionati
            </button>
          </div>

          <div className="stats-section">
            <h3>📊 Statistiche</h3>
            <div className="stat-item">
              <span className="stat-label">File totali:</span>
              <span className="stat-value">{files.length}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Selezionati:</span>
              <span className="stat-value">{selectedFiles.length}</span>
            </div>
          </div>
        </aside>

        {/* File List */}
        <main className="file-list-container">
          {files.length === 0 ? (
            <div className="empty-state">
              <p>📂 Nessun file caricato</p>
              <p className="text-muted">Carica file XML per iniziare</p>
            </div>
          ) : (
            <div className="file-list">
              {files.map((file, idx) => {
                const isSelected = selectedFiles.includes(file);
                const hasWarnings = file.validation?.warnings?.length > 0;
                const registryData = registryCache[file.entityID];

                return (
                  <div 
                    key={idx} 
                    className={`file-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelect(file)}
                  >
                    <div className="file-card-header">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelect(file)}
                        onClick={e => e.stopPropagation()}
                      />
                      <span className="file-name">📄 {file.filename}</span>
                      {hasWarnings && (
                        <span className="badge badge-warning" title={file.validation.warnings.join(', ')}>
                          ⚠️ {file.validation.warnings.length}
                        </span>
                      )}
                    </div>

                    <div className="file-card-body">
                      <div className="file-info">
                        <span className="info-label">Organizzazione:</span>
                        <span className="info-value">
                          {getOrganizationDisplayName(file.organization)}
                        </span>
                      </div>

                      <div className="file-info">
                        <span className="info-label">Tipo:</span>
                        <span className={`badge badge-${file.enteType === 'Pubblico' ? 'primary' : 'secondary'}`}>
                          {file.enteType || 'N/A'}
                        </span>
                      </div>

                      <div className="file-info">
                        <span className="info-label">Entity ID:</span>
                        <span className="info-value small">{file.entityID}</span>
                      </div>

                      {registryData && (
                        <div className="file-info">
                          <span className="info-label">Registry:</span>
                          <span className={`badge ${registryData.found ? 'badge-success' : 'badge-danger'}`}>
                            {registryData.found ? '✓ Trovato' : '✗ Non trovato'}
                          </span>
                        </div>
                      )}

                      <div className="file-info">
                        <span className="info-label">Caricato:</span>
                        <span className="info-value small">
                          {new Date(file.uploadedAt).toLocaleString('it-IT')}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * PR History Page
 */
function PRHistoryPage() {
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { toasts, showToast, removeToast } = useToast();

  useEffect(() => {
    loadHistory();
    loadStats();
  }, []);

  const loadHistory = () => {
    axios.get(`${API_URL}/pr-history`)
      .then(res => {
        setHistory(res.data.items || []);
        setLoading(false);
      })
      .catch(err => {
        showToast('Errore caricamento storico', 'error');
        setLoading(false);
      });
  };

  const loadStats = () => {
    // Placeholder - implementa endpoint statistiche se necessario
  };

  const updatePRStatus = async (prNumber) => {
    try {
      await axios.post(`${API_URL}/pr-history/${prNumber}/update-status`);
      showToast('Status aggiornato', 'success', 3000);
      loadHistory();
    } catch (err) {
      showToast('Errore aggiornamento status', 'error');
    }
  };

  if (loading) {
    return <div className="loading">Caricamento...</div>;
  }

  return (
    <div className="history-page">
      {/* Toast Notifications */}
      <div className="toast-container">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>

      <header className="page-header">
        <h1>🗂️ Storico Pull Request</h1>
        <Link to="/" className="btn btn-secondary">← Torna all'app</Link>
      </header>

      <div className="history-content">
        {history.length === 0 ? (
          <div className="empty-state">
            <p>Nessuna PR nello storico</p>
          </div>
        ) : (
          <div className="pr-list">
            {history.map((pr, idx) => (
              <div key={idx} className="pr-card">
                <div className="pr-header">
                  <div>
                    <h3>
                      <a href={pr.prUrl} target="_blank" rel="noopener noreferrer">
                        PR #{pr.prNumber}
                      </a>
                    </h3>
                    <span className="pr-date">
                      {new Date(pr.createdAt).toLocaleString('it-IT')}
                    </span>
                  </div>
                  <div className="pr-status">
                    <span className={`badge badge-${pr.status === 'open' ? 'success' : 'secondary'}`}>
                      {pr.status}
                    </span>
                    <button 
                      className="btn btn-sm"
                      onClick={() => updatePRStatus(pr.prNumber)}
                      title="Aggiorna status"
                    >
                      🔄
                    </button>
                  </div>
                </div>

                <div className="pr-body">
                  <div className="pr-info">
                    <span>📁 {pr.filesCount} file</span>
                    <span>🏢 {pr.organizations?.length || 0} organizzazioni</span>
                    <span>🌿 {pr.branch}</span>
                  </div>

                  {pr.organizations && pr.organizations.length > 0 && (
                    <div className="pr-organizations">
                      {pr.organizations.map((org, i) => (
                        <span key={i} className="org-tag">{org}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * App Router
 */
export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/history" element={<PRHistoryPage />} />
      </Routes>
    </Router>
  );
}
