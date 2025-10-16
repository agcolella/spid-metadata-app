import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";

// === Helpers ===
function getOrganizationDisplayName(org) {
  if (!org || !org["md:OrganizationDisplayName"]) return "Senza Nome";
  const val = org["md:OrganizationDisplayName"];
  if (Array.isArray(val)) return val.map(e => e._ || e).join(" / ");
  return val._ || val;
}
function extractContactPerson(contactPersons) {
  if (!contactPersons) return "";
  const arr = Array.isArray(contactPersons) ? contactPersons : [contactPersons];
  return arr.map(cp => {
    let type = (cp["spid:entityType"] && typeof cp["spid:entityType"] === "string") ? cp["spid:entityType"] : "";
    if (!type && cp["spid:entityType"] && cp["spid:entityType"]._) type = cp["spid:entityType"]._;
    let email = "";
    let phone = "";
    if (cp["md:EmailAddress"]) {
      email = Array.isArray(cp["md:EmailAddress"])
        ? cp["md:EmailAddress"].map(e => e._ || e).join("; ")
        : (cp["md:EmailAddress"]._ || cp["md:EmailAddress"]);
    }
    if (cp["md:TelephoneNumber"]) {
      phone = Array.isArray(cp["md:TelephoneNumber"])
        ? cp["md:TelephoneNumber"].map(e => e._ || e).join("; ")
        : (cp["md:TelephoneNumber"]._ || cp["md:TelephoneNumber"]);
    }
    return [type, email, phone].filter(Boolean).join(" | ");
  }).filter(Boolean).join(", ");
}
function getRegistryInfo(api) {
  if (!api) return {};
  return {
    eidas_ready: api?.eidas_ready,
    create_date: api?.create_date,
    lastupdate_date: api?.lastupdate_date,
    delete_date: api?.delete_date,
    _deleted: String(api?._deleted),
    _disabled: String(api?._disabled),
    registry_link: api?.registry_link
  };
}
const registryColKeys = [
  "eidas_ready", "create_date", "lastupdate_date", "delete_date", "_deleted", "_disabled", "registry_link"
];
const registryColLabels = [
  "eidas_ready","create_date","lastupdate_date","delete_date","_deleted","_disabled","registry_link"
];
const LS_KEY = "spid-pr-history";

