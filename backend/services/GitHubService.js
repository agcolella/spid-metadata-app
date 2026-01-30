import { Octokit } from '@octokit/rest';

/**
 * Service per gestire tutte le interazioni con GitHub API
 */
export class GitHubService {
  constructor(config) {
    this.config = config;
    this.octokit = new Octokit({ auth: config.githubToken });
    this.owner = config.repo.split('/')[0];
    this.repo = config.repo.split('/')[1];
    this.baseBranch = config.baseBranch || 'main';
  }

  /**
   * Verifica validità del token e permessi
   */
  async validateToken() {
    try {
      const { data } = await this.octokit.users.getAuthenticated();
      return { valid: true, user: data.login };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Verifica che il repository sia accessibile
   */
  async validateRepository() {
    try {
      await this.octokit.repos.get({
        owner: this.owner,
        repo: this.repo
      });
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Genera nome branch unico
   */
  generateBranchName(prefix = null) {
    const branchPrefix = prefix || this.config.branchPrefix || 'spid-batch-';
    return `${branchPrefix}${Date.now()}`;
  }

  /**
   * Verifica se una branch esiste già
   */
  async branchExists(branchName) {
    try {
      await this.octokit.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${branchName}`
      });
      return true;
    } catch (error) {
      if (error.status === 404) return false;
      throw error;
    }
  }

  /**
   * Crea una nuova branch
   */
  async createBranch(branchName) {
    // Ottieni SHA del branch base
    const refData = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${this.baseBranch}`
    });
    const mainSha = refData.data.object.sha;

    // Crea nuova branch
    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${branchName}`,
      sha: mainSha
    });

    return mainSha;
  }

  /**
   * Upload files in parallelo con limite di concorrenza
   */
  async uploadFilesAsBlobs(files, concurrencyLimit = 5) {
    const results = [];
    
    for (let i = 0; i < files.length; i += concurrencyLimit) {
      const batch = files.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(
        batch.map(async (file) => {
          try {
            const blob = await this.octokit.git.createBlob({
              owner: this.owner,
              repo: this.repo,
              content: file.content,
              encoding: 'utf-8'
            });
            return {
              success: true,
              filename: file.filename,
              sha: blob.data.sha,
              path: `xml/${file.filename}`
            };
          } catch (error) {
            return {
              success: false,
              filename: file.filename,
              error: error.message
            };
          }
        })
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Crea tree, commit e aggiorna branch
   */
  async createCommitAndUpdateBranch(branchName, baseSha, treeItems, commitMessage) {
    // Ottieni base commit
    const baseCommit = await this.octokit.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: baseSha
    });

    // Crea tree
    const newTree = await this.octokit.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: baseCommit.data.tree.sha,
      tree: treeItems.map(item => ({
        path: item.path,
        mode: '100644',
        type: 'blob',
        sha: item.sha
      }))
    });

    // Crea commit
    const commitData = await this.octokit.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: commitMessage,
      tree: newTree.data.sha,
      parents: [baseSha]
    });

    // Aggiorna branch
    await this.octokit.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branchName}`,
      sha: commitData.data.sha
    });

    return commitData.data.sha;
  }

  /**
   * Crea Pull Request con opzioni avanzate
   */
  async createPullRequest(options) {
    const {
      title,
      head,
      body,
      draft = false,
      reviewers = [],
      labels = []
    } = options;

    // Crea PR
    const prData = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title,
      head,
      base: this.baseBranch,
      body,
      draft
    });

    const prNumber = prData.data.number;

    // Aggiungi reviewer se specificati
    if (reviewers.length > 0) {
      try {
        await this.octokit.pulls.requestReviewers({
          owner: this.owner,
          repo: this.repo,
          pull_number: prNumber,
          reviewers
        });
      } catch (error) {
        console.warn('Impossibile aggiungere reviewer:', error.message);
      }
    }

