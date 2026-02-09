export class PRTemplateService {
  constructor(config) {
    this.config = config;
  }

  generateTitle(fileCount, organizations) {
    const template = this.config.prTemplate?.title || 'SPID: Aggiunta {count} metadata - {date}';
    
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    
    return template
      .replace('{count}', fileCount)
      .replace('{date}', dateStr)
      .replace('{organizations}', organizations.length);
  }

  generateBody(filesData, organizations, validationResults) {
    // Se c'è un template custom, usalo
    if (this.config.prTemplate?.body) {
      return this.config.prTemplate.body;
    }

    // Altrimenti genera automaticamente
    let body = '## 📋 Riepilogo\n\n';
    body += `Questa PR aggiunge **${filesData.length}** metadata SPID per **${organizations.length}** organizzazioni.\n\n`;

    // Statistiche validazione
    if (validationResults) {
      const totalErrors = validationResults.errors?.length || 0;
      const totalWarnings = validationResults.warnings?.length || 0;
      const duplicates = validationResults.duplicates?.length || 0;

      body += '## ✅ Validazione\n\n';
      
      if (totalErrors === 0 && totalWarnings === 0 && duplicates === 0) {
        body += '- ✅ Tutti i file sono validi\n';
        body += '- ✅ Nessun warning rilevato\n';
        body += '- ✅ Nessun entityID duplicato\n\n';
      } else {
        if (totalErrors > 0) {
          body += `- ⚠️ **${totalErrors}** errori di validazione\n`;
        }
        if (totalWarnings > 0) {
          body += `- ⚠️ **${totalWarnings}** warning\n`;
        }
        if (duplicates > 0) {
          body += `- ⚠️ **${duplicates}** entityID duplicati\n`;
        }
        body += '\n';
      }
    }

    // Lista organizzazioni
    body += '## 🏢 Organizzazioni\n\n';
    organizations.forEach(org => {
      body += `- ${org}\n`;
    });
    body += '\n';

    // Lista file
    body += '## 📁 File Inclusi\n\n';
    body += '<details>\n<summary>Clicca per espandere la lista completa</summary>\n\n';
    filesData.forEach(file => {
      body += `- \`${file.filename}\``;
      if (file.organizationName) {
        body += ` - ${file.organizationName}`;
      }
      body += '\n';
    });
    body += '\n</details>\n\n';

    // Footer
    body += '---\n\n';
    body += '*PR creata automaticamente da SPID Metadata App*\n';

    return body;
  }

  generateBranchName() {
    const prefix = this.config.branchPrefix || 'spid-batch-';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    
    return `${prefix}${timestamp}-${random}`;
  }
}
