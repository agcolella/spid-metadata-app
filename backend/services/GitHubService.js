import { Octokit } from '@octokit/rest';
import config from '../config/app-config.js';

/**
 * Service per gestione operazioni GitHub
 */
class GitHubService {
  constructor() {
    this.octokit = null;
    this.config = config.github;
  }

  /**
   * Inizializza Octokit con token di autenticazione
   */
  initialize() {
    if (!this.config.token) {
      throw new Error('GitHub token non configurato');
    }
    this.octokit = new Octokit({ 
      auth: this.config.token,
      userAgent: 'spid-metadata-app/2.0'
    });
  }

  /**
   * Verifica validità token e permessi
   */
  async validateToken() {
    try {
      const { data } = await this.octokit.users.getAuthenticated();
      const [owner, repo] = this.config.repo.split('/');
      
      // Verifica accesso al repository
      await this.octokit.repos.get({ owner, repo });
      
      return { valid: true, user: data.login };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Ottiene SHA del branch base
   */
  async getBaseBranchSha(owner, repo, baseBranch) {
    const { data } = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`
    });
    return data.object.sha;
  }

  /**
   * Crea una nuova branch, gestendo conflitti
   */
  async createBranch(owner, repo, branchName, baseSha) {
    try {
      const { data } = await this.octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: baseSha
      });
      return { success: true, data };
    } catch (error) {
      if (error.status === 422) {
        // Branch già esistente - genera nome alternativo
        const newName = `${branchName}-${Date.now()}`;
        return this.createBranch(owner, repo, newName, baseSha);
      }
      throw error;
    }
  }

  /**
   * Crea blob in parallelo con limite di concorrenza
   */
  async createBlobsBatch(owner, repo, files, concurrencyLimit = 5) {
    const results = [];
    
    for (let i = 0; i < files.length; i += concurrencyLimit) {
      const batch = files.slice(i, i + concurrencyLimit);
      const batchPromises = batch.map(file => 
        this.octokit.git.createBlob({
          owner,
          repo,
          content: file.content,
          encoding: 'utf-8'
        }).then(({ data }) => ({
          path: `xml/${file.filename}`,
          mode: '100644',
          type: 'blob',
          sha: data.sha
        }))
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * Crea tree, commit e aggiorna branch
   */
  async createCommitAndUpdate(owner, repo, branchName, baseSha, treeItems, commitMessage) {
    // Ottieni base commit
    const { data: baseCommit } = await this.octokit.git.getCommit({
      owner,
      repo,
      commit_sha: baseSha
    });

    // Crea tree
    const { data: newTree } = await this.octokit.git.createTree({
      owner,
      repo,
      base_tree: baseCommit.tree.sha,
      tree: treeItems
    });

    // Crea commit
    const { data: newCommit } = await this.octokit.git.createCommit({
      owner,
      repo,
      message: commitMessage,
      tree: newTree.sha,
      parents: [baseSha]
    });

    // Aggiorna branch
    await this.octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
      sha: newCommit.sha
    });

    return newCommit;
  }

  /**
   * Crea Pull Request con template personalizzabile
   */
  async createPullRequest(owner, repo, options) {
    const {
      title,
      head,
      base,
      body,
      draft = false,
      labels = [],
      assignees = [],
      reviewers = []
    } = options;

    const { data: pr } = await this.octokit.pulls.create({
      owner,
      repo,
      title,
      head,
      base,
      body,
      draft
    });

    // Aggiungi labels se specificati
    if (labels.length > 0) {
      await this.octokit.issues.addLabels({
        owner,
        repo,
        issue_number: pr.number,
        labels
      });
    }

    // Aggiungi assignees
    if (assignees.length > 0) {
      await this.octokit.issues.addAssignees({
        owner,
        repo,
        issue_number: pr.number,
        assignees
      });
    }

    // Richiedi review
    if (reviewers.length > 0) {
      await this.octokit.pulls.requestReviewers({
        owner,
        repo,
        pull_number: pr.number,
        reviewers
      });
    }

    return pr;
  }

  /**
   * Ottiene stato di una PR
   */
  async getPullRequestStatus(owner, repo, prNumber) {
    try {
      const { data } = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      });
      
      return {
        state: data.state,
        merged: data.merged,
        mergeable: data.mergeable,
        mergedAt: data.merged_at,
        mergedBy: data.merged_by?.login,
        draft: data.draft
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Workflow completo creazione PR con retry e gestione errori
   */
  async createPRWithRetry(files, organizations, options = {}) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const [owner, repo] = this.config.repo.split('/');
        const baseBranch = this.config.baseBranch || 'main';
        const branchPrefix = this.config.branchPrefix || 'spid-batch-';
        const branchName = `${branchPrefix}${Date.now()}`;

        // Step 1: Ottieni SHA branch base
        const baseSha = await this.getBaseBranchSha(owner, repo, baseBranch);

        // Step 2: Crea branch
        const branchResult = await this.createBranch(owner, repo, branchName, baseSha);
        const actualBranchName = branchResult.data.ref.replace('refs/heads/', '');

        // Step 3: Crea blobs in parallelo
        const treeItems = await this.createBlobsBatch(owner, repo, files, 5);

        // Step 4: Crea commit
        const commitMessage = options.commitMessage || 'Batch SPID XML upload';
        await this.createCommitAndUpdate(
          owner,
          repo,
          actualBranchName,
          baseSha,
          treeItems,
          commitMessage
        );

        // Step 5: Genera body PR dal template
        const prBody = this.generatePRBody(files.length, organizations, options);
        const prTitle = options.prTitle || `SPID: Aggiunta ${files.length} enti - ${new Date().toLocaleDateString('it-IT')}`;

        // Step 6: Crea PR
        const pr = await this.createPullRequest(owner, repo, {
          title: prTitle,
          head: actualBranchName,
          base: baseBranch,
          body: prBody,
          draft: options.draft || false,
          labels: options.labels || ['spid', 'metadata'],
          reviewers: options.reviewers || []
        });

        return {
          success: true,
          pr: {
            number: pr.number,
            url: pr.html_url,
            branch: actualBranchName,
            state: pr.state
          }
        };

      } catch (error) {
        lastError = error;
        console.error(`Tentativo ${attempt} fallito:`, error.message);
        
        if (attempt < maxRetries) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    return {
      success: false,
      error: lastError.message,
      details: lastError
    };
  }

  /**
   * Genera body della PR usando template
   */
  generatePRBody(filesCount, organizations, options = {}) {
    const template = this.config.prTemplate || this.getDefaultTemplate();
    
    let body = template.body
      .replace('{count}', filesCount)
      .replace('{organizations}', organizations.join(', '))
      .replace('{date}', new Date().toLocaleDateString('it-IT'));

    // Aggiungi informazioni aggiuntive se presenti
    if (options.notes) {
      body += `\n\n**Note:**\n${options.notes}`;
    }

    return body;
  }

  /**
   * Template di default per PR
   */
  getDefaultTemplate() {
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
}

export default new GitHubService();
