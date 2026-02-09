import { Octokit } from "@octokit/rest";
import config from '../config/config.js';

export class GitHubService {
  constructor() {
    this.octokit = new Octokit({ 
      auth: process.env.GITHUB_TOKEN || config.githubToken 
    });
    this.config = config;
  }

  // Valida accesso al repository
  async validateAccess() {
    try {
      const [owner, repo] = this.config.repo.split('/');
      await this.octokit.rest.repos.get({ owner, repo });
      
      console.log(`✅ Accesso a ${this.config.repo} validato`);
      return { valid: true };
    } catch (error) {
      console.error('❌ Errore validazione GitHub:', error.message);
      return { 
        valid: false, 
        error: error.message,
        type: error.status === 401 ? 'authentication' : error.status === 404 ? 'repository' : 'unknown'
      };
    }
  }

  // Verifica se un branch esiste
  async branchExists(branchName) {
    try {
      const [owner, repo] = this.config.repo.split('/');
      await this.octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branchName}`
      });
      return true;
    } catch (error) {
      if (error.status === 404) return false;
      console.error(`Errore verifica branch ${branchName}:`, error.message);
      throw error;
    }
  }

  // Ottiene SHA del branch base
  async getBaseBranchSha(branchName) {
    try {
      const [owner, repo] = this.config.repo.split('/');
      const { data } = await this.octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branchName}`
      });
      return data.object.sha;
    } catch (error) {
      if (error.status === 404) {
        throw new Error(`Branch base '${branchName}' non trovato nel repository`);
      }
      throw error;
    }
  }

  // Crea branch con retry
  async createBranchWithRetry(branchName, baseSha, maxRetries = 3) {
    const [owner, repo] = this.config.repo.split('/');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Tentativo ${attempt}/${maxRetries} - Creazione branch: ${branchName}`);
        
        // Verifica che il branch NON esista già
        const exists = await this.branchExists(branchName);
        if (exists) {
          const error = new Error(`Branch ${branchName} già esistente`);
          error.code = 'BRANCH_EXISTS';
          throw error;
        }

        // Verifica SHA valido
        if (!baseSha || baseSha.length !== 40) {
          throw new Error(`SHA non valido: ${baseSha}`);
        }

        // Crea il branch
        const result = await this.octokit.rest.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${branchName}`,
          sha: baseSha
        });
        
        console.log(`✅ Branch creato: ${branchName}`);
        return { 
          success: true, 
          branch: branchName,
          ref: result.data.ref
        };
        
      } catch (error) {
        console.error(`❌ Tentativo ${attempt} fallito:`, error.message);
        
        // Non fare retry per questi errori
        if (error.code === 'BRANCH_EXISTS' || error.message.includes('SHA')) {
          throw error;
        }
        
        // Ultimo tentativo
        if (attempt === maxRetries) {
          throw new Error(`Impossibile creare branch dopo ${maxRetries} tentativi: ${error.message}`);
        }
        
        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`⏳ Attesa di ${delay}ms prima del prossimo tentativo...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // Upload file su branch
  async uploadFileToBranch({ branch, filePath, content, message }) {
    const [owner, repo] = this.config.repo.split('/');

    try {
      // Verifica se il file esiste già
      let sha;
      try {
        const { data } = await this.octokit.rest.repos.getContent({
          owner,
          repo,
          path: filePath,
          ref: branch
        });
        sha = data.sha;
      } catch (error) {
        // File non esiste, ok
        if (error.status !== 404) throw error;
      }

      // Crea/aggiorna file
      const result = await this.octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message,
        content: Buffer.from(content).toString('base64'),
        branch,
        sha // undefined se nuovo file
      });

      return {
        success: true,
        path: filePath,
        sha: result.data.content.sha
      };
    } catch (error) {
      throw new Error(`Errore upload ${filePath}: ${error.message}`);
    }
  }

  // Upload multiplo con concorrenza
  async uploadFilesInBatches({ branch, files, concurrency = 5, onProgress }) {
    const results = [];
    const errors = [];

    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);
      
      const promises = batch.map(async (file) => {
        try {
          const result = await this.uploadFileToBranch({
            branch,
            filePath: file.path,
            content: file.content,
            message: file.message || `Add ${file.filename}`
          });
          
          results.push(result);
          
          if (onProgress) {
            onProgress(results.length, files.length);
          }
          
          return result;
        } catch (error) {
          console.error(`❌ Errore upload ${file.filename}:`, error.message);
          errors.push({
            filename: file.filename,
            error: error.message
          });
          return null;
        }
      });

      await Promise.all(promises);
      
      // Piccolo delay tra batch per non sovraccaricare API
      if (i + concurrency < files.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return { results, errors };
  }

  // Crea Pull Request
  async createPullRequest({ 
    branch, 
    base, 
    title, 
    body, 
    draft = false,
    labels = [],
    reviewers = []
  }) {
    const [owner, repo] = this.config.repo.split('/');
    
    try {
      // 1. Crea la Pull Request
      console.log(`📝 Creazione PR: ${title}`);
      const prData = await this.octokit.rest.pulls.create({
        owner,
        repo,
        title,
        head: branch,
        base,
        body,
        draft
      });

      const prNumber = prData.data.number;
      const prUrl = prData.data.html_url;
      console.log(`✅ PR #${prNumber} creata: ${prUrl}`);

      // 2. Aggiungi label (se specificati)
      if (labels.length > 0) {
        try {
          console.log(`🏷️  Aggiunta label: ${labels.join(', ')}`);
          await this.octokit.rest.issues.addLabels({
            owner,
            repo,
            issue_number: prNumber,
            labels
          });
          console.log(`✅ Label aggiunte`);
        } catch (error) {
          console.warn(`⚠️  Impossibile aggiungere label: ${error.message}`);
        }
      }

      // 3. Richiedi reviewer (solo se specificati)
      if (reviewers.length > 0) {
        try {
          console.log(`👥 Richiesta review a: ${reviewers.join(', ')}`);
          await this.octokit.rest.pulls.requestReviewers({
            owner,
            repo,
            pull_number: prNumber,
            reviewers
          });
          console.log(`✅ Reviewer richiesti`);
        } catch (error) {
          console.warn(`⚠️  Impossibile richiedere reviewer: ${error.message}`);
          console.warn(`💡 Suggerimento: Aggiungi i reviewer come collaboratori del repository`);
        }
      }

      return {
        success: true,
        url: prUrl,
        number: prNumber,
        branch
      };
    } catch (error) {
      throw new Error(`Errore creazione PR: ${error.message}`);
    }
  }

  // Ottieni stato PR
  async getPRStatus(prNumber) {
    const [owner, repo] = this.config.repo.split('/');
    
    try {
      const { data } = await this.octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      });

      return {
        number: data.number,
        state: data.state,
        merged: data.merged,
        draft: data.draft,
        url: data.html_url,
        title: data.title
      };
    } catch (error) {
      throw new Error(`Errore recupero stato PR #${prNumber}: ${error.message}`);
    }
  }
}
