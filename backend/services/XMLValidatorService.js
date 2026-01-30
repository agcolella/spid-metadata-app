import xml2js from 'xml2js';

/**
 * Service per validazione e parsing XML SPID
 */
class XMLValidatorService {
  constructor() {
    this.parser = new xml2js.Parser({ explicitArray: false });
  }

  /**
   * Valida e parsa file XML
   */
  async validateAndParse(xmlContent, filename) {
    const errors = [];
    const warnings = [];

    try {
      // Parse XML
      const result = await this.parser.parseStringPromise(xmlContent);
      
      // Validazione struttura base
      const entity = result['md:EntityDescriptor'];
      if (!entity) {
        errors.push('File XML non conforme: manca md:EntityDescriptor');
        return { valid: false, errors };
      }

      if (!entity.$ || !entity.$.entityID) {
        errors.push('File XML non conforme: manca entityID');
        return { valid: false, errors };
      }

      const entityID = entity.$.entityID;

      // Validazione entityID
      if (!this.isValidEntityID(entityID)) {
        warnings.push('EntityID potrebbe non essere valido (formato URL atteso)');
      }

      // Validazione organizzazione
      const organization = entity['md:Organization'];
      if (!organization || !organization['md:OrganizationDisplayName']) {
        warnings.push('Organizzazione mancante o incompleta');
      }

      // Validazione contatti
      const contacts = entity['md:ContactPerson'];
      if (!contacts) {
        warnings.push('Nessun ContactPerson definito');
      } else {
        this.validateContacts(contacts, warnings);
      }

      // Estrai tipo ente
      const enteType = this.extractEnteType(contacts);
      if (!enteType) {
        warnings.push('Tipo ente (Pubblico/Privato) non identificato');
      }

      // Validazione certificati (basic)
      this.validateCertificates(entity, warnings);

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        data: {
          filename,
          entityID,
          organization,
          enteType,
          contactPersons: contacts,
          parsedEntity: entity
        }
      };

    } catch (error) {
      return {
        valid: false,
        errors: [`Errore parsing XML: ${error.message}`],
        warnings
      };
    }
  }

  /**
   * Valida formato entityID
   */
  isValidEntityID(entityID) {
    try {
      new URL(entityID);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Valida contatti
   */
  validateContacts(contacts, warnings) {
    const contactsArr = Array.isArray(contacts) ? contacts : [contacts];
    
    let hasEmail = false;
    let hasPhone = false;

    contactsArr.forEach(contact => {
      if (contact['md:EmailAddress']) hasEmail = true;
      if (contact['md:TelephoneNumber']) hasPhone = true;
    });

    if (!hasEmail) {
      warnings.push('Nessun indirizzo email nei contatti');
    }
    if (!hasPhone) {
      warnings.push('Nessun numero di telefono nei contatti');
    }
  }

  /**
   * Valida presenza certificati
   */
  validateCertificates(entity, warnings) {
    const descriptor = entity['md:SPSSODescriptor'] || entity['md:IDPSSODescriptor'];
    
    if (!descriptor) {
      warnings.push('Nessun descriptor SAML trovato');
      return;
    }

    const keyDescriptors = descriptor['md:KeyDescriptor'];
    if (!keyDescriptors) {
      warnings.push('Nessun certificato trovato');
    }
  }

  /**
   * Estrae tipo ente da extensions
   */
  extractEnteType(contactPersons) {
    if (!contactPersons) return '';
    
    const contactsArr = Array.isArray(contactPersons) ? contactPersons : [contactPersons];
    
    for (const contact of contactsArr) {
      if (contact.$?.contactType === 'other' && contact['md:Extensions']) {
        const type = this.enteTypeFromExtensions(contact['md:Extensions']);
        if (type) return type;
      }
    }
    
    return '';
  }

  /**
   * Ricerca ricorsiva tipo ente nelle extensions
   */
  enteTypeFromExtensions(extObj) {
    if (!extObj) return '';
    
    const allKeys = Object.keys(extObj);
    for (const key of allKeys) {
      if (key === 'spid:Public' && (
        extObj[key] === '' || 
        extObj[key] === null || 
        typeof extObj[key] === 'undefined' ||
        (typeof extObj[key] === 'object' && Object.keys(extObj[key]).length === 0)
      )) {
        return 'Pubblico';
      }
      
      if (key === 'spid:Public' && typeof extObj[key] === 'object') {
        return 'Pubblico';
      }
      
      if (key === 'spid:Private' && (
        extObj[key] === '' || 
        extObj[key] === null || 
        typeof extObj[key] === 'undefined' ||
        (typeof extObj[key] === 'object' && Object.keys(extObj[key]).length === 0)
      )) {
        return 'Privato';
      }
      
      if (key === 'spid:Private' && typeof extObj[key] === 'object') {
        return 'Privato';
      }
      
      if (extObj[key] && typeof extObj[key] === 'object') {
        const nested = Array.isArray(extObj[key]) ? extObj[key] : [extObj[key]];
        for (const sub of nested) {
          const found = this.enteTypeFromExtensions(sub);
          if (found) return found;
        }
      }
    }
    
    return '';
  }

  /**
   * Batch validation con report
   */
  async validateBatch(files) {
    const results = {
      total: files.length,
      valid: 0,
      invalid: 0,
      warnings: 0,
      details: []
    };

    for (const file of files) {
      const validation = await this.validateAndParse(file.content, file.filename);
      
      if (validation.valid) {
        results.valid++;
      } else {
        results.invalid++;
      }
      
      if (validation.warnings && validation.warnings.length > 0) {
        results.warnings += validation.warnings.length;
      }

      results.details.push(validation);
    }

    return results;
  }
}

export default new XMLValidatorService();
