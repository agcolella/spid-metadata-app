import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Service per gestione storico Pull Request
 * Usa file JSON per persistenza (può essere sostituito con DB)
 */
class PRHistoryService {
  constructor() {
    this.historyFile = path.join(__dirname, '../data/pr-history.json');
    this.ensureDataDirectory();
    this.history = this.loadHistory();
  }

  /**
   * Assicura esistenza directory data
   */
  ensureDataDirectory() {
    const dataDir = path.dirname(this.historyFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  /**
   * Carica storico da file
   */
  loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const data = fs.readFileSync(this.historyFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Errore caricamento storico:', error);
    }
    return [];
  }

  /**
   * Salva storico su file
   */
  saveHistory() {
    try {
      fs.writeFileSync(
        this.historyFile,
        JSON.stringify(this.history, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('Errore salvataggio storico:', error);
    }
  }

  /**
   * Aggiunge entry allo storico
   */
  async addEntry(entry) {
    const historyEntry = {
      id: Date.now().toString(),
      ...entry,
      createdAt: entry.createdAt || new Date().toISOString()
    };

    this.history.unshift(historyEntry);
    this.saveHistory();
    
    return historyEntry;
  }

  /**
   * Ottiene storico con filtri e paginazione
   */
  async getHistory(options = {}) {
    const { limit = 50, offset = 0, status, search } = options;
    
    let filtered = [...this.history];
    
    // Filtro per status
    if (status) {
      filtered = filtered.filter(entry => entry.status === status);
    }
    
    // Filtro ricerca
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(entry => 
        entry.organizations?.some(org => org.toLowerCase().includes(searchLower)) ||
        entry.files?.some(f => f.filename?.toLowerCase().includes(searchLower))
      );
    }
    
    // Paginazione
    const paginated = filtered.slice(offset, offset + limit);
    
    return {
      total: filtered.length,
      limit,
      offset,
      items: paginated
    };
  }

  /**
   * Ottiene singola entry per PR number
   */
  async getByPRNumber(prNumber) {
    return this.history.find(entry => entry.prNumber === prNumber);
  }

  /**
   * Aggiorna stato di una PR
   */
  async updateStatus(prNumber, statusData) {
    const entry = await this.getByPRNumber(prNumber);
    
    if (!entry) {
      throw new Error(`PR #${prNumber} non trovata nello storico`);
    }
    
    entry.status = statusData.state;
    entry.merged = statusData.merged;
    entry.mergedAt = statusData.mergedAt;
    entry.mergedBy = statusData.mergedBy;
    entry.lastUpdated = new Date().toISOString();
    
    this.saveHistory();
    
    return entry;
  }

  /**
   * Esporta storico in CSV
   */
  async exportToCSV() {
    const headers = ['PR Number', 'URL', 'Branch', 'Files Count', 'Organizations', 'Status', 'Created At', 'Merged At'];
    const rows = this.history.map(entry => [
      entry.prNumber,
      entry.prUrl,
      entry.branch,
      entry.filesCount,
      entry.organizations?.join('; ') || '',
      entry.status,
      entry.createdAt,
      entry.mergedAt || ''
    ]);
    
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
    
    return csv;
  }

  /**
   * Ottieni statistiche
   */
  async getStatistics() {
    const total = this.history.length;
    const open = this.history.filter(e => e.status === 'open').length;
    const merged = this.history.filter(e => e.merged === true).length;
    const closed = this.history.filter(e => e.status === 'closed' && !e.merged).length;
    
    const totalFiles = this.history.reduce((sum, e) => sum + (e.filesCount || 0), 0);
    const avgFilesPerPR = total > 0 ? (totalFiles / total).toFixed(2) : 0;
    
    // Organizzazioni più frequenti
    const orgCounts = {};
    this.history.forEach(entry => {
      entry.organizations?.forEach(org => {
        orgCounts[org] = (orgCounts[org] || 0) + 1;
      });
    });
    
    const topOrganizations = Object.entries(orgCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([org, count]) => ({ org, count }));
    
    return {
      total,
      byStatus: { open, merged, closed },
      files: { total: totalFiles, avgPerPR: avgFilesPerPR },
      topOrganizations
    };
  }
}

export default new PRHistoryService();
