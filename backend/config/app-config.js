import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configurazione applicazione centralizzata
 * Priorità: Environment variables > config file > defaults
 */
class AppConfig {
  constructor() {
    this.loadConfig();
  }

  loadConfig() {
    // Carica da file se esiste
    const configPath = path.join(__dirname, 'repo-config.json');
    let fileConfig = {};
    
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    // GitHub configuration
    this.github = {
      token: process.env.GITHUB_TOKEN || fileConfig.githubToken,
      repo: process.env.GITHUB_REPO || fileConfig.repo,
      baseBranch: process.env.GITHUB_BASE_BRANCH || fileConfig.baseBranch || 'main',
      branchPrefix: process.env.GITHUB_BRANCH_PREFIX || fileConfig.branchPrefix || 'spid-batch-',
      prTemplate: fileConfig.prTemplate || this.getDefaultPRTemplate()
    };

    // Server configuration
    this.server = {
      port: process.env.PORT || fileConfig.serverPort || 4000,
      corsOrigin: process.env.CORS_ORIGIN || fileConfig.corsOrigin || 'http://localhost:3000'
    };

    // Storage configuration
    this.storage = {
      xmlDirectory: process.env.XML_DIR || fileConfig.xmlDirectory || 'saved-xml',
      maxFileSize: process.env.MAX_FILE_SIZE || fileConfig.maxFileSize || 10485760, // 10MB
      allowedExtensions: ['.xml']
    };

    // PR options
    this.prOptions = {
      defaultDraft: fileConfig.defaultDraft || false,
      defaultLabels: fileConfig.defaultLabels || ['spid', 'metadata'],
      defaultReviewers: fileConfig.defaultReviewers || [],
      autoAssign: fileConfig.autoAssign || false
    };

    // Validation options
    this.validation = {
      strict: fileConfig.strictValidation || false,
      checkCertificates: fileConfig.checkCertificates !== false,
      checkEntityIDReachable: fileConfig.checkEntityIDReachable || false
    };

    // Registry API
    this.registry = {
      baseUrl: 'https://registry.spid.gov.it',
      timeout: 5000,
      retryAttempts: 3
    };
  }

  getDefaultPRTemplate() {
    return {
      title: 'SPID: Aggiunta {count} enti - {date}',
      body: `## 📋 Metadata SPID

**Numero file:** {count}  
**Organizzazioni:** {organizations}

### ✅ Checklist

- [ ] Validazione XML completata
- [ ] Certificati verificati
- [ ] EntityID testati
- [ ] Conformità schema SPID

### 📊 Informazioni

Data creazione: {date}  
Generato automaticamente da SPID Metadata App v2.0`
    };
  }

  validate() {
    const errors = [];

    if (!this.github.token) {
      errors.push('GitHub token non configurato (GITHUB_TOKEN env var o githubToken in config)');
    }

    if (!this.github.repo) {
      errors.push('GitHub repository non configurato (GITHUB_REPO env var o repo in config)');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export default new AppConfig();
