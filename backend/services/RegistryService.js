import axios from 'axios';
import config from '../config/app-config.js';

/**
 * Service per interazione con Registry SPID
 */
class RegistryService {
  constructor() {
    this.baseUrl = config.registry.baseUrl;
    this.cache = new Map();
    this.cacheTimeout = 300000; // 5 minuti
  }

  /**
   * Ottiene informazioni entità da registry
   */
  async getEntityInfo(entityID) {
    // Controlla cache
    const cached = this.cache.get(entityID);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const url = `${this.baseUrl}/entities/${encodeURIComponent(entityID)}?output=json`;
      const response = await axios.get(url, {
        timeout: config.registry.timeout
      });

      const data = {
        found: true,
        ...response.data
      };

      // Salva in cache
      this.cache.set(entityID, {
        data,
        timestamp: Date.now()
      });

      return data;

    } catch (error) {
      if (error.response?.status === 404) {
        const notFoundData = { found: false, entityID };
        
        // Cache anche i not found
        this.cache.set(entityID, {
          data: notFoundData,
          timestamp: Date.now()
        });
        
        return notFoundData;
      }
      
      throw error;
    }
  }

  /**
   * Batch lookup con rate limiting
   */
  async batchLookup(entityIDs, delayMs = 400) {
    const results = {};
    
    for (const entityID of entityIDs) {
      try {
        results[entityID] = await this.getEntityInfo(entityID);
        
        // Delay tra richieste
        if (delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        results[entityID] = {
          found: false,
          error: error.message
        };
      }
    }
    
    return results;
  }

  /**
   * Pulisce cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Ottiene statistiche cache
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

export default new RegistryService();
