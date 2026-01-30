import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import multer from 'multer';
import xml2js from 'xml2js';
import fs from 'fs';
import pathmod from 'path';
import { GitHubService } from './services/GitHubService.js';
import { XMLValidatorService } from './services/XMLValidatorService.js';
import { PRHistoryService } from './services/PRHistoryService.js';
import { NotificationService } from './services/NotificationService.js';

// Carica configurazione
let config;
try {
  const configData = fs.readFileSync('./repo-config.json', 'utf8');
  config = JSON.parse(configData);
} catch (error) {
  console.error('❌ Errore: file repo-config.json non trovato o non valido');
  console.error('Crea il file basandoti su repo-config.example.json');
  process.exit(1);
}

// Verifica variabili d'ambiente per token (più sicuro)
if (process.env.GITHUB_TOKEN) {
  config.githubToken = process.env.GITHUB_TOKEN;
}

if (!config.githubToken) {
  console.error('❌ Errore: GitHub token mancante');
  console.error('Aggiungi githubToken in repo-config.json o imposta GITHUB_TOKEN come variabile d\'ambiente');
  process.exit(1);
}

// Inizializza servizi
const githubService = new GitHubService(config);
const xmlValidator = new XMLValidatorService();
const prHistory = new PRHistoryService('./pr-history.json');
const notifications = new NotificationService(config.notifications || {});

// Directory per salvare XML
const SAVE_XML_DIR = 'saved-xml';
if (!fs.existsSync(SAVE_XML_DIR)) fs.mkdirSync(SAVE_XML_DIR);

// Setup Express
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
const upload = multer({ dest: 'uploads/' });

// In-memory storage per file caricati (sessione corrente)
let filesData = [];

// =======================
// UTILITIES
// =======================

function enteTypeFromExtensions(extObj) {
  if (!extObj) return '';
  const allKeys = Object.keys(extObj);
  for (const key of allKeys) {
    if (
      key === 'spid:Public' && (
        extObj[key] === '' || extObj[key] === null || typeof extObj[key] === 'undefined' ||
        (typeof extObj[key] === 'object' && Object.keys(extObj[key]).length === 0)
      )
    ) return 'Pubblico';
    if (key === 'spid:Public' && typeof extObj[key] === 'object') return 'Pubblico';
    if (
      key === 'spid:Private' && (
        extObj[key] === '' || extObj[key] === null || typeof extObj[key] === 'undefined' ||
        (typeof extObj[key] === 'object' && Object.keys(extObj[key]).length === 0)
      )
    ) return 'Privato';
    if (key === 'spid:Private' && typeof extObj[key] === 'object') return 'Privato';
    if (extObj[key] && typeof extObj[key] === 'object') {
      const nested = Array.isArray(extObj[key]) ? extObj[key] : [extObj[key]];
      for (const sub of nested) {
        const found = enteTypeFromExtensions(sub);
        if (found) return found;
      }
    }
  }
  return '';
}

