import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

// Servizi
import config from './config/config.js';
import { GitHubService } from './services/GitHubService.js';
import { XMLValidatorService } from './services/XMLValidatorService.js';
import { PRTemplateService } from './services/PRTemplateService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://spid-metadata-app.vercel.app/' // ← aggiungi dopo
  ]
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Inizializza servizi
const githubService = new GitHubService();
const xmlValidator = new XMLValidatorService(config);
const prTemplateService = new PRTemplateService(config);

// Directory per file caricati
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const SAVED_XML_DIR = path.join(__dirname, 'saved-xml');

// Crea directory se non esistono
[UPLOAD_DIR, SAVED_XML_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configurazione multer per upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.xml') {
      return cb(new Error('Solo file .xml sono permessi'));
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max
  }
});

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Sposta file da uploads a saved-xml
function moveToSavedXml(tempPath, originalFilename) {
  const destPath = path.join(SAVED_XML_DIR, originalFilename);
  
  // Se esiste già, aggiungi timestamp
  if (fs.existsSync(destPath)) {
    const ext = path.extname(originalFilename);
    const base = path.basename(originalFilename, ext);
    const timestamp = Date.now();
    const newName = `${base}-${timestamp}${ext}`;
    const newDestPath = path.join(SAVED_XML_DIR, newName);
    fs.renameSync(tempPath, newDestPath);
    return newName;
  }
  
  fs.renameSync(tempPath, destPath);
  return originalFilename;
}

// Leggi file XML salvato
function readSavedXml(filename) {
  const filePath = path.join(SAVED_XML_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error('File non trovato');
  }
  return fs.readFileSync(filePath, 'utf-8');
}


// Lista tutti i file XML salvati con metadati
async function listSavedXmlFiles() {
  const files = fs.readdirSync(SAVED_XML_DIR).filter(f => f.endsWith('.xml'));
  
  const filesData = await Promise.all(files.map(async (filename) => {
    const filePath = path.join(SAVED_XML_DIR, filename);
    const stats = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Valida e estrai metadati
    const validation = await xmlValidator.validate(content, filename);
    
    // Usa birthtime (data creazione) o mtime se birthtime non disponibile
    // Su alcuni filesystem birthtime potrebbe essere uguale a mtime
    const creationDate = stats.birthtime.getTime() > 0 ? stats.birthtime : stats.mtime;
    
    return {
      filename,
      size: stats.size,
      creationDate: creationDate,  // Data reale di creazione del file
      modificationDate: stats.mtime,
      entityID: validation.entityID || null,
      organizationName: validation.organizationName || null,
      validation: {
        valid: validation.valid,
        errors: validation.errors || [],
        warnings: validation.warnings || []
      }
    };
  }));
  
  return filesData;
}



// ============================================
// ENDPOINTS - HEALTH & CONFIG
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    config: {
      repository: config.repo,
      baseBranch: config.baseBranch,
      validationEnabled: config.validation.enabled,
      maxFilesPerPR: config.maxFilesPerPR
    }
  });
});

// Valida accesso GitHub
app.get('/validate-github', async (req, res) => {
  try {
    const result = await githubService.validateAccess();
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      valid: false, 
      error: error.message 
    });
  }
});

// ============================================
// ENDPOINTS - FILE MANAGEMENT
// ============================================

