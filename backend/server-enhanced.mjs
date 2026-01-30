import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import config from './config/app-config.js';
import GitHubService from './services/GitHubService.js';
import XMLValidatorService from './services/XMLValidatorService.js';
import PRHistoryService from './services/PRHistoryService.js';
import RegistryService from './services/RegistryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Inizializzazione
const app = express();
const upload = multer({ dest: 'uploads/' });

// Crea directory XML se non esiste
const SAVE_XML_DIR = config.storage.xmlDirectory;
if (!fs.existsSync(SAVE_XML_DIR)) {
  fs.mkdirSync(SAVE_XML_DIR, { recursive: true });
}

// Middleware
app.use(cors({ origin: config.server.corsOrigin }));
app.use(bodyParser.json({ limit: '10mb' }));

// Storage in-memory per file caricati
let filesData = [];

// Mappa per tracking progress upload
const uploadProgress = new Map();

/**
 * Health check e configurazione
 */
app.get('/health', async (req, res) => {
  const configValidation = config.validate();
  
  if (!configValidation.valid) {
    return res.status(500).json({
      status: 'error',
      errors: configValidation.errors
    });
  }

  // Verifica token GitHub
  GitHubService.initialize();
  const tokenValidation = await GitHubService.validateToken();

  res.json({
    status: 'ok',
    version: '2.0.0',
    github: {
      connected: tokenValidation.valid,
      user: tokenValidation.user,
      repo: config.github.repo
    },
    filesLoaded: filesData.length
  });
});

/**
 * Upload singolo file XML con validazione avanzata
 */
app.post('/upload', upload.single('xmlfile'), async (req, res) => {
  const { path: tempPath, originalname } = req.file;
  const creationDate = req.body.creationDate || new Date().toISOString();
  
  try {
    // Verifica estensione
    const ext = path.extname(originalname).toLowerCase();
    if (ext !== '.xml') {
      fs.unlinkSync(tempPath);
      return res.status(400).json({ 
        error: 'Formato non XML',
        filename: originalname 
      });
    }

    // Leggi contenuto
    const xmlContent = fs.readFileSync(tempPath, 'utf-8');
    
    // Validazione XML
    const validation = await XMLValidatorService.validateAndParse(xmlContent, originalname);
    
    if (!validation.valid) {
      fs.unlinkSync(tempPath);
      return res.status(400).json({
        error: 'Validazione XML fallita',
        filename: originalname,
        errors: validation.errors,
        warnings: validation.warnings
      });
    }

    // Salva file
    const savePath = path.join(SAVE_XML_DIR, originalname);
    fs.writeFileSync(savePath, xmlContent);
    fs.unlinkSync(tempPath);

    // Aggiungi ai file caricati
    const fileData = {
      filename: originalname,
      creationDate,
      uploadedAt: new Date().toISOString(),
      ...validation.data,
      validation: {
        errors: validation.errors,
        warnings: validation.warnings
      }
    };

    filesData.push(fileData);

    res.json({
      success: true,
      file: fileData
    });

  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    
    res.status(500).json({
      error: 'Errore durante upload',
      message: error.message,
      filename: originalname
    });
  }
});

/**
 * Batch upload con progress tracking
 */
app.post('/upload-batch', upload.array('xmlfiles', 100), async (req, res) => {
  const sessionId = Date.now().toString();
  const files = req.files;
  
  uploadProgress.set(sessionId, {
    total: files.length,
    processed: 0,
    successful: 0,
    failed: 0,
    errors: []
  });

  res.json({ sessionId, total: files.length });

  // Processa in background
  (async () => {
    for (const file of files) {
      try {
        const xmlContent = fs.readFileSync(file.path, 'utf-8');
        const validation = await XMLValidatorService.validateAndParse(xmlContent, file.originalname);
        
        if (validation.valid) {
          const savePath = path.join(SAVE_XML_DIR, file.originalname);
          fs.writeFileSync(savePath, xmlContent);
          
          filesData.push({
            filename: file.originalname,
            creationDate: new Date(file.lastModified || Date.now()).toISOString(),
            uploadedAt: new Date().toISOString(),
            ...validation.data,
            validation: {
              warnings: validation.warnings
            }
          });
          
          uploadProgress.get(sessionId).successful++;
        } else {
          uploadProgress.get(sessionId).failed++;
          uploadProgress.get(sessionId).errors.push({
            filename: file.originalname,
            errors: validation.errors
          });
        }
        
        fs.unlinkSync(file.path);
        uploadProgress.get(sessionId).processed++;
        
      } catch (error) {
        uploadProgress.get(sessionId).failed++;
        uploadProgress.get(sessionId).processed++;
        uploadProgress.get(sessionId).errors.push({
          filename: file.originalname,
          error: error.message
        });
      }
    }
  })();
});

