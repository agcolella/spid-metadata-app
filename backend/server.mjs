import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

import config from './config/config.js';
import { GitHubService } from './services/GitHubService.js';
import { XMLValidationService } from './services/XMLValidationService.js';
import { PRTemplateService } from './services/PRTemplateService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// ============================================
// CORS
// ============================================

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://spid-metadata-app.vercel.app'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS bloccato per origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.options('*', cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// SERVIZI
// ============================================

const githubService = new GitHubService();
const xmlValidator = new XMLValidationService();
const prTemplateService = new PRTemplateService(config);

// ============================================
// DIRECTORY
// ============================================

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const SAVED_XML_DIR = path.join(__dirname, 'saved-xml');

[UPLOAD_DIR, SAVED_XML_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ============================================
// MULTER
// ============================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
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
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ============================================
// UTILITY
// ============================================

function moveToSavedXml(tempPath, originalFilename) {
  const destPath = path.join(SAVED_XML_DIR, originalFilename);
  if (fs.existsSync(destPath)) {
    const ext = path.extname(originalFilename);
    const base = path.basename(originalFilename, ext);
    const newName = `${base}-${Date.now()}${ext}`;
    const newDestPath = path.join(SAVED_XML_DIR, newName);
    fs.renameSync(tempPath, newDestPath);
    return newName;
  }
  fs.renameSync(tempPath, destPath);
  return originalFilename;
}

function readSavedXml(filename) {
  const filePath = path.join(SAVED_XML_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error('File non trovato');
  return fs.readFileSync(filePath, 'utf-8');
}

async function listSavedXmlFiles() {
  const files = fs.readdirSync(SAVED_XML_DIR).filter(f => f.endsWith('.xml'));

  const filesData = await Promise.all(files.map(async (filename) => {
    const filePath = path.join(SAVED_XML_DIR, filename);
    const stats = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const validation = await xmlValidator.validate(content, filename);

    // Leggi data originale da .meta.json se disponibile
    const metaPath = path.join(SAVED_XML_DIR, `${filename}.meta.json`);
    let creationDate = stats.birthtime.getTime() > 0 ? stats.birthtime : stats.mtime;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.originalDate) creationDate = new Date(meta.originalDate);
      } catch { /* ignora errori parsing meta */ }
    }

    return {
      filename,
      size: stats.size,
      creationDate,
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

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    config: {
      repository: config.repo,
      baseBranch: config.baseBranch,
      validationEnabled: config.validation?.enabled,
      maxFilesPerPR: config.maxFilesPerPR
    }
  });
});

app.get('/validate-github', async (req, res) => {
  try {
    const result = await githubService.validateAccess();
    res.json(result);
  } catch (error) {
    res.status(500).json({ valid: false, error: error.message });
  }
});

// ============================================
// ENDPOINTS - FILE MANAGEMENT
// ============================================