// Lista file caricati
app.get('/files', async (req, res) => {
  try {
    const { search } = req.query;
    let files = await listSavedXmlFiles();
    
    // Filtro ricerca
    if (search) {
      const searchLower = search.toLowerCase();
      files = files.filter(f => 
        f.filename.toLowerCase().includes(searchLower) ||
        f.entityID?.toLowerCase().includes(searchLower) ||
        f.organizationName?.toLowerCase().includes(searchLower)
      );
    }
    
    res.json(files);
  } catch (error) {
    console.error('Errore listaggio file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload singolo file
app.post('/upload', upload.single('xmlFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file caricato' });
    }

    const originalName = req.file.originalname;
    const tempPath = req.file.path;

    // Leggi contenuto
    const xmlContent = fs.readFileSync(tempPath, 'utf-8');

    // Valida XML
    const validation = await xmlValidator.validate(xmlContent, originalName);

    // Se validazione fallisce in strict mode, rifiuta
    if (config.validation.strictMode && !validation.valid) {
      fs.unlinkSync(tempPath); // Rimuovi file temporaneo
      return res.status(400).json({
        error: 'File non valido',
        validation
      });
    }

    // Sposta in saved-xml
    const savedFilename = moveToSavedXml(tempPath, originalName);

    // AGGIUNGI: Recupera le stats del file appena salvato
    const savedPath = path.join(SAVED_XML_DIR, savedFilename);
    const stats = fs.statSync(savedPath);


    res.json({
      success: true,
      filename: savedFilename,
      creationDate: stats.birthtime,  // Data reale di creazione
      modificationDate: stats.mtime,
      validation
    });

  } catch (error) {
    console.error('Errore upload:', error);
    
    // Pulizia file temporaneo in caso di errore
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Recupera contenuto XML
app.post('/get-xml-contents', async (req, res) => {
  try {
    const { filenames } = req.body;

    if (!Array.isArray(filenames)) {
      return res.status(400).json({ error: 'filenames deve essere un array' });
    }

    const results = filenames.map(filename => {
      try {
        const content = readSavedXml(filename);
        return { filename, content, success: true };
      } catch (error) {
        return { filename, error: error.message, success: false };
      }
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Elimina file
app.post('/delete-xml-files', async (req, res) => {
  try {
    const { filenames } = req.body;

    if (!Array.isArray(filenames)) {
      return res.status(400).json({ error: 'filenames deve essere un array' });
    }

    const results = filenames.map(filename => {
      try {
        const filePath = path.join(SAVED_XML_DIR, filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          return { filename, success: true };
        } else {
          return { filename, success: false, error: 'File non trovato' };
        }
      } catch (error) {
        return { filename, success: false, error: error.message };
      }
    });

    const deletedCount = results.filter(r => r.success).length;
    
    res.json({
      success: true,
      deleted: deletedCount,
      results
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ENDPOINTS - PULL REQUEST
// ============================================

// Anteprima Pull Request
app.post('/preview-pull-request', async (req, res) => {
  try {
    const { files } = req.body;

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Nessun file specificato' });
    }

    // Carica contenuti e metadati
    const filesData = [];
    const organizations = new Set();
    const allErrors = [];
    const allWarnings = [];

    for (const filename of files) {
      const content = readSavedXml(filename);
      const validation = await xmlValidator.validate(content, filename);

      filesData.push({
        filename,
        content,
        entityID: validation.entityID,
        organizationName: validation.organizationName,
        validation
      });

      if (validation.organizationName) {
        organizations.add(validation.organizationName);
      }

      if (validation.errors) {
        allErrors.push(...validation.errors.map(e => `${filename}: ${e}`));
      }

      if (validation.warnings) {
        allWarnings.push(...validation.warnings.map(w => `${filename}: ${w}`));
      }
    }

    // Verifica duplicati
    const duplicates = xmlValidator.checkDuplicates(filesData);

    // Genera titolo e corpo PR
    const organizationsList = Array.from(organizations);
    const title = prTemplateService.generateTitle(files.length, organizationsList);
    const body = prTemplateService.generateBody(filesData, organizationsList, {
      errors: allErrors,
      warnings: allWarnings,
      duplicates
    });

    res.json({
      title,
      body,
      fileCount: files.length,
      organizations: organizationsList,
      validation: {
        errors: allErrors,
        warnings: allWarnings,
        duplicates
      }
    });

  } catch (error) {
    console.error('Errore anteprima PR:', error);
    res.status(500).json({ error: error.message });
  }
});

// Crea Pull Request
app.post('/create-pull-request', async (req, res) => {
  try {
    const { files, organizations, draft = false } = req.body;

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Nessun file specificato' });
    }

    console.log('🚀 Inizio creazione Pull Request');
    console.log(`   - File: ${files.length}`);
    console.log(`   - Organizzazioni: ${organizations?.length || 0}`);

    // 1. Valida accesso GitHub
    const accessCheck = await githubService.validateAccess();
    if (!accessCheck.valid) {
      throw new Error('Accesso GitHub non valido');
    }

    // 2. Carica file e valida
    const filesData = [];
    const allErrors = [];
    const allWarnings = [];

    for (const filename of files) {
      const content = readSavedXml(filename);
      const validation = await xmlValidator.validate(content, filename);

      filesData.push({
        filename,
        content,
        entityID: validation.entityID,
        organizationName: validation.organizationName,
        validation
      });

      if (validation.errors) {
        allErrors.push(...validation.errors);
      }
      if (validation.warnings) {
        allWarnings.push(...validation.warnings);
      }
    }

    // Blocca se ci sono errori in strict mode
    if (config.validation.strictMode && allErrors.length > 0) {
      return res.status(400).json({
        error: 'Validazione fallita',
        errors: allErrors
      });
    }

    // 3. Verifica duplicati
    const duplicates = xmlValidator.checkDuplicates(filesData);

    // 4. Ottieni SHA del branch base
    const baseBranch = config.baseBranch || 'main';
    console.log(`📌 Recupero SHA del branch base: ${baseBranch}`);
    
    const baseSha = await githubService.getBaseBranchSha(baseBranch);
    console.log(`✅ SHA branch base: ${baseSha}`);

    // 5. Genera nome branch
    const branchName = prTemplateService.generateBranchName();
    console.log(`🌿 Nome branch: ${branchName}`);

    // 6. Crea branch
    console.log('🌿 Creazione branch...');
    const branchResult = await githubService.createBranchWithRetry(
      branchName,
      baseSha
    );

    if (!branchResult.success) {
      throw new Error('Impossibile creare branch');
    }

    // 7. Upload file al branch
    console.log('📤 Upload file al branch...');
    
    const filesToUpload = filesData.map(file => ({
      filename: file.filename,
      path: `metadata/${file.filename}`,
      content: file.content,
      message: `Add ${file.organizationName || file.filename}`
    }));

    const uploadResult = await githubService.uploadFilesInBatches({
      branch: branchName,
      files: filesToUpload,
      concurrency: config.uploadConcurrency || 5,
      onProgress: (current, total) => {
        console.log(`   Progresso: ${current}/${total}`);
      }
    });

    if (uploadResult.errors.length > 0) {
      console.warn(`⚠️  ${uploadResult.errors.length} file con errori upload`);
    }

    // 8. Genera titolo e corpo PR
    const organizationsList = organizations || Array.from(new Set(
      filesData.map(f => f.organizationName).filter(Boolean)
    ));

    const prTitle = prTemplateService.generateTitle(files.length, organizationsList);
    const prBody = prTemplateService.generateBody(filesData, organizationsList, {
      errors: allErrors,
      warnings: allWarnings,
      duplicates
    });

    // 9. Crea Pull Request
    console.log('📝 Creazione Pull Request...');
    
    const prResult = await githubService.createPullRequest({
      branch: branchName,
      base: baseBranch,
      title: prTitle,
      body: prBody,
      draft,
      labels: config.labels || [],
      reviewers: config.reviewers || []
    });

    console.log(`✅ Pull Request creata: ${prResult.url}`);

    res.json({
      success: true,
      url: prResult.url,
      number: prResult.number,
      branch: branchName,
      filesUploaded: uploadResult.results.length,
      uploadErrors: uploadResult.errors
    });

  } catch (error) {
    console.error('❌ Errore creazione PR:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Ottieni stato PR
//app.get('/pr-status/:prNumber', async (req, res) => {
//  try {
//    const { prNumber } = req.params;
//    const status = await githubService.getPRStatus(parseInt(prNumber));
//    res.json(status);
//  } catch (error) {
//    res.status(500).json({ error: error.message });
//  }
//});

// ============================================
// ENDPOINTS - PULL REQUEST STATUS
// ============================================


app.get('/pr-status/:number', async (req, res) => {
  try {
    const { number } = req.params;

    // GITHUB_REPO es: "owner/repo-name"
    //const [owner, repo] = process.env.GITHUB_REPO.split('/');
    const [owner, repo] = config.repo.split('/');
    const ghRes = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
      {
        headers: {
          //Authorization: `token ${process.env.GITHUB_TOKEN}`,
          Authorization: `token ${config.githubToken}`,
          Accept: 'application/vnd.github.v3+json'
        }
      }
    );

    const pr = ghRes.data;

        // SE merged === true → "merged", altrimenti usa state ("open" | "closed")
    const status = pr.merged ? 'merged' : pr.state;  // ← punto chiave [web:5][web:18]

    res.json({
      number: pr.number,
      status,          // "open" | "closed" | "merged"
      state: pr.state, // "open" | "closed"
      merged: pr.merged,
      draft: pr.draft,
      url: pr.html_url,
      title: pr.title
    });
    //console.log(`✅ Status Pull Request: ${status}`);
  } catch (error) {
    console.error('Errore fetch PR status GitHub:', error.response?.data || error.message);
    res.status(500).json({ error: 'Impossibile recuperare stato PR da GitHub' });
  }
});


// ============================================
// ENDPOINT DEBUG (solo development)
// ============================================

if (process.env.NODE_ENV === 'development') {
  // Info collaboratori
  app.get('/debug/collaborators', async (req, res) => {
    try {
      const [owner, repo] = config.repo.split('/');
      
      const { data } = await githubService.octokit.rest.repos.listCollaborators({
        owner,
        repo
      });
      
      const collaborators = data.map(c => ({
        username: c.login,
        permissions: c.permissions
      }));
      
      res.json({
        repository: config.repo,
        collaborators,
        configuredReviewers: config.reviewers || []
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Info branch
  app.get('/debug/branch-info', async (req, res) => {
    try {
      const baseBranch = config.baseBranch || 'main';
      
      const exists = await githubService.branchExists(baseBranch);
      const sha = exists ? await githubService.getBaseBranchSha(baseBranch) : null;
      
      res.json({
        repository: config.repo,
        baseBranch,
        branchExists: exists,
        sha,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: error.message,
        stack: error.stack
      });
    }
  });
}

// ============================================
// ERROR HANDLING & START SERVER
// ============================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint non trovato' });
});

// Error handler globale
app.use((err, req, res, next) => {
  console.error('Errore server:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File troppo grande (max 5MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  
  res.status(500).json({ 
    error: 'Errore interno del server',
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Avvio server
app.listen(PORT, () => {
  console.log('');
  console.log('='.repeat(50));
  console.log('🚀 SPID Metadata App - Backend v2.0');
  console.log('='.repeat(50));
  console.log(`📡 Server in ascolto su http://localhost:${PORT}`);
  console.log(`📂 Directory XML: ${SAVED_XML_DIR}`);
  console.log(`🔧 Ambiente: ${process.env.NODE_ENV || 'production'}`);
  console.log('='.repeat(50));
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM ricevuto, chiusura server...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT ricevuto, chiusura server...');
  process.exit(0);
});