/**
 * Ottieni progress upload batch
 */
app.get('/upload-progress/:sessionId', (req, res) => {
  const progress = uploadProgress.get(req.params.sessionId);
  
  if (!progress) {
    return res.status(404).json({ error: 'Session non trovata' });
  }
  
  res.json(progress);
  
  // Cleanup se completato
  if (progress.processed === progress.total) {
    setTimeout(() => uploadProgress.delete(req.params.sessionId), 60000);
  }
});

/**
 * Lista file con filtri avanzati
 */
app.get('/files', (req, res) => {
  const { search, enteType, hasWarnings, sortBy, sortOrder } = req.query;
  
  let filtered = [...filesData];
  
  // Filtro ricerca testuale
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(f => 
      f.filename?.toLowerCase().includes(searchLower) ||
      f.entityID?.toLowerCase().includes(searchLower) ||
      getOrganizationDisplayName(f.organization)?.toLowerCase().includes(searchLower)
    );
  }
  
  // Filtro tipo ente
  if (enteType) {
    filtered = filtered.filter(f => f.enteType === enteType);
  }
  
  // Filtro warnings
  if (hasWarnings === 'true') {
    filtered = filtered.filter(f => f.validation?.warnings?.length > 0);
  }
  
  // Ordinamento
  if (sortBy) {
    filtered.sort((a, b) => {
      const aVal = a[sortBy] || '';
      const bVal = b[sortBy] || '';
      const order = sortOrder === 'desc' ? -1 : 1;
      return aVal.localeCompare(bVal) * order;
    });
  }
  
  res.json(filtered);
});

/**
 * Ottieni contenuti XML
 */
app.post('/get-xml-contents', (req, res) => {
  const { filenames } = req.body;
  const results = [];
  
  for (const filename of filenames) {
    const fullPath = path.join(SAVE_XML_DIR, filename);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      results.push({ filename, content });
    }
  }
  
  res.json(results);
});

/**
 * Elimina file XML
 */
app.post('/delete-xml-files', (req, res) => {
  const { filenames } = req.body;
  const deleted = [];
  const errors = [];
  
  for (const filename of filenames) {
    try {
      const fullPath = path.join(SAVE_XML_DIR, filename);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        deleted.push(filename);
      }
      filesData = filesData.filter(f => f.filename !== filename);
    } catch (error) {
      errors.push({ filename, error: error.message });
    }
  }
  
  res.json({ success: true, deleted, errors });
});

/**
 * Validazione batch pre-PR
 */
app.post('/validate-batch', async (req, res) => {
  const { filenames } = req.body;
  const files = [];
  
  for (const filename of filenames) {
    const fullPath = path.join(SAVE_XML_DIR, filename);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      files.push({ filename, content });
    }
  }
  
  const validationReport = await XMLValidatorService.validateBatch(files);
  res.json(validationReport);
});

/**
 * Crea Pull Request con opzioni avanzate
 */