app.get('/files', async (req, res) => {
  try {
    const { search } = req.query;
    let files = await listSavedXmlFiles();
    if (search) {
      const s = search.toLowerCase();
      files = files.filter(f =>
        f.filename.toLowerCase().includes(s) ||
        f.entityID?.toLowerCase().includes(s) ||
        f.organizationName?.toLowerCase().includes(s)
      );
    }
    res.json(files);
  } catch (error) {
    console.error('Errore listaggio file:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/files/:filename/content', async (req, res) => {
  try {
    const filePath = path.join(SAVED_XML_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File non trovato' });
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/upload', upload.single('xmlFile'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });

    const originalName = req.file.originalname;
    const tempPath = req.file.path;
    const xmlContent = fs.readFileSync(tempPath, 'utf-8');
    const validation = await xmlValidator.validate(xmlContent, originalName);

    if (config.validation?.strictMode && !validation.valid) {
      fs.unlinkSync(tempPath);
      return res.status(400).json({ error: 'File non valido', validation });
    }

    const savedFilename = moveToSavedXml(tempPath, originalName);
    const savedPath = path.join(SAVED_XML_DIR, savedFilename);
    const stats = fs.statSync(savedPath);

    // Salva data originale dal filesystem del client
    const lastModified = req.body.lastModified;
    const metaPath = path.join(SAVED_XML_DIR, `${savedFilename}.meta.json`);
    fs.writeFileSync(metaPath, JSON.stringify({
      originalDate: lastModified ? new Date(parseInt(lastModified)).toISOString() : null
    }));

    res.json({
      success: true,
      filename: savedFilename,
      creationDate: stats.birthtime,
      modificationDate: stats.mtime,
      validation
    });

  } catch (error) {
    console.error('Errore upload:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error.message });
  }
});

app.post('/get-xml-contents', async (req, res) => {
  try {
    const { filenames } = req.body;
    if (!Array.isArray(filenames)) return res.status(400).json({ error: 'filenames deve essere un array' });
    const results = filenames.map(filename => {
      try {
        return { filename, content: readSavedXml(filename), success: true };
      } catch (error) {
        return { filename, error: error.message, success: false };
      }
    });
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/delete-xml-files', async (req, res) => {
  try {
    const { filenames } = req.body;
    if (!Array.isArray(filenames)) return res.status(400).json({ error: 'filenames deve essere un array' });

    const results = filenames.map(filename => {
      try {
        const filePath = path.join(SAVED_XML_DIR, filename);
        const metaPath = path.join(SAVED_XML_DIR, `${filename}.meta.json`);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath); // rimuovi anche il meta
          return { filename, success: true };
        }
        return { filename, success: false, error: 'File non trovato' };
      } catch (error) {
        return { filename, success: false, error: error.message };
      }
    });

    res.json({ success: true, deleted: results.filter(r => r.success).length, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ENDPOINTS - PULL REQUEST
// ============================================

app.post('/preview-pull-request', async (req, res) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Nessun file specificato' });
    }

    const filesData = [];
    const organizations = new Set();
    const allErrors = [];
    const allWarnings = [];

    for (const filename of files) {
      const content = readSavedXml(filename);
      const validation = await xmlValidator.validate(content, filename);
      filesData.push({ filename, content, entityID: validation.entityID, organizationName: validation.organizationName, validation });
      if (validation.organizationName) organizations.add(validation.organizationName);
      if (validation.errors) allErrors.push(...validation.errors.map(e => `${filename}: ${typeof e === 'object' ? e.message : e}`));
      if (validation.warnings) allWarnings.push(...validation.warnings.map(w => `${filename}: ${typeof w === 'object' ? w.message : w}`));
    }

    const duplicates = xmlValidator.checkDuplicates ? xmlValidator.checkDuplicates(filesData) : [];
    const organizationsList = Array.from(organizations);
    const title = prTemplateService.generateTitle(files.length, organizationsList);
    const body = prTemplateService.generateBody(filesData, organizationsList, { errors: allErrors, warnings: allWarnings, duplicates });

    res.json({ title, body, fileCount: files.length, organizations: organizationsList, validation: { errors: allErrors, warnings: allWarnings, duplicates } });
  } catch (error) {
    console.error('Errore anteprima PR:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/create-pull-request', async (req, res) => {
  try {
    const { files, organizations, draft = false } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Nessun file specificato' });
    }

    console.log('🚀 Inizio creazione Pull Request');
    console.log(`   - File: ${files.length}`);
    console.log(`   - Organizzazioni: ${organizations?.length || 0}`);

    const accessCheck = await githubService.validateAccess();
    if (!accessCheck.valid) throw new Error('Accesso GitHub non valido');
    console.log(`✅ Accesso a ${config.repo} validato`);

    const filesData = [];
    const allErrors = [];
    const allWarnings = [];

    for (const filename of files) {
      const content = readSavedXml(filename);
      const validation = await xmlValidator.validate(content, filename);
      filesData.push({ filename, content, entityID: validation.entityID, organizationName: validation.organizationName, validation });
      if (validation.errors) allErrors.push(...validation.errors);
      if (validation.warnings) allWarnings.push(...validation.warnings);
    }

    if (config.validation?.strictMode && allErrors.length > 0) {
      return res.status(400).json({ error: 'Validazione fallita', errors: allErrors });
    }

    const duplicates = xmlValidator.checkDuplicates ? xmlValidator.checkDuplicates(filesData) : [];

    const baseBranch = config.baseBranch || process.env.BASE_BRANCH || 'main';
    console.log(`📌 Recupero SHA del branch base: ${baseBranch}`);
    const baseSha = await githubService.getBaseBranchSha(baseBranch);
    console.log(`✅ SHA branch base: ${baseSha}`);

    const branchName = prTemplateService.generateBranchName();
    console.log(`🌿 Nome branch: ${branchName}`);

    const branchResult = await githubService.createBranchWithRetry(branchName, baseSha);
    if (!branchResult.success) throw new Error('Impossibile creare branch');

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
      onProgress: (current, total) => console.log(`   Progresso: ${current}/${total}`)
    });

    if (uploadResult.errors.length > 0) {
      console.warn(`⚠️  ${uploadResult.errors.length} file con errori upload`);
    }

    const organizationsList = organizations || Array.from(new Set(filesData.map(f => f.organizationName).filter(Boolean)));
    const prTitle = prTemplateService.generateTitle(files.length, organizationsList);
    const prBody = prTemplateService.generateBody(filesData, organizationsList, { errors: allErrors, warnings: allWarnings, duplicates });

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

app.get('/pr-status/:number', async (req, res) => {
  try {
    const { number } = req.params;
    const [owner, repo] = config.repo.split('/');
    const ghRes = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
      {
        headers: {
          Authorization: `token ${config.githubToken}`,
          Accept: 'application/vnd.github.v3+json'
        }
      }
    );
    const pr = ghRes.data;
    const status = pr.merged ? 'merged' : pr.state;
    res.json({ number: pr.number, status, state: pr.state, merged: pr.merged, draft: pr.draft, url: pr.html_url, title: pr.title });
  } catch (error) {
    console.error('Errore fetch PR status GitHub:', error.response?.data || error.message);
    res.status(500).json({ error: 'Impossibile recuperare stato PR da GitHub' });
  }
});

// ============================================
// ENDPOINT DEBUG (solo development)
// ============================================

if (process.env.NODE_ENV === 'development') {
  app.get('/debug/collaborators', async (req, res) => {
    try {
      const [owner, repo] = config.repo.split('/');
      const { data } = await githubService.octokit.rest.repos.listCollaborators({ owner, repo });
      res.json({
        repository: config.repo,
        collaborators: data.map(c => ({ username: c.login, permissions: c.permissions })),
        configuredReviewers: config.reviewers || []
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/debug/branch-info', async (req, res) => {
    try {
      const baseBranch = config.baseBranch || 'main';
      const exists = await githubService.branchExists(baseBranch);
      const sha = exists ? await githubService.getBaseBranchSha(baseBranch) : null;
      res.json({ repository: config.repo, baseBranch, branchExists: exists, sha, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });
}

// ============================================
// ERROR HANDLING
// ============================================

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint non trovato' });
});

app.use((err, req, res, next) => {
  console.error('Errore server:', err);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File troppo grande (max 5MB)' });
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({
    error: 'Errore interno del server',
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ============================================
// START SERVER
// ============================================

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

process.on('SIGTERM', () => { console.log('SIGTERM ricevuto, chiusura server...'); process.exit(0); });
process.on('SIGINT', () => { console.log('\nSIGINT ricevuto, chiusura server...'); process.exit(0); });