    // Aggiungi label se specificati
    if (labels.length > 0) {
      try {
        await this.octokit.issues.addLabels({
          owner: this.owner,
          repo: this.repo,
          issue_number: prNumber,
          labels
        });
      } catch (error) {
        console.warn('Impossibile aggiungere label:', error.message);
      }
    }

    return {
      url: prData.data.html_url,
      number: prNumber,
      branch: head
    };
  }

  /**
   * Ottieni stato di una PR
   */
  async getPRStatus(prNumber) {
    try {
      const { data } = await this.octokit.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber
      });
      return {
        state: data.state,
        merged: data.merged,
        mergedAt: data.merged_at,
        mergedBy: data.merged_by?.login,
        closedAt: data.closed_at
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Workflow completo per creare PR con retry
   */
  async createPullRequestWithRetry(files, metadata, maxRetries = 3) {
    let attempt = 0;
    let lastError = null;

    while (attempt < maxRetries) {
      try {
        return await this.createPullRequestWorkflow(files, metadata);
      } catch (error) {
        lastError = error;
        attempt++;
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
        }
      }
    }

    throw new Error(`Falliti tutti i ${maxRetries} tentativi: ${lastError.message}`);
  }

  /**
   * Workflow completo per creare una PR
   */
  async createPullRequestWorkflow(files, metadata) {
    const { organizations, template, draft, reviewers, labels } = metadata;

    // 1. Genera nome branch unico
    let branchName = this.generateBranchName();
    
    // 2. Verifica che la branch non esista già
    while (await this.branchExists(branchName)) {
      branchName = this.generateBranchName();
    }

    // 3. Crea branch
    const baseSha = await this.createBranch(branchName);

    // 4. Upload files in parallelo
    const uploadResults = await this.uploadFilesAsBlobs(files, 5);
    
    // Verifica se ci sono stati errori
    const failedUploads = uploadResults.filter(r => !r.success);
    if (failedUploads.length > 0) {
      throw new Error(`Errore upload file: ${failedUploads.map(f => f.filename).join(', ')}`);
    }

    const successfulUploads = uploadResults.filter(r => r.success);

    // 5. Crea commit
    await this.createCommitAndUpdateBranch(
      branchName,
      baseSha,
      successfulUploads,
      'Batch SPID XML upload'
    );

    // 6. Genera titolo e body PR da template
    const title = this.generatePRTitle(template?.title, files.length, organizations);
    const body = this.generatePRBody(template?.body, files, organizations);

    // 7. Crea PR
    const prResult = await this.createPullRequest({
      title,
      head: branchName,
      body,
      draft,
      reviewers,
      labels
    });

    return {
      ...prResult,
      filesUploaded: successfulUploads.length,
      organizations
    };
  }

  /**
   * Genera titolo PR da template
   */
  generatePRTitle(template, filesCount, organizations) {
    if (!template) {
      return `Batch SPID XML upload - ${filesCount} file`;
    }
    return template
      .replace('{count}', filesCount)
      .replace('{date}', new Date().toLocaleDateString('it-IT'))
      .replace('{organizations}', organizations.slice(0, 2).join(', '));
  }

  /**
   * Genera body PR da template
   */
  generatePRBody(template, files, organizations) {
    const defaultBody = `## Metadata SPID - Batch Upload

**File caricati:** ${files.length}
**Organizzazioni:** ${organizations.length}

### Lista Organizzazioni
${organizations.map(org => `- ${org}`).join('\n')}

### Checklist
- [ ] Validazione XML conforme a schema SPID
- [ ] Verifica certificati non scaduti
- [ ] Test raggiungibilità entityID
- [ ] Controllo duplicati nel registry
`;

    if (!template) return defaultBody;

    return template
      .replace('{count}', files.length)
      .replace('{organizations}', organizations.join(', '))
      .replace('{organizationsList}', organizations.map(org => `- ${org}`).join('\n'));
  }
}
