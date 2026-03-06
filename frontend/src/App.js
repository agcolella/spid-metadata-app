import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import { notify } from './services/notificationService';
import { PRPreviewModal } from './components/PRPreviewModal';
import { ProgressTracker } from './components/ProgressTracker';
import { ValidationBadge } from './components/ValidationBadge';
import './App.css';

const API_BASE = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  ? '/api'
  : 'http://localhost:4000';
const LS_KEY = "spid-pr-history";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/history" element={<PRHistoryPage />} />
      </Routes>
    </Router>
  );
}

// ============================================
// MAIN PAGE - Homepage con sidebar collassabile
// ============================================
function MainPage() {
  // Stati principali
  const [files, setFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "creationDate", direction: "desc" });
  const [uploadProgress, setUploadProgress] = useState({ loaded: 0, total: 0, active: false });
  const [uploadErrors, setUploadErrors] = useState([]);
  const [registryCache, setRegistryCache] = useState({});
  const [resultsPerPage, setResultsPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [pullRequests, setPullRequests] = useState([]);
  const [prPreview, setPrPreview] = useState(null);
  const [prInProgress, setPrInProgress] = useState(false);
  const [prStep, setPrStep] = useState(0);
  const [githubValid, setGithubValid] = useState(null);
  const [expandedRows, setExpandedRows] = useState([]);
  const [showOnlyWithErrors, setShowOnlyWithErrors] = useState(false);
  const [errorFilterMode, setErrorFilterMode] = useState('all'); 
// 'all' | 'onlyErrors' | 'noErrors'


  
  // Stati sidebar collassabile
  const [sectionsCollapsed, setSectionsCollapsed] = useState({
    upload: false,
    files: false
  });

  const fileInputRef = useRef();
  const dirInputRef = useRef();

  const prSteps = [
    'Validazione',
    'Creazione Branch',
    'Upload File',
    'Creazione Commit',
    'Apertura PR'
  ];

  // Caricamento iniziale
  useEffect(() => {
    loadFiles();
    validateGitHub();
    

	
    // Carica storico PR
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try { 
        setPullRequests(JSON.parse(raw)); 
      } catch { 
        setPullRequests([]); 
      }
    }
  }, []);

  // Toggle sezione collassabile
  const toggleSection = (section) => {
    setSectionsCollapsed(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Carica file dal backend
  const loadFiles = async () => {
    try {
      const res = await axios.get(`${API_BASE}/files`);
      console.log('API /files response:', res.data);
	  setFiles(res.data);
    } catch (error) {
      notify.error('Errore nel caricamento dei file');
      console.error(error);
    }
  };
  
  //console log
// useEffect(() => {
//  console.log('FILES state UPDATED:', files);         // qui vedi lo state aggiornato
//}, [files]); 

  // Valida accesso GitHub
const validateGitHub = async () => {
  try {
    const res = await axios.get(`${API_BASE}/validate-github`);
    setGithubValid(res.data.valid);
    if (!res.data.valid) {
      notify.error('GitHub non configurato correttamente');
    }
  } catch (error) {
    setGithubValid(false);
    notify.error('Impossibile validare accesso GitHub');
  }
};

const handleUpload = async (e) => {
  const allFiles = Array.from(e.target.files);
  if (allFiles.length === 0) return;

  // Filtra solo file XML per estensione / MIME type
  const xmlFiles = allFiles.filter(f =>
    f.name.toLowerCase().endsWith('.xml') ||
    f.type === 'text/xml' ||
    f.type === 'application/xml'
  );

  const discarded = allFiles.length - xmlFiles.length;

  if (xmlFiles.length === 0) {
    if (discarded > 0) {
      notify.warning('Sono stati selezionati solo file non XML, nessun file caricato.');
    }
    e.target.value = null;
    return;
  }

  if (discarded > 0) {
    notify.warning(`${discarded} file non XML sono stati ignorati.`);
  }

  setUploadProgress({ loaded: 0, total: xmlFiles.length, active: true });
  setUploadErrors([]);

  const errors = [];
  for (let i = 0; i < xmlFiles.length; i++) {
    const file = xmlFiles[i];
    const formData = new FormData();
    formData.append('xmlFile', file);

    try {
      await axios.post(`${API_BASE}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setUploadProgress(prev => ({ ...prev, loaded: i + 1 }));
    } catch (error) {
      const msg = error.response?.data?.error || error.message;
      errors.push({ filename: file.name, error: msg });
    }
  }

  setUploadProgress({ loaded: 0, total: 0, active: false });
  
  if (errors.length > 0) {
    setUploadErrors(errors);
    notify.error(`${errors.length} file XML con errori`);
  } else {
    notify.success(`${xmlFiles.length} file XML caricati con successo!`);
  }

  // Ricarica elenco file per sidebar e tabella
  await loadFiles();
  e.target.value = null;
};




  // Selezione file
  const toggleFileSelection = (filename) => {
    setSelectedFiles(prev =>
      prev.includes(filename)
        ? prev.filter(f => f !== filename)
        : [...prev, filename]
    );
  };

  const selectAll = () => {
    const allFilenames = sidebarFiles.map(f => f.filename);
    setSelectedFiles(allFilenames);
  };

	const toggleErrorFilter = () => {
	  if (errorFilterMode === 'onlyErrors') {
		// passa a "senza errori"
		setErrorFilterMode('noErrors');
	  } else {
		// qualsiasi altro stato → mostra solo con errori
		const withErrors = files.filter(
		  f => f.validation && Array.isArray(f.validation.errors) && f.validation.errors.length > 0
		);

		if (withErrors.length === 0) {
		  notify.warning('Nessun file con errori di validazione tra i file caricati.');
		}

		setErrorFilterMode('onlyErrors');
	  }

	  // azzera selezione per evitare confusioni
	  setSelectedFiles([]);
	};


  const deselectAll = () => {
    setSelectedFiles([]);
  };

  // Elimina file selezionati
  const deleteSelected = async () => {
    if (!window.confirm(`Eliminare ${selectedFiles.length} file?`)) return;

    try {
      await axios.post(`${API_BASE}/delete-xml-files`, { filenames: selectedFiles });
      notify.success(`${selectedFiles.length} file eliminati`);
      setSelectedFiles([]);
      await loadFiles();
    } catch (error) {
      notify.error('Errore eliminazione file');
      console.error(error);
    }
  };

  // Anteprima Pull Request
  const openPRPreview = async () => {
    if (selectedFiles.length === 0) {
      notify.warning('Seleziona almeno un file');
      return;
    }

    try {
      const res = await axios.post(`${API_BASE}/preview-pull-request`, {
        files: selectedFiles
      });
      setPrPreview(res.data);
    } catch (error) {
      notify.error('Errore anteprima PR: ' + (error.response?.data?.error || error.message));
    }
  };

  // Crea Pull Request
  const confirmCreatePR = async () => {
    setPrInProgress(true);
    setPrStep(0);

    try {
      const res = await axios.post(`${API_BASE}/create-pull-request`, {
        files: selectedFiles,
        organizations: prPreview.organizations,
        draft: false
      });

      if (res.data.success) {
        notify.success(`PR creata con successo!`);
        
        const newPR = {
          id: Date.now(),
          number: res.data.number,
          url: res.data.url,
          branch: res.data.branch,
          organizations: prPreview.organizations,
          fileCount: selectedFiles.length,
          createdAt: new Date().toISOString(),
          status: 'open'
        };

        const updated = [newPR, ...pullRequests];
        setPullRequests(updated);
        localStorage.setItem(LS_KEY, JSON.stringify(updated));

        setSelectedFiles([]);
        setPrPreview(null);
        await loadFiles();
      }
    } catch (error) {
      notify.error('Errore creazione PR: ' + (error.response?.data?.error || error.message));
    } finally {
      setPrInProgress(false);
      setPrStep(0);
    }
  };

// Carica dati da Registry SPID per un singolo entityID
	const loadRegistryData = async (entityID) => {
	  if (registryCache[entityID]) return registryCache[entityID];

	  try {
		const encoded = encodeURIComponent(entityID);
		const res = await axios.get(
		  `https://registry.spid.gov.it/entities/${encoded}?output=json`
		);
		// La risposta JSON contiene create_date e lastupdate_date
		const data = {
		  exists: true,
		  createDate: res.data.create_date || null,
		  lastUpdateDate: res.data.lastupdate_date || null,
		  raw: res.data
		};
		setRegistryCache(prev => ({ ...prev, [entityID]: data }));
		return data;
	  } catch (error) {
		if (error.response && error.response.status === 404) {
		  const data = { exists: false };
		  setRegistryCache(prev => ({ ...prev, [entityID]: data }));
		  return data;
		}
		console.error('Errore caricamento Registry:', error);
		const data = { exists: false, error: true };
		setRegistryCache(prev => ({ ...prev, [entityID]: data }));
		return data;
	  }
	};


  // Toggle espansione riga tabella
  const toggleRowExpansion = async (filename) => {
    if (expandedRows.includes(filename)) {
      setExpandedRows(prev => prev.filter(f => f !== filename));
    } else {
      const file = files.find(f => f.filename === filename);
      if (file?.entityID && !registryCache[file.entityID]) {
        await loadRegistryData(file.entityID);
      }
      setExpandedRows(prev => [...prev, filename]);
    }
  };

  // Ordinamento
  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

// Filtraggio e ordinamento

// 1) Base: solo i file selezionati (se nessuno selezionato, lista vuota)
const selectedFileObjects = files.filter(f => selectedFiles.includes(f.filename));

// 2) Applica ricerca solo sui selezionati
const filteredFiles = selectedFileObjects.filter(f =>
  f.filename.toLowerCase().includes(search.toLowerCase()) ||
  f.entityID?.toLowerCase().includes(search.toLowerCase()) ||
  f.organizationName?.toLowerCase().includes(search.toLowerCase())
);

// 3) Ordina come prima
const sortedFiles = [...filteredFiles].sort((a, b) => {
  const key = sortConfig.key;
  const dir = sortConfig.direction === 'asc' ? 1 : -1;
  
  if (key === 'creationDate') {
    return (new Date(a[key]) - new Date(b[key])) * dir;
  }
  
  const aVal = a[key] || '';
  const bVal = b[key] || '';
  return aVal.localeCompare(bVal) * dir;
});

// 4) Paginazione
const totalPages = Math.ceil(sortedFiles.length / resultsPerPage);
const startIdx = (page - 1) * resultsPerPage;
const paginatedFiles = sortedFiles.slice(startIdx, startIdx + resultsPerPage);

//  const sortedFiles = [...filteredFiles].sort((a, b) => {
//    const key = sortConfig.key;
//    const dir = sortConfig.direction === 'asc' ? 1 : -1;
    
//    if (key === 'creationDate') {
//      return (new Date(a[key]) - new Date(b[key])) * dir;
//    }
//    
//    const aVal = a[key] || '';
//    const bVal = b[key] || '';
//    return aVal.localeCompare(bVal) * dir;
//  });

  // Paginazione
//  const totalPages = Math.ceil(sortedFiles.length / resultsPerPage);
//  const startIdx = (page - 1) * resultsPerPage;
//  const paginatedFiles = sortedFiles.slice(startIdx, startIdx + resultsPerPage);

const sidebarFiles = files.filter(f => {
  const hasErrors = f.validation && Array.isArray(f.validation.errors) && f.validation.errors.length > 0;
  if (errorFilterMode === 'onlyErrors') return hasErrors;
  if (errorFilterMode === 'noErrors') return !hasErrors;
  return true; // 'all'
});


  return (
    <div className="page-container">
      <div className="main-layout">
        {/* ============================== */}
        {/* SIDEBAR COLLASSABILE */}
        {/* ============================== */}
        <div className="sidebar">
          <div className="sidebar-header">
            <h2>📁 Gestione File</h2>
            {githubValid === false && (
              <div className="alert alert-error" style={{ fontSize: '0.85rem', padding: '8px 12px', marginTop: 8 }}>
                ⚠️ GitHub non configurato
              </div>
            )}
          </div>

          {/* SEZIONE 1: Upload */}
          <div className="sidebar-section">
            <div 
              className={`section-header ${sectionsCollapsed.upload ? 'collapsed' : ''}`}
              onClick={() => toggleSection('upload')}
            >
              <h3 className="section-title">
                <span className="section-icon">📤</span>
                Upload File
                {uploadProgress.active && (
                  <span className="section-badge warning">
                    {uploadProgress.loaded}/{uploadProgress.total}
                  </span>
                )}
              </h3>
              <span className={`toggle-icon ${sectionsCollapsed.upload ? 'collapsed' : ''}`}>
                ▼
              </span>
            </div>

            <div className={`section-content ${!sectionsCollapsed.upload ? 'expanded' : ''}`}>
              <div className="upload-section">
                <input
                  type="file"
                  ref={fileInputRef}
                  multiple
                  accept=".xml"
                  style={{ display: 'none' }}
                  onChange={handleUpload}
                />
                <input
                  type="file"
                  ref={dirInputRef}
                  multiple
                  webkitdirectory="true"
                  directory="true"
                  style={{ display: 'none' }}
                  onChange={handleUpload}
                />

                <div className="button-group-vertical">
                  <button
                    className="btn btn-primary btn-block"
                    onClick={() => fileInputRef.current.click()}
                    disabled={uploadProgress.active}
                  >
                    📁 Scegli File
                  </button>
                  <button
                    className="btn btn-secondary btn-block"
                    onClick={() => dirInputRef.current.click()}
                    disabled={uploadProgress.active}
                  >
                    📂 Scegli Cartella
                  </button>
                </div>

                {uploadProgress.active && (
                  <div className="upload-progress">
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${(uploadProgress.loaded / uploadProgress.total) * 100}%` }}
                      />
                    </div>
                    <span className="progress-text">
                      Caricamento: {uploadProgress.loaded} / {uploadProgress.total}
                    </span>
                  </div>
                )}

                {uploadErrors.length > 0 && (
                  <div className="upload-errors">
                    <strong>Errori ({uploadErrors.length}):</strong>
                    {uploadErrors.map((err, i) => (
                      <div key={i} className="error-item">
                        <strong>{err.filename}:</strong> {err.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* SEZIONE 2: File Caricati */}
          <div className={`sidebar-section ${!sectionsCollapsed.files ? 'expanded' : ''}`}>
            <div 
              className={`section-header ${sectionsCollapsed.files ? 'collapsed' : ''}`}
              onClick={() => toggleSection('files')}
            >
              <h3 className="section-title">
                <span className="section-icon">📋</span>
                File Caricati
                <span className="section-badge">{files.length}</span>
                {selectedFiles.length > 0 && (
                  <span className="section-badge success">{selectedFiles.length} sel.</span>
                )}
              </h3>
              <span className={`toggle-icon ${sectionsCollapsed.files ? 'collapsed' : ''}`}>
                ▼
              </span>
            </div>




			<div className="file-list">
			  {sidebarFiles.length === 0 ? (
				<div className="empty-state-compact">
				  <div className="empty-icon">📭</div>
				  <p>{search ? 'Nessun risultato' : 'Nessun file caricato'}</p>
				</div>
			  ) : (
				sidebarFiles.map((file) => (
				  <div
					key={file.filename}
					className={`file-item ${selectedFiles.includes(file.filename) ? 'selected' : ''}`}
					onClick={() => toggleFileSelection(file.filename)}
				  >
					<input
					  type="checkbox"
					  checked={selectedFiles.includes(file.filename)}
					  onChange={(e) => {
						e.stopPropagation();
						toggleFileSelection(file.filename);
					  }}
					/>
					<div className="file-info">
					  <div className="file-name">{file.filename}</div>
					  <div className="file-meta">
						<span className="file-date">
						  {new Date(file.creationDate).toLocaleDateString('it-IT')}
						</span>
						{file.organizationName && (
						  <span className="file-org">{file.organizationName}</span>
						)}
						{file.validation && <ValidationBadge validation={file.validation} />}
					  </div>
					</div>
				  </div>
				))
			  )}
			</div>
			
			

            {!sectionsCollapsed.files && files.length > 0 && (
              <div className="section-footer">
                <div className="button-group" style={{ marginBottom: 8 }}>
                  <button className="btn btn-sm btn-secondary" onClick={selectAll}>
                    ✓ Tutti
                  </button>
				    <button className="btn btn-sm btn-secondary" onClick={toggleErrorFilter}>
                    {errorFilterMode === 'onlyErrors' ? 'Senza Errori' : 'Solo con Errori'}
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={deselectAll}>
                    ✗ Nessuno
                  </button>
                  {selectedFiles.length > 0 && (
                    <button className="btn btn-sm btn-danger" onClick={deleteSelected}>
                      🗑️ Elimina ({selectedFiles.length})
                    </button>
                  )}
                </div>
                
                {selectedFiles.length > 0 && (
                  <button
                    className="btn btn-success btn-block"
                    onClick={openPRPreview}
                    disabled={!githubValid}
                  >
                    🚀 Crea Pull Request ({selectedFiles.length})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ============================== */}
        {/* MAIN CONTENT - Tabella */}
        {/* ============================== */}
        <div className="main-content">
          <div className="content-header">
            <h3>Dettagli File ({sortedFiles.length})</h3>
            <Link to="/history" className="btn btn-secondary">
              📜 Storico PR
            </Link>
          </div>

          {sortedFiles.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📂</div>
              <h3>Nessun file disponibile</h3>
              <p>Carica dei file XML per iniziare</p>
            </div>
          ) : (
            <>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}></th>
                      <th className="sortable" onClick={() => handleSort('filename')}>
                        Nome File {sortConfig.key === 'filename' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="sortable" onClick={() => handleSort('organizationName')}>
                        Organizzazione {sortConfig.key === 'organizationName' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th>Entity ID</th>
                      <th className="sortable" onClick={() => handleSort('creationDate')}>
                        Data {sortConfig.key === 'creationDate' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th>Validazione</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedFiles.map((file) => (
                      <React.Fragment key={file.filename}>
                        <tr 
                          className={expandedRows.includes(file.filename) ? 'expanded' : ''}
                          onClick={() => toggleRowExpansion(file.filename)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td style={{ textAlign: 'center' }}>
                            <span className="expand-icon">
                              {expandedRows.includes(file.filename) ? '−' : '+'}
                            </span>
                          </td>
                          <td>{file.filename}</td>
                          <td>{file.organizationName || 'N/A'}</td>
                          <td>
                            <span className="entity-id">
                              {file.entityID ? file.entityID.substring(0, 40) + '...' : 'N/A'}
                            </span>
                          </td>
                          <td>
                              {file.creationDate 
                               ? new Date(file.creationDate).toLocaleDateString('it-IT', {
                                  day: '2-digit',
                                   month: '2-digit', 
                                    year: 'numeric'
                                 })
                               : 'N/A'
                              }
                          </td>
                          <td>
                            {file.validation && <ValidationBadge validation={file.validation} />}
                          </td>
                        </tr>


{expandedRows.includes(file.filename) && (
  <tr className="details-row">
    <td colSpan="7">
      <div className="details-content">
        <h4>Dettaglio file</h4>

        {/* Flag presenza nel registro SPID */}
        {file.entityID && registryCache[file.entityID]?.exists && (
          <div
            style={{
              marginBottom: 12,
              padding: 8,
              borderRadius: 6,
              background: '#ecfdf3',
              borderLeft: '4px solid #16a34a',
              color: '#166534',
              fontSize: '0.85rem'
            }}
          >
            ✅ EntityID presente nel registro SPID
          </div>
        )}

        {(() => {
          const registryInfo = file.entityID
            ? registryCache[file.entityID]
            : null;
          const useRegistryDates = registryInfo?.exists;

          const creationDate = useRegistryDates && registryInfo.createDate
            ? new Date(registryInfo.createDate)
            : new Date(file.creationDate);

          const modificationDate = useRegistryDates && registryInfo.lastUpdateDate
            ? new Date(registryInfo.lastUpdateDate)
            : new Date(file.modificationDate);

          return (
            <table className="nested-table">
              <tbody>
                <tr>
                  <th>Nome file</th>
                  <td>{file.filename}</td>
                </tr>
                <tr>
                  <th>EntityID</th>
                  <td>{file.entityID || <span className="na-cell">N/D</span>}</td>
                </tr>
                <tr>
                  <th>Organizzazione</th>
                  <td>{file.organizationName || <span className="na-cell">N/D</span>}</td>
                </tr>
                <tr>
                  <th>Data creazione</th>
                  <td>{creationDate.toLocaleString('it-IT')}</td>
                </tr>
                <tr>
                  <th>Data modifica</th>
                  <td>{modificationDate.toLocaleString('it-IT')}</td>
                </tr>
                <tr>
                  <th>Dimensione</th>
                  <td>{(file.size / 1024).toFixed(1)} KB</td>
                </tr>
              </tbody>
            </table>
          );
        })()}
		
        {/* Errori di validazione */}
        {file.validation && file.validation.errors && file.validation.errors.length > 0 && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 8,
              borderLeft: '4px solid #dc2626',
              background: '#fef2f2'
            }}
          >
            <strong style={{ color: '#991b1b', display: 'block', marginBottom: 8 }}>
              Errori di validazione ({file.validation.errors.length})
            </strong>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {file.validation.errors.map((err, idx) => (
                <li key={idx} style={{ fontSize: '0.9rem', color: '#991b1b', marginBottom: 4 }}>
                  {err}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Warning di validazione */}
        {file.validation && file.validation.warnings && file.validation.warnings.length > 0 && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              borderLeft: '4px solid #d97706',
              background: '#fffbeb'
            }}
          >
            <strong style={{ color: '#92400e', display: 'block', marginBottom: 8 }}>
              Avvisi di validazione ({file.validation.warnings.length})
            </strong>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {file.validation.warnings.map((w, idx) => (
                <li key={idx} style={{ fontSize: '0.9rem', color: '#92400e', marginBottom: 4 }}>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Nessun errore / warning */}
        {file.validation &&
          (!file.validation.errors || file.validation.errors.length === 0) &&
          (!file.validation.warnings || file.validation.warnings.length === 0) && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 8,
                borderLeft: '4px solid #16a34a',
                background: '#ecfdf3',
                color: '#166534',
                fontSize: '0.9rem'
              }}
            >
              Nessun errore o warning di validazione per questo file.
            </div>
          )}
      </div>
    </td>
  </tr>
)}

                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginazione */}
              {totalPages > 1 && (
                <div className="pagination">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    ← Precedente
                  </button>
                  <span className="page-info">
                    Pagina {page} di {totalPages}
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Successiva →
                  </button>
                  <div className="pagination-controls">
                    <label>
                      Risultati per pagina:
                      <select
                        value={resultsPerPage}
                        onChange={(e) => {
                          setResultsPerPage(Number(e.target.value));
                          setPage(1);
                        }}
                      >
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </label>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modali */}
      {prPreview && (
        <PRPreviewModal
          preview={prPreview}
          onConfirm={confirmCreatePR}
          onCancel={() => setPrPreview(null)}
          loading={prInProgress}
        />
      )}

      {prInProgress && (
        <div className="progress-overlay">
          <ProgressTracker steps={prSteps} currentStep={prStep} />
        </div>
      )}
    </div>
  );
}

// ============================================
// PR HISTORY PAGE
// ============================================
function PRHistoryPage() {
  const [pullRequests, setPullRequests] = useState([]);
  const [expandedPRs, setExpandedPRs]   = useState([]);
  const [syncing, setSyncing]           = useState(false);
  const [filters, setFilters] = useState({
    search: '',
    dateFrom: '',
    dateTo: ''
  });

  // ref sempre aggiornato: evita stale-closure in interval e callback async
  const prRef = React.useRef([]);
  useEffect(() => { prRef.current = pullRequests; }, [pullRequests]);

  // ------------------------------------------------------------------
  // syncStatuses
  //   - accetta opzionalmente una lista (usata all'avvio prima che lo
  //     state React sia effettivamente aggiornato)
  //   - in tutti gli altri casi legge da prRef.current
  // ------------------------------------------------------------------
  const syncStatuses = React.useCallback(async (source) => {
    const list = source ?? prRef.current;
    if (!list || list.length === 0) return;

    setSyncing(true);
    try {
      const updated = list.map(pr => ({ ...pr })); // shallow copy
      let changed = false;

      for (let i = 0; i < updated.length; i++) {
        const pr = updated[i];
        if (!pr.number) continue;

        try {
          const res = await fetch(`${API_BASE}/pr-status/${pr.number}`);
          if (!res.ok) {
            console.warn(`pr-status/${pr.number} → HTTP ${res.status}`);
            continue;
          }
          const data = await res.json();
          console.log(`PR #${pr.number}: locale="${pr.status}" → remoto="${data.status}"`);

          if (data.status && data.status !== pr.status) {
            updated[i] = { ...pr, status: data.status };
            changed = true;
          }
        } catch (err) {
          console.warn(`Sync PR #${pr.number} fallito:`, err);
        }
      }

      if (changed) {
        setPullRequests(updated);
        localStorage.setItem(LS_KEY, JSON.stringify(updated));
        console.log('✅ Storico PR aggiornato');
      }
    } catch (err) {
      console.warn('Errore syncStatuses:', err);
    } finally {
      setSyncing(false);
    }
  }, []); // nessuna dipendenza: usa sempre prRef.current

  // ------------------------------------------------------------------
  // Mount: carica localStorage → setta state → sync immediata
  // La sync usa "loaded" direttamente (lo state non è ancora pronto)
  // ------------------------------------------------------------------
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;

    let loaded = [];
    try {
      const parsed = JSON.parse(raw);
      loaded = Array.isArray(parsed)
        ? parsed.map(pr => ({
            ...pr,
            organizations: Array.isArray(pr.organizations) ? pr.organizations : [],
            fileCount:
              typeof pr.fileCount === 'number' ? pr.fileCount : (pr.files?.length || 0),
            createdAt: pr.createdAt || pr.created || new Date().toISOString(),
            status: pr.status || 'open'
          }))
        : [];
    } catch {
      loaded = [];
    }

    setPullRequests(loaded);
    if (loaded.length > 0) syncStatuses(loaded); // passa i dati freschi
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // Auto-refresh ogni 30 s (usa prRef, mai stale)
  // ------------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      if (prRef.current.length > 0) syncStatuses();
    }, 30000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // UI helpers
  // ------------------------------------------------------------------
  const togglePRExpansion = (id) => {
    setExpandedPRs(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const filteredPRs = pullRequests.filter(pr => {
    const orgs      = pr.organizations || [];
    const branch    = pr.branch || '';
    const createdAt = pr.createdAt || pr.created || new Date().toISOString();

    const matchSearch =
      !filters.search ||
      orgs.some(o => o.toLowerCase().includes(filters.search.toLowerCase())) ||
      branch.toLowerCase().includes(filters.search.toLowerCase());

    const d = new Date(createdAt);
    const matchFrom = !filters.dateFrom || d >= new Date(filters.dateFrom);
    const matchTo   = !filters.dateTo   || d <= new Date(filters.dateTo);

    return matchSearch && matchFrom && matchTo;
  });

  const getStatusBadge = (status) => ({
    open:   '🟢 Aperta',
    merged: '🟣 Merged',
    closed: '🔴 Chiusa'
  }[status] || status);

  const getStatusLabel = (status) => ({
    open:   'Aperta',
    merged: 'Merge effettuato',
    closed: 'Chiusa'
  }[status] || status);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="page-container">
      <div className="page-content">

        {/* Header */}
        <div className="page-header">
          <h2>📜 Storico Pull Request</h2>
          <div className="header-actions">
            {syncing && (
              <span style={{ fontSize: '0.85rem', color: '#6b7280', marginRight: 12 }}>
                🔄 Sincronizzazione…
              </span>
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => syncStatuses()}
              disabled={syncing}
              style={{ marginRight: 8 }}
            >
              🔄 Aggiorna stati
            </button>
            <Link to="/" className="btn btn-secondary">
              ← Torna alla Home
            </Link>
          </div>
        </div>

        {/* Filtri */}
        <div className="search-filters">
          <label>
            <span>Cerca</span>
            <input
              type="text"
              placeholder="Organizzazione, branch…"
              value={filters.search}
              onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            />
          </label>
          <label>
            <span>Da Data</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
            />
          </label>
          <label>
            <span>A Data</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
            />
          </label>
        </div>

        {/* Tabella / empty state */}
        {filteredPRs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <h3>Nessuna Pull Request</h3>
            <p>Le PR create appariranno qui</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th>PR #</th>
                  <th>Branch</th>
                  <th>Organizzazioni</th>
                  <th>File</th>
                  <th>Data Creazione</th>
                  <th>Stato</th>
                </tr>
              </thead>
              <tbody>
                {filteredPRs.map((pr) => {
                  const orgs      = pr.organizations || [];
                  const createdAt = pr.createdAt || pr.created || new Date().toISOString();
                  return (
                    <React.Fragment key={pr.id || pr.number}>
                      <tr className={expandedPRs.includes(pr.id) ? 'expanded' : ''}>

                        {/* expand */}
                        <td style={{ textAlign: 'center' }}>
                          <span
                            className="expand-icon"
                            onClick={() => togglePRExpansion(pr.id)}
                            style={{ cursor: 'pointer' }}
                          >
                            {expandedPRs.includes(pr.id) ? '−' : '+'}
                          </span>
                        </td>

                        {/* PR # */}
                        <td>
                          <a
                            href={pr.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link-external"
                          >
                            #{pr.number}
                          </a>
                        </td>

                        {/* Branch */}
                        <td>
                          <code style={{ fontSize: '0.85rem' }}>{pr.branch || '-'}</code>
                        </td>

                        {/* Organizzazioni */}
                        <td>{orgs.length} enti</td>

                        {/* File */}
                        <td>{pr.fileCount || 0}</td>

                        {/* Data creazione */}
                        <td>{new Date(createdAt).toLocaleDateString('it-IT')}</td>

                        {/* Stato */}
                        <td>
                          <span className={`status-badge ${pr.status || 'open'}`}>
                            {getStatusBadge(pr.status)}
                          </span>
                        </td>
                      </tr>

                      {/* Riga dettaglio espandibile */}
                      {expandedPRs.includes(pr.id) && (
                        <tr className="details-row">
                          <td colSpan="7">
                            <div className="details-content">
                              <h4>Organizzazioni Incluse ({orgs.length})</h4>
                              {orgs.length === 0 ? (
                                <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                                  Nessuna organizzazione salvata per questa PR.
                                </p>
                              ) : (
                                <ul style={{
                                  listStyle: 'none', padding: 0,
                                  columnCount: 2, columnGap: 20
                                }}>
                                  {orgs.map((org, idx) => (
                                    <li key={idx} style={{ padding: '4px 0' }}>• {org}</li>
                                  ))}
                                </ul>
                              )}
                              <div style={{ marginTop: 12 }}>
                                <strong>Link PR:</strong>{' '}
                                <a
                                  href={pr.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="link-external"
                                >
                                  {pr.url}
                                </a>
                              </div>
                              <div style={{
                                marginTop: 8, fontSize: '0.85rem', color: '#4b5563'
                              }}>
                                Stato: <strong>{getStatusLabel(pr.status || 'open')}</strong>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


export default App;