// =======================
// ENDPOINT: Health Check
// =======================
app.get('/health', async (req, res) => {
  try {
    // Verifica connessione a GitHub
    const tokenValid = await githubService.validateToken();
    const repoValid = await githubService.validateRepository();

    res.json({
      status: 'ok',
      services: {
        github: tokenValid.valid && repoValid.valid,
        githubUser: tokenValid.user || null,
        repository: repoValid.valid ? config.repo : null
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// =======================
// ENDPOINT: Upload XML
// =======================
app.post('/upload', upload.single('xmlfile'), async (req, res) => {
  const { path, originalname } = req.file;
  const creationDate = req.body.creationDate || new Date().toISOString();
  const ext = pathmod.extname(originalname).toLowerCase();

  try {
    // 1. Verifica formato
    if (ext !== '.xml') {
      fs.unlinkSync(path);
      return res.status(400).json({ 
        error: 'Formato non XML',
        code: 'INVALID_FORMAT'
      });
    }

    // 2. Leggi contenuto
    const xml = fs.readFileSync(path, 'utf8');
    
    // 3. Valida XML
    const validation = await xmlValidator.validateXML(xml, originalname);
    
    if (!validation.valid) {
      fs.unlinkSync(path);
      return res.status(400).json({
        error: 'XML non valido',
        code: 'VALIDATION_FAILED',
        errors: validation.errors,
        warnings: validation.warnings
      });
    }

    // 4. Salva file
    fs.writeFileSync(pathmod.join(SAVE_XML_DIR, originalname), xml);

    // 5. Parse per estrazione metadata
    const parser = new xml2js.Parser({ explicitArray: false });
    parser.parseString(xml, (err, result) => {
      fs.unlinkSync(path);
      
      if (err) {
        return res.status(400).json({ 
          error: 'Errore parsing XML',
          code: 'PARSE_ERROR',
          details: err.message
        });
      }

      const entity = result['md:EntityDescriptor'];
      if (!entity || !entity.$ || !entity.$.entityID) {
        return res.status(400).json({ 
          error: 'File XML non conforme: manca md:EntityDescriptor o entityID',
          code: 'INVALID_STRUCTURE'
        });
      }

      const entityID = entity.$.entityID;
      const mdOrg = entity['md:Organization'];
      const contacts = entity['md:ContactPerson'];
      
      // Estrai tipo ente
      let enteType = '';
      if (contacts) {
        const contactsArr = Array.isArray(contacts) ? contacts : [contacts];
        for (const c of contactsArr) {
          if (c.$?.contactType === 'other' && c['md:Extensions']) {
            const foundType = enteTypeFromExtensions(c['md:Extensions']);
            if (foundType) {
              enteType = foundType;
              break;
            }
          }
        }
      }

      const fileData = {
        filename: originalname,
        creationDate,
        uploadedAt: new Date().toISOString(),
        entityID,
        organization: mdOrg,
        enteType,
        contactPersons: contacts,
        validation: {
          valid: true,
          warnings: validation.warnings
        }
      };

      filesData.push(fileData);
      res.json(fileData);
    });
  } catch (error) {
    if (fs.existsSync(path)) fs.unlinkSync(path);
    res.status(500).json({
      error: 'Errore interno',
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// =======================
// ENDPOINT: Batch Validation
// =======================
app.post('/validate-batch', async (req, res) => {
  try {
    const { filenames } = req.body;
    
    if (!filenames || !Array.isArray(filenames)) {
      return res.status(400).json({ error: 'Parametro filenames non valido' });
    }

    const files = [];
    for (const filename of filenames) {
      const fullPath = pathmod.join(SAVE_XML_DIR, filename);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        files.push({ filename, content });
      }
    }

    const validationResults = await xmlValidator.validateBatch(files);
    res.json(validationResults);
  } catch (error) {
    res.status(500).json({
      error: 'Errore validazione batch',
      message: error.message
    });
  }
});

// =======================
// ENDPOINT: Get Files
// =======================
app.get('/files', (req, res) => {
  const search = (req.query.search || '').toLowerCase();
  let filtered = filesData;
  
  if (search) {
    filtered = filesData.filter(
      f => f.filename && f.filename.toLowerCase().includes(search)
    );
  }
  
  res.json(filtered);
});

// =======================
// ENDPOINT: Get XML Contents
// =======================
app.post('/get-xml-contents', (req, res) => {
  try {
    const { filenames } = req.body;
    
    if (!filenames || !Array.isArray(filenames)) {
      return res.status(400).json({ error: 'Parametro filenames non valido' });
    }

    const results = [];
    for (const filename of filenames) {
      const fullPath = pathmod.join(SAVE_XML_DIR, filename);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        results.push({ filename, content });
      } else {
        results.push({ 
          filename, 
          error: 'File non trovato',
          content: null 
        });
      }
    }
    
    res.json(results);
  } catch (error) {
    res.status(500).json({
      error: 'Errore lettura file',
      message: error.message
    });
  }
});

// =======================
// ENDPOINT: Delete XML Files
// =======================
app.post('/delete-xml-files', (req, res) => {
  try {
    const { filenames } = req.body;
    
    if (!filenames || !Array.isArray(filenames)) {
      return res.status(400).json({ error: 'Parametro filenames non valido' });
    }

    const deleted = [];
    const notFound = [];

    for (const filename of filenames) {
      const fullPath = pathmod.join(SAVE_XML_DIR, filename);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        deleted.push(filename);
      } else {
        notFound.push(filename);
      }
      filesData = filesData.filter(f => f.filename !== filename);
    }
    
    res.json({ 
      success: true, 
      deleted: deleted.length,
      notFound: notFound.length,
      files: { deleted, notFound }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Errore eliminazione file',
      message: error.message
    });
  }
});

// =======================
// ENDPOINT: Create Pull Request (ENHANCED)
// =======================
app.post('/create-pull-request', async (req, res) => {
  try {
    const { files, organizations, options = {} } = req.body;

    // 1. Validazione input
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ 
        error: 'Nessun file selezionato',
        code: 'NO_FILES'
      });
    }

    // 2. Pre-validazione
    const validation = await xmlValidator.validateBatch(files);
    if (!validation.allValid) {
      return res.status(400).json({
        error: 'Alcuni file non sono validi',
        code: 'VALIDATION_FAILED',
        validation
      });
    }

    // 3. Prepara metadata per PR
    const entiList = files.map(f => {
      const fileData = filesData.find(fd => fd.filename === f.filename);
      return {
        filename: f.filename,
        ente: getOrganizationName(fileData?.organization),
        dataCreazione: fileData?.creationDate
      };
    });

    const metadata = {
      organizations: Array.isArray(organizations) ? organizations : [],
      enti: entiList,
      template: config.prTemplate || null,
      draft: options.draft || false,
      reviewers: options.reviewers || config.defaultReviewers || [],
      labels: options.labels || ['spid', 'metadata']
    };

    // 4. Crea PR con retry
    const prResult = await githubService.createPullRequestWithRetry(
      files,
      metadata,
      3 // max retries
    );

    // 5. Aggiungi allo storico
    const historyEntry = prHistory.add({
      ...prResult,
      enti: entiList
    });

    // 6. Invia notifiche
    await notifications.notifyPRCreated({
      ...prResult,
      organizations: metadata.organizations
    });

    // 7. Risposta
    res.json({
      success: true,
      pr: prResult,
      historyId: historyEntry.id,
      message: `Pull request #${prResult.number} creata con successo`
    });

  } catch (error) {
    console.error('❌ Errore creazione PR:', error);
    
    // Gestione errori specifici
    let errorResponse = {
      success: false,
      error: error.message || 'Errore sconosciuto',
      code: 'PR_CREATION_FAILED'
    };

    if (error.message.includes('401')) {
      errorResponse.code = 'UNAUTHORIZED';
      errorResponse.error = 'Token GitHub non valido o scaduto';
    } else if (error.message.includes('404')) {
      errorResponse.code = 'REPO_NOT_FOUND';
      errorResponse.error = 'Repository non trovato o non accessibile';
    } else if (error.message.includes('403')) {
      errorResponse.code = 'FORBIDDEN';
      errorResponse.error = 'Permessi insufficienti per creare PR';
    }

    res.status(500).json(errorResponse);
  }
});

// =======================
// ENDPOINT: PR History
// =======================

// Get all history
app.get('/pr-history', (req, res) => {
  try {
    const history = prHistory.getAll();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get history with filters
app.post('/pr-history/filter', (req, res) => {
  try {
    const filtered = prHistory.filter(req.body);
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get statistics
app.get('/pr-history/stats', (req, res) => {
  try {
    const stats = prHistory.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export to CSV
app.get('/pr-history/export/csv', (req, res) => {
  try {
    const csv = prHistory.exportToCSV();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=pr-history.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update PR status
app.post('/pr-history/update-status/:prNumber', async (req, res) => {
  try {
    const prNumber = parseInt(req.params.prNumber);
    
    // Ottieni stato da GitHub
    const status = await githubService.getPRStatus(prNumber);
    
    if (status.error) {
      return res.status(404).json({ error: status.error });
    }

    // Aggiorna storico
    const updated = prHistory.updateStatus(prNumber, status);
    
    if (!updated) {
      return res.status(404).json({ error: 'PR non trovata nello storico' });
    }

    // Notifica se merged
    if (status.merged && !updated.merged) {
      await notifications.notifyPRMerged(updated);
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =======================
// HELPER FUNCTIONS
// =======================

function getOrganizationName(org) {
  if (!org || !org['md:OrganizationDisplayName']) return 'Senza Nome';
  const val = org['md:OrganizationDisplayName'];
  if (Array.isArray(val)) return val.map(e => e._ || e).join(' / ');
  return val._ || val;
}

// =======================
// START SERVER
// =======================

const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  console.log(`🚀 Server avviato su porta ${PORT}`);
  console.log(`🔗 http://localhost:${PORT}`);
  
  // Verifica connessione GitHub all'avvio
  try {
    const tokenValid = await githubService.validateToken();
    const repoValid = await githubService.validateRepository();
    
    if (tokenValid.valid && repoValid.valid) {
      console.log(`✅ GitHub: connesso come ${tokenValid.user}`);
      console.log(`✅ Repository: ${config.repo}`);
    } else {
      console.warn('⚠️  GitHub: problemi di connessione o autenticazione');
      if (!tokenValid.valid) console.warn('   - Token non valido');
      if (!repoValid.valid) console.warn('   - Repository non accessibile');
    }
  } catch (error) {
    console.error('❌ Errore verifica GitHub:', error.message);
  }
});