app.post('/create-pull-request', async (req, res) => {
  try {
    const { filenames, organizations, options = {} } = req.body;
    
    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ error: 'Nessun file selezionato' });
    }

    // Inizializza GitHub Service
    GitHubService.initialize();

    // Recupera contenuti
    const files = [];
    for (const filename of filenames) {
      const fullPath = path.join(SAVE_XML_DIR, filename);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        files.push({ filename, content });
      }
    }

    if (files.length === 0) {
      return res.status(400).json({ error: 'Nessun contenuto XML trovato' });
    }

    // Validazione pre-PR
    if (options.validateBeforePR !== false) {
      const validation = await XMLValidatorService.validateBatch(files);
      if (validation.invalid > 0 && config.validation.strict) {
        return res.status(400).json({
          error: 'Validazione fallita per alcuni file',
          validation
        });
      }
    }

    // Crea PR con retry
    const result = await GitHubService.createPRWithRetry(
      files,
      organizations || [],
      {
        draft: options.draft !== undefined ? options.draft : config.prOptions.defaultDraft,
        labels: options.labels || config.prOptions.defaultLabels,
        reviewers: options.reviewers || config.prOptions.defaultReviewers,
        notes: options.notes,
        prTitle: options.prTitle,
        commitMessage: options.commitMessage
      }
    );

    if (!result.success) {
      return res.status(500).json({
        error: 'Errore nella creazione della PR',
        details: result.error
      });
    }

    // Salva nello storico
    const historyEntry = {
      prNumber: result.pr.number,
      prUrl: result.pr.url,
      branch: result.pr.branch,
      filesCount: files.length,
      organizations: organizations || [],
      files: filenames.map(fn => {
        const fileData = filesData.find(f => f.filename === fn);
        return {
          filename: fn,
          ente: getOrganizationDisplayName(fileData?.organization),
          dataCreazione: fileData?.creationDate
        };
      }),
      createdAt: new Date().toISOString(),
      status: 'open'
    };

    await PRHistoryService.addEntry(historyEntry);

    res.json({
      success: true,
      pr: result.pr,
      historyEntry
    });

  } catch (error) {
    console.error('Errore creazione PR:', error);
    res.status(500).json({
      error: 'Errore imprevisto',
      message: error.message
    });
  }
});

/**
 * Ottieni storico PR
 */
app.get('/pr-history', async (req, res) => {
  const { limit, offset, status } = req.query;
  const history = await PRHistoryService.getHistory({
    limit: limit ? parseInt(limit) : 50,
    offset: offset ? parseInt(offset) : 0,
    status
  });
  res.json(history);
});

/**
 * Aggiorna stato PR nello storico
 */
app.post('/pr-history/:prNumber/update-status', async (req, res) => {
  try {
    GitHubService.initialize();
    const [owner, repo] = config.github.repo.split('/');
    const prNumber = parseInt(req.params.prNumber);
    
    const status = await GitHubService.getPullRequestStatus(owner, repo, prNumber);
    
    if (status.error) {
      return res.status(404).json({ error: status.error });
    }
    
    await PRHistoryService.updateStatus(prNumber, status);
    
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Ottieni info da registry SPID
 */
app.get('/registry/:entityID', async (req, res) => {
  try {
    const entityID = decodeURIComponent(req.params.entityID);
    const data = await RegistryService.getEntityInfo(entityID);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message
    });
  }
});

/**
 * Batch registry lookup
 */
app.post('/registry/batch', async (req, res) => {
  const { entityIDs } = req.body;
  const results = await RegistryService.batchLookup(entityIDs);
  res.json(results);
});

/**
 * Helper per ottenere nome organizzazione
 */
function getOrganizationDisplayName(org) {
  if (!org || !org['md:OrganizationDisplayName']) return 'Senza Nome';
  const val = org['md:OrganizationDisplayName'];
  if (Array.isArray(val)) return val.map(e => e._ || e).join(' / ');
  return val._ || val;
}

// Avvio server
const PORT = config.server.port;
app.listen(PORT, () => {
  console.log(`\n🚀 SPID Metadata App v2.0`);
  console.log(`🌐 Server avviato su http://localhost:${PORT}`);
  console.log(`📁 Directory XML: ${SAVE_XML_DIR}`);
  console.log(`🐛 Repository: ${config.github.repo}\n`);
});

export default app;