// === STORICO PR PAGE SOLO READ ===
function PRHistoryPage() {
  const [pullRequests, setPullRequests] = useState([]);
  const [prAccordionOpen, setPrAccordionOpen] = useState({});
  const [searchDataPR, setSearchDataPR] = useState("");
  const [searchEnte, setSearchEnte] = useState("");
  const [searchDataCreazione, setSearchDataCreazione] = useState("");
  useEffect(() => {
    const raw = localStorage.getItem("spid-pr-history");
    if (raw) {
      try { setPullRequests(JSON.parse(raw)); }
      catch { setPullRequests([]); }
    }
  }, []);

  // Filter PRs: a PR is shown if at least one of its entities matches
  // For display: only show matching entities inside each PR
  const filteredPRs = pullRequests.map(pr => {
    const dataPRMatch = pr.created.toLowerCase().includes(searchDataPR.toLowerCase());
    const filteredEnti = pr.enti.filter(e =>
      (searchEnte.length === 0 || (e.ente && e.ente.toLowerCase().includes(searchEnte.toLowerCase())))
      &&
      (searchDataCreazione.length === 0 ||
        (e.dataCreazione && new Date(e.dataCreazione).toLocaleString().toLowerCase().includes(searchDataCreazione.toLowerCase())))
    );
    // PR is visible only if the date matches AND at least one entity matches filters
    return (filteredEnti.length > 0 && dataPRMatch)
      ? { ...pr, enti: filteredEnti }
      : null;
  }).filter(Boolean);

  return (
    <div style={{
      maxWidth:900, margin:"32px auto", background:"#fcfcfc",
      borderRadius:8, border:"1px solid #ced"
    }}>
      <div style={{padding:"20px"}}>
        <h2>Storico Pull Request Effettuate</h2>
        <Link to="/" style={{color:"#227"}}>← Torna all’app principale</Link>
        <div style={{marginBottom:16, display: "flex", gap: 24, alignItems:"center", flexWrap:"wrap"}}>
          <label>
            Cerca Data PR:&nbsp;
            <input
              value={searchDataPR}
              onChange={e => setSearchDataPR(e.target.value)}
              style={{padding:"2px 8px", fontSize:"1em"}}
              placeholder="gg/mm/aaaa o parte"
            />
          </label>
          <label>
            Cerca Ente:&nbsp;
            <input
              value={searchEnte}
              onChange={e => setSearchEnte(e.target.value)}
              style={{padding:"2px 8px", fontSize:"1em"}}
              placeholder="Ente"
            />
          </label>
          <label>
            Cerca Data Creazione XML:&nbsp;
            <input
              value={searchDataCreazione}
              onChange={e => setSearchDataCreazione(e.target.value)}
              style={{padding:"2px 8px", fontSize:"1em"}}
              placeholder="gg/mm/aaaa o ora"
            />
          </label>
        </div>
        {filteredPRs.length === 0 ? (
          <div style={{color:"#888"}}>Nessuna PR trovata per i criteri selezionati.</div>
        ) : (
          <table style={{borderCollapse:"collapse", width:"100%", marginTop:16}}>
            <thead style={{background:"#ececec"}}>
              <tr>
                <th>Data PR</th>
                <th>URL PR</th>
                <th>Dettaglio</th>
              </tr>
            </thead>
            <tbody>
              {filteredPRs.map((pr, idx) => (
                <React.Fragment key={pr.url + "_row"}>
                  <tr style={{background:prAccordionOpen[idx] ? "#eefbe7" : "none", cursor:"pointer"}}
                    onClick={() => setPrAccordionOpen(prev => ({ ...prev, [idx]: !prev[idx] }))}>
                    <td>{pr.created}</td>
                    <td>
                      <a href={pr.url} target="_blank" rel="noopener noreferrer">{pr.url}</a>
                    </td>
                    <td>
                      <span style={{color:"#167c3f", fontWeight:"bold", fontSize:"1.1em"}}>
                        {prAccordionOpen[idx] ? "▲" : "▼"} Dettagli
                      </span>
                    </td>
                  </tr>
                  {prAccordionOpen[idx] && (
                    <tr>
                      <td colSpan={3} style={{padding:"12px 12px", background:"#f3f9ee", borderRadius:8}}>
                        <table style={{width:"100%"}}>
                          <thead>
                            <tr>
                              <th>Ente</th>
                              <th>Data Creazione XML</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Solo enti che matchano! */}
                            {pr.enti.map((enteItem, j) => (
                              <tr key={pr.url + "_ente_" + j}>
                                <td>{enteItem.ente}</td>
                                <td>{enteItem.dataCreazione ? new Date(enteItem.dataCreazione).toLocaleString() : "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}



// === MAIN PAGE WRITE + READ ===
function MainPage() {
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
  const fileInputRef = useRef();
  const dirInputRef = useRef();
  const [prInProgress, setPrInProgress] = useState(false);

  useEffect(() => {
    axios.get("http://localhost:4000/files").then(res => setFiles(res.data));
  }, []);
  // Carica storico 1 sola volta
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try { setPullRequests(JSON.parse(raw)); }
      catch { setPullRequests([]); }
    }
  }, []);
  // Non serve effetto di save automatico!

  useEffect(() => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const fetchData = async () => {
      let cacheCopy = {...registryCache};
      for (let file of selectedFiles) {
        const entityID = file.entityID;
        if (entityID && !cacheCopy[entityID]) {
          try {
            const url = "https://registry.spid.gov.it/entities/" + encodeURIComponent(entityID) + "?&output=json";
            const res = await axios.get(url);
            cacheCopy[entityID] = res.data;
            setRegistryCache({...cacheCopy});
          } catch (err) {
            if (err?.response?.status === 404) {
              cacheCopy[entityID] = { notFound: true };
              setRegistryCache({...cacheCopy});
            } else {
              cacheCopy[entityID] = null;
              setRegistryCache({...cacheCopy});
            }
          }
          await sleep(400);
        }
      }
    };
    if (selectedFiles.length) fetchData();
    // eslint-disable-next-line
  }, [selectedFiles]);

  const handleFilesDrop = async (e) => {
    const filesList = e.target.files;
    let newFiles = [];
    let errors = [];
    setUploadProgress({ loaded: 0, total: filesList.length, active: true });

    for (let i = 0; i < filesList.length; i++) {
      const file = filesList[i];
      if (!file.name.toLowerCase().endsWith(".xml")) {
        errors.push({ filename: file.name, error: "Formato non XML: ignorato" });
        setUploadProgress(p => ({ ...p, loaded: p.loaded + 1 }));
        continue;
      }
      try {
        const formData = new FormData();
        formData.append("xmlfile", file);
        formData.append("creationDate", new Date(file.lastModified).toISOString());
        const res = await axios.post("http://localhost:4000/upload", formData);
        newFiles.push(res.data);
      } catch (err) {
        errors.push({
          filename: file.name,
          error: err.response?.data?.error || "Errore di upload/parsing"
        });
      }
      setUploadProgress(p => ({ ...p, loaded: p.loaded + 1 }));
    }
    setFiles(prev => [...prev, ...newFiles]);
    setUploadErrors(errors);
    setUploadProgress({ loaded: 0, total: 0, active: false });
  };

  const filesSorted = [...files].sort(
    (a, b) =>
      sortConfig.direction === "desc"
        ? new Date(b.creationDate) - new Date(a.creationDate)
        : new Date(a.creationDate) - new Date(b.creationDate)
  );
  const filteredFiles = filesSorted.filter(f =>
    f.filename.toLowerCase().includes(search.toLowerCase()) ||
    new Date(f.creationDate).toLocaleDateString().includes(search) ||
    (getOrganizationDisplayName(f.organization) && getOrganizationDisplayName(f.organization).toLowerCase().includes(search.toLowerCase())) ||
    (f.enteType && f.enteType.toLowerCase().includes(search.toLowerCase()))
  );

  const getValueForSort = (colKey, sel, reg) => {
    switch (colKey) {
      case "Organizzazione": return getOrganizationDisplayName(sel.organization) || "";
      case "EntityID": return sel.entityID || "";
      case "Tipo ente": return sel.enteType || "";
      case "ContactPerson": return extractContactPerson(sel.contactPersons) || "";
      case "eidas_ready": return reg.eidas_ready || "";
      case "create_date": return reg.create_date || "";
      case "lastupdate_date": return reg.lastupdate_date || "";
      case "delete_date": return reg.delete_date || "";
      case "_deleted": return reg._deleted || "";
      case "_disabled": return reg._disabled || "";
      case "registry_link": return reg.registry_link || "";
      default: return sel[colKey] || "";
    }
  };

  function getSortedSelectedFiles() {
    let arr = [...selectedFiles];
    if (sortConfig && sortConfig.key) {
      arr.sort((a, b) => {
        const regA = getRegistryInfo(registryCache[a.entityID]);
        const regB = getRegistryInfo(registryCache[b.entityID]);
        const valA = getValueForSort(sortConfig.key, a, regA);
        const valB = getValueForSort(sortConfig.key, b, regB);
        if (!valA && !valB) return 0;
        if (!valA) return sortConfig.direction === "asc" ? -1 : 1;
        if (!valB) return sortConfig.direction === "asc" ? 1 : -1;
        if (sortConfig.key.includes("date")) {
          const dateA = new Date(valA); const dateB = new Date(valB);
          return sortConfig.direction === "asc" ? dateA - dateB : dateB - dateA;
        }
        return sortConfig.direction === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      });
    }
    return arr;
  }
  const sortedFiles = getSortedSelectedFiles();
  const numPages = Math.max(1, Math.ceil(sortedFiles.length / resultsPerPage));
  const paginatedFiles = sortedFiles.slice((page-1)*resultsPerPage, page*resultsPerPage);

  const handleTableSort = (colKey) => {
    setSortConfig(prev =>
      prev.key === colKey
        ? { key: colKey, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key: colKey, direction: "asc" }
    );
  };

  const handleSelect = (file) => {
    setSelectedFiles(selectedFiles.includes(file)
      ? selectedFiles.filter(f => f !== file)
      : [...selectedFiles, file]);
  };
  const deselectAll = () => setSelectedFiles([]);
  const selectAll = () => setSelectedFiles(filteredFiles);

  const clearAllFiles = () => {
    setFiles([]);
    setSelectedFiles([]);
    setRegistryCache({});
  };

  // BOTTONE CREA PR - SOLO QUI SAVE!
	async function handleCreatePR() {
	  setPrInProgress(true);
	  try {
		const organizations = [...new Set(selectedFiles.map(f => getOrganizationDisplayName(f.organization)))];
		const filenames = selectedFiles.map(f => f.filename);
		const entiList = selectedFiles.map(f => ({
		  ente: getOrganizationDisplayName(f.organization),
		  dataCreazione: f.creationDate
		}));
		const resFiles = await axios.post("http://localhost:4000/get-xml-contents", { filenames });
		if (!resFiles.data || !resFiles.data.length) {
		  alert("Nessun contenuto XML recuperato.");
		  return;
		}
		const prRes = await axios.post("http://localhost:4000/create-pull-request", {
		  files: resFiles.data,
		  organizations
		});
		if (prRes.data && prRes.data.success) {
		  alert("Pull request creata: " + prRes.data.url);
		  setPullRequests(prev => {
			const updated = [
			  { url: prRes.data.url, enti: entiList, created: new Date().toLocaleString() },
			  ...prev
			];
			localStorage.setItem(LS_KEY, JSON.stringify(updated));
			return updated;
		  });
		} else {
		  alert("Errore nella creazione della PR");
		}
	  } catch (err) {
		alert("Errore imprevisto nella PR.");
	  } finally {
		setPrInProgress(false);
	  }
	}


  return (
    <div style={{display:"flex", flexDirection:"column", minHeight:"100vh"}}>
      <div style={{maxWidth:1100, margin:"0 auto", flex:1, width:"100%"}}>
        <div style={{display:"flex"}}>
          <div style={{width:360, borderRight:"1px solid #ccc", padding:"8px"}}>
            <div style={{display:"flex", gap: 8, marginBottom:12}}>
              <button onClick={() => fileInputRef.current.click()}>
                Scegli file
              </button>
              <button onClick={() => dirInputRef.current.click()}>
                Scegli cartella
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml"
              multiple
              style={{display:"none"}}
              onChange={handleFilesDrop}
            />
            <input
              ref={dirInputRef}
              type="file"
              accept=".xml"
              webkitdirectory="true"
              style={{display:"none"}}
              onChange={handleFilesDrop}
            />

            {/* LINK pagina storico PR */}
            <div style={{marginBottom:20, marginTop:10}}>
              <Link to="/history" style={{fontWeight:"bold", color:"#225", textDecoration:"underline"}}>🗂️ Storico Pull Request</Link>
            </div>

            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cerca per nome, data, ente, org..."
              style={{ width: "96%", marginBottom: 10 }}
            />
            <div style={{marginBottom: 10, display: "flex", gap: "6px", flexWrap: "wrap"}}>
              <button onClick={() => handleTableSort("creationDate")}>
                Ordina per Data: {sortConfig.key === "creationDate" ? (sortConfig.direction === "asc" ? "↑" : "↓") : ""}
              </button>
              <button onClick={deselectAll}>
                Deseleziona tutti
              </button>
              <button onClick={selectAll}>
                Seleziona tutti
              </button>
              <button
                style={{background:"#eee", color:"darkred", fontWeight:"bold"}}
                onClick={clearAllFiles}>
                Pulisci lista
              </button>
            </div>
            <div style={{marginBottom: 12, display: "flex", flexDirection: "column", gap: "8px"}}>
              <button
                style={{background:"#cff", fontWeight:"bold"}}
                disabled={selectedFiles.length === 0}
                onClick={handleCreatePR}>
                {prInProgress ? "In creazione..." : "Crea Pull Request"}
              </button>
              <button
                style={{background:"#fdd", color:"#900"}}
                disabled={selectedFiles.length === 0}
                onClick={async () => {
                  const filenames = selectedFiles.map(f => f.filename);
                  await axios.post("http://localhost:4000/delete-xml-files", { filenames });
                  setFiles(files.filter(f => !filenames.includes(f.filename)));
                  setSelectedFiles([]);
                  setRegistryCache({});
                }}>
                Elimina file selezionati
              </button>
            </div>
            <ul style={{listStyle: "none", padding: 0}}>
              {filteredFiles.map((file, idx) => (
                <li key={idx} style={{
                    marginBottom: "10px", paddingBottom: "8px", borderBottom: "1px dashed #eee",
                    background: selectedFiles.includes(file) ? "#def6de" : "transparent"
                  }}>
                  <label style={{display:"flex", alignItems:"center", cursor:"pointer"}}>
                    <input
                      type="checkbox"
                      checked={selectedFiles.includes(file)}
                      onChange={() => handleSelect(file)}
                      style={{marginRight:6}}
                    />
                    <span>
                      <b>{file.filename}</b>
                      <span style={{marginLeft: 8, color:"#888", fontSize:"0.95em"}}>
                        ({new Date(file.creationDate).toLocaleString()})
                      </span>
                      <span style={{fontSize:"0.93em", color:"#454", marginLeft:6}}>{file.enteType}</span>
                      <span style={{fontSize:"0.93em", color:"#144", marginLeft:6}}>
                        {getOrganizationDisplayName(file.organization)}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div style={{flex:1, padding:20, overflowX:"auto"}}>
            {selectedFiles.length > 0 && (
              <>
                <div style={{marginBottom:12}}>
                  <label>
                    Risultati per pagina:
                    <select
                      style={{marginLeft:8, fontSize:"1em"}}
                      value={resultsPerPage}
                      onChange={e => {
                        setPage(1);
                        setResultsPerPage(Number(e.target.value));
                      }}>
                      {[5,10,20,50,100].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                </div>
                {numPages > 1 && (
                  <div style={{margin:"8px 0"}}>
                    <button disabled={page === 1} onClick={() => setPage(p => Math.max(1, p-1))}>←</button>
                    <span style={{margin:"0 12px"}}>Pagina {page} di {numPages}</span>
                    <button disabled={page === numPages} onClick={() => setPage(p => Math.min(numPages, p+1))}>→</button>
                  </div>
                )}
                <table style={{width:"100%", borderCollapse:"collapse"}}>
                  <thead style={{background:"#ececec"}}>
                    <tr>
                      {["Organizzazione", "EntityID","Tipo ente","ContactPerson", ...registryColLabels].map(col =>
                        <th
                          key={col}
                          style={{padding:"5px", border:"1px solid #ddd", cursor: "pointer", whiteSpace: "nowrap"}}
                          onClick={() => handleTableSort(col)}
                        >
                          {col}
                          {sortConfig.key === col ? (sortConfig.direction === "asc" ? " ↑" : " ↓") : ""}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedFiles.map((selected, idx) => {
                      const orgName = getOrganizationDisplayName(selected.organization);
                      const contactInfo = extractContactPerson(selected.contactPersons);
                      const api = registryCache[selected.entityID];
                      const isNotFound = api?.notFound;
                      const reg = !isNotFound ? getRegistryInfo(api) : null;

                      return (
                        <tr key={idx}>
                          <td>{orgName}</td>
                          <td>{selected.entityID}</td>
                          <td>{selected.enteType}</td>
                          <td>{contactInfo}</td>
                          {isNotFound
                            ? registryColKeys.map(col => (
                                <td key={col} style={{padding:"5px", border:"1px solid #ddd"}}>N/A</td>
                              ))
                            : registryColKeys.map(col => (
                                <td key={col} style={{padding:"5px", border:"1px solid #ddd"}}>
                                  {col === "registry_link" && reg[col]
                                    ? <a href={reg[col]} target="_blank" rel="noopener noreferrer">{reg[col]}</a>
                                    : (reg[col] || "")}
                                </td>
                              ))
                          }
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// === EXPORT BOOTSTRAP ROUTER ===
export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainPage/>} />
        <Route path="/history" element={<PRHistoryPage />} />
      </Routes>
    </Router>
  );
}
