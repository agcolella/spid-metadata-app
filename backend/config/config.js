import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carica configurazione da file o environment
function loadConfig() {
  const configPath = path.join(__dirname, '..', 'repo-config.json');
  
  let fileConfig = {};
  
  // Tenta di caricare da file
  if (fs.existsSync(configPath)) {
    try {
      const rawData = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(rawData);
      console.log('✅ Configurazione caricata da repo-config.json');
    } catch (error) {
      console.warn('⚠️  Errore lettura repo-config.json:', error.message);
    }
  } else {
    console.warn('⚠️  File repo-config.json non trovato');
  }

  // Merge con variabili d'ambiente (priorità maggiore)
  const config = {
    repo: process.env.GITHUB_REPO || fileConfig.repo,
    githubToken: process.env.GITHUB_TOKEN || fileConfig.githubToken,
    baseBranch: process.env.BASE_BRANCH || fileConfig.baseBranch || 'main',
    branchPrefix: process.env.BRANCH_PREFIX || fileConfig.branchPrefix || 'spid-batch-',
    
    prTemplate: {
      title: fileConfig.prTemplate?.title || 'SPID: Aggiunta {count} metadata - {date}',
      body: fileConfig.prTemplate?.body || null
    },
    
    validation: {
      enabled: process.env.VALIDATION_ENABLED !== 'false' && (fileConfig.validation?.enabled !== false),
      strictMode: process.env.VALIDATION_STRICT_MODE === 'true' || fileConfig.validation?.strictMode === true
    },
    
    labels: fileConfig.labels || [],
    reviewers: fileConfig.reviewers || [],
    
    maxFilesPerPR: parseInt(process.env.MAX_FILES_PER_PR || fileConfig.maxFilesPerPR || 50),
    uploadConcurrency: parseInt(process.env.UPLOAD_CONCURRENCY || fileConfig.uploadConcurrency || 5)
  };

  // Validazione configurazione
  if (!config.repo) {
    throw new Error('❌ Configurazione mancante: GITHUB_REPO o repo in repo-config.json');
  }
  
  if (!config.githubToken) {
    throw new Error('❌ Configurazione mancante: GITHUB_TOKEN o githubToken in repo-config.json');
  }

  // Verifica formato repo
  if (!config.repo.includes('/')) {
    throw new Error('❌ Formato repo non valido. Deve essere: owner/repository-name');
  }

  console.log('📋 Configurazione caricata:');
  console.log(`   - Repository: ${config.repo}`);
  console.log(`   - Branch base: ${config.baseBranch}`);
  console.log(`   - Validazione: ${config.validation.enabled ? 'Abilitata' : 'Disabilitata'}`);
  console.log(`   - Strict mode: ${config.validation.strictMode ? 'Sì' : 'No'}`);
  console.log(`   - Max file per PR: ${config.maxFilesPerPR}`);
  console.log(`   - Label: ${config.labels.length > 0 ? config.labels.join(', ') : 'Nessuna'}`);
  console.log(`   - Reviewer: ${config.reviewers.length > 0 ? config.reviewers.join(', ') : 'Nessuno'}`);

  return config;
}

const defaultConfig = loadConfig();

export default defaultConfig;
