import fs from 'fs';
import pathmod from 'path';

/**
 * Service per gestire lo storico delle Pull Request
 * Persistenza su file JSON invece di localStorage
 */
export class PRHistoryService {
  constructor(historyFilePath = './pr-history.json') {
    this.historyFilePath = historyFilePath;
    this.ensureHistoryFile();
  }

  /**
   * Assicura che il file di storico esista
   */
  ensureHistoryFile() {
    if (!fs.existsSync(this.historyFilePath)) {
      fs.writeFileSync(this.historyFilePath, JSON.stringify([]));
    }
  }

  /**
   * Leggi tutto lo storico
   */
  getAll() {
    try {
      const content = fs.readFileSync(this.historyFilePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error('Errore lettura storico:', error);
      return [];
    }
  }

  /**
   * Aggiungi una PR allo storico
   */
  add(prData) {
    const history = this.getAll();
    const entry = {
      id: Date.now(),
      url: prData.url,
      prNumber: prData.number,
      branch: prData.branch,
      created: new Date().toISOString(),
      createdLocale: new Date().toLocaleString('it-IT'),
      status: 'open',
      filesCount: prData.filesUploaded,
      organizationsCount: prData.organizations.length,
      organizations: prData.organizations,
      enti: prData.enti || [],
      mergedAt: null,
      mergedBy: null,
      closedAt: null
    };

    history.unshift(entry);
    this.save(history);
    return entry;
  }

  /**
   * Aggiorna stato di una PR
   */
  updateStatus(prNumber, statusData) {
    const history = this.getAll();
    const index = history.findIndex(pr => pr.prNumber === prNumber);
    
    if (index === -1) {
      return null;
    }

    history[index] = {
      ...history[index],
      status: statusData.state,
      merged: statusData.merged,
      mergedAt: statusData.mergedAt,
      mergedBy: statusData.mergedBy,
      closedAt: statusData.closedAt,
      lastUpdated: new Date().toISOString()
    };

    this.save(history);
    return history[index];
  }

  /**
   * Ottieni una PR per numero
   */
  getByNumber(prNumber) {
    const history = this.getAll();
    return history.find(pr => pr.prNumber === prNumber);
  }

  /**
   * Filtra PR per criteri
   */
  filter(criteria) {
    const history = this.getAll();
    let filtered = history;

    if (criteria.status) {
      filtered = filtered.filter(pr => pr.status === criteria.status);
    }

    if (criteria.dateFrom) {
      filtered = filtered.filter(pr => new Date(pr.created) >= new Date(criteria.dateFrom));
    }

    if (criteria.dateTo) {
      filtered = filtered.filter(pr => new Date(pr.created) <= new Date(criteria.dateTo));
    }

    if (criteria.organization) {
      filtered = filtered.filter(pr => 
        pr.organizations.some(org => 
          org.toLowerCase().includes(criteria.organization.toLowerCase())
        )
      );
    }

    return filtered;
  }

  /**
   * Statistiche sullo storico
   */
  getStats() {
    const history = this.getAll();
    
    return {
      total: history.length,
      open: history.filter(pr => pr.status === 'open').length,
      merged: history.filter(pr => pr.merged).length,
      closed: history.filter(pr => pr.status === 'closed' && !pr.merged).length,
      totalFiles: history.reduce((sum, pr) => sum + pr.filesCount, 0),
      totalOrganizations: new Set(
        history.flatMap(pr => pr.organizations)
      ).size,
      averageFilesPerPR: history.length > 0 
        ? Math.round(history.reduce((sum, pr) => sum + pr.filesCount, 0) / history.length)
        : 0
    };
  }

  /**
   * Export storico in formato CSV
   */
  exportToCSV() {
    const history = this.getAll();
    const headers = [
      'PR Number',
      'URL',
      'Branch',
      'Created',
      'Status',
      'Files Count',
      'Organizations',
      'Merged At',
      'Merged By'
    ];

    const rows = history.map(pr => [
      pr.prNumber,
      pr.url,
      pr.branch,
      pr.createdLocale,
      pr.status,
      pr.filesCount,
      pr.organizations.join('; '),
      pr.mergedAt || '',
      pr.mergedBy || ''
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    return csv;
  }

  /**
   * Salva storico su file
   */
  save(history) {
    try {
      fs.writeFileSync(
        this.historyFilePath,
        JSON.stringify(history, null, 2)
      );
      return true;
    } catch (error) {
      console.error('Errore salvataggio storico:', error);
      return false;
    }
  }

  /**
   * Pulisci storico vecchio (es. PR più vecchie di 6 mesi)
   */
  cleanOldEntries(monthsOld = 6) {
    const history = this.getAll();
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);

    const filtered = history.filter(pr => 
      new Date(pr.created) >= cutoffDate
    );

    this.save(filtered);
    return history.length - filtered.length; // Numero di entry rimosse
  }
}
