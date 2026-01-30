import xml2js from 'xml2js';

/**
 * Service per validazione avanzata dei file XML SPID
 */
export class XMLValidatorService {
  constructor() {
    this.parser = new xml2js.Parser({ explicitArray: false });
  }

  /**
   * Valida un singolo file XML
   */
  async validateXML(xmlContent, filename) {
    const errors = [];
    const warnings = [];

    try {
      // 1. Parse XML
      const result = await this.parseXML(xmlContent);
      if (!result.success) {
        errors.push({ type: 'PARSE_ERROR', message: result.error });
        return { valid: false, errors, warnings };
      }

      const parsed = result.data;

      // 2. Verifica struttura base
      const structureValidation = this.validateStructure(parsed);
      errors.push(...structureValidation.errors);
      warnings.push(...structureValidation.warnings);

      // 3. Verifica EntityID
      const entityIDValidation = this.validateEntityID(parsed);
      errors.push(...entityIDValidation.errors);
      warnings.push(...entityIDValidation.warnings);

      // 4. Verifica Organization
      const orgValidation = this.validateOrganization(parsed);
      errors.push(...orgValidation.errors);
      warnings.push(...orgValidation.warnings);

      // 5. Verifica ContactPerson
      const contactValidation = this.validateContactPerson(parsed);
      errors.push(...contactValidation.errors);
      warnings.push(...contactValidation.warnings);

      // 6. Verifica tipo ente (SPID specific)
      const enteTypeValidation = this.validateEnteType(parsed);
      warnings.push(...enteTypeValidation.warnings);

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        metadata: this.extractMetadata(parsed)
      };
    } catch (error) {
      return {
        valid: false,
        errors: [{ type: 'UNKNOWN_ERROR', message: error.message }],
        warnings: []
      };
    }
  }

  /**
   * Parse XML con gestione errori
   */
  async parseXML(xmlContent) {
    return new Promise((resolve) => {
      this.parser.parseString(xmlContent, (err, result) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true, data: result });
        }
      });
    });
  }

  /**
   * Valida struttura base del file XML SPID
   */
  validateStructure(parsed) {
    const errors = [];
    const warnings = [];

    if (!parsed['md:EntityDescriptor']) {
      errors.push({
        type: 'MISSING_ENTITY_DESCRIPTOR',
        message: 'Manca l\'elemento root md:EntityDescriptor'
      });
      return { errors, warnings };
    }

    const entity = parsed['md:EntityDescriptor'];

    if (!entity.$) {
      errors.push({
        type: 'MISSING_ATTRIBUTES',
        message: 'md:EntityDescriptor non ha attributi'
      });
    }

    return { errors, warnings };
  }

  /**
   * Valida EntityID
   */
  validateEntityID(parsed) {
    const errors = [];
    const warnings = [];

    const entity = parsed['md:EntityDescriptor'];
    if (!entity?.$.entityID) {
      errors.push({
        type: 'MISSING_ENTITY_ID',
        message: 'Manca attributo entityID'
      });
      return { errors, warnings };
    }

    const entityID = entity.$.entityID;

    // Verifica formato URL
    try {
      new URL(entityID);
    } catch {
      warnings.push({
        type: 'INVALID_ENTITY_ID_FORMAT',
        message: `entityID non è un URL valido: ${entityID}`
      });
    }

    // Verifica HTTPS
    if (!entityID.startsWith('https://')) {
      warnings.push({
        type: 'NON_HTTPS_ENTITY_ID',
        message: 'entityID dovrebbe usare HTTPS'
      });
    }

    return { errors, warnings };
  }

  /**
   * Valida Organization
   */
  validateOrganization(parsed) {
    const errors = [];
    const warnings = [];

    const entity = parsed['md:EntityDescriptor'];
    const org = entity?.['md:Organization'];

    if (!org) {
      warnings.push({
        type: 'MISSING_ORGANIZATION',
        message: 'Elemento md:Organization non presente'
      });
      return { errors, warnings };
    }

    // Verifica OrganizationDisplayName
    if (!org['md:OrganizationDisplayName']) {
      warnings.push({
        type: 'MISSING_ORG_DISPLAY_NAME',
        message: 'Manca md:OrganizationDisplayName'
      });
    }

    // Verifica OrganizationName
    if (!org['md:OrganizationName']) {
      warnings.push({
        type: 'MISSING_ORG_NAME',
        message: 'Manca md:OrganizationName'
      });
    }

    return { errors, warnings };
  }

  /**
   * Valida ContactPerson
   */
  validateContactPerson(parsed) {
    const errors = [];
    const warnings = [];

    const entity = parsed['md:EntityDescriptor'];
    const contacts = entity?.['md:ContactPerson'];

    if (!contacts) {
      warnings.push({
        type: 'MISSING_CONTACT_PERSON',
        message: 'Nessun md:ContactPerson presente'
      });
      return { errors, warnings };
    }

    const contactsArr = Array.isArray(contacts) ? contacts : [contacts];

    contactsArr.forEach((contact, idx) => {
      // Verifica tipo contatto
      if (!contact.$.contactType) {
        warnings.push({
          type: 'MISSING_CONTACT_TYPE',
          message: `ContactPerson ${idx + 1}: manca contactType`
        });
      }

      // Verifica email
      if (!contact['md:EmailAddress']) {
        warnings.push({
          type: 'MISSING_EMAIL',
          message: `ContactPerson ${idx + 1}: manca email`
        });
      }
    });

    return { errors, warnings };
  }

  /**
   * Valida tipo ente SPID (Pubblico/Privato)
   */
  validateEnteType(parsed) {
    const warnings = [];

    const entity = parsed['md:EntityDescriptor'];
    const contacts = entity?.['md:ContactPerson'];

    if (!contacts) {
      return { warnings };
    }

    const contactsArr = Array.isArray(contacts) ? contacts : [contacts];
    let foundEnteType = false;

    for (const contact of contactsArr) {
      if (contact.$.contactType === 'other' && contact['md:Extensions']) {
        const ext = contact['md:Extensions'];
        if (ext['spid:Public'] !== undefined || ext['spid:Private'] !== undefined) {
          foundEnteType = true;
          break;
        }
      }
    }

    if (!foundEnteType) {
      warnings.push({
        type: 'MISSING_ENTE_TYPE',
        message: 'Tipo ente SPID (spid:Public/spid:Private) non trovato'
      });
    }

    return { warnings };
  }

  /**
   * Estrae metadata dal file XML
   */
  extractMetadata(parsed) {
    const entity = parsed['md:EntityDescriptor'];
    
    return {
      entityID: entity?.$.entityID || null,
      organization: entity?.['md:Organization'] || null,
      contactPersons: entity?.['md:ContactPerson'] || null,
      enteType: this.extractEnteType(entity)
    };
  }

  /**
   * Estrae tipo ente (logica esistente)
   */
  extractEnteType(entity) {
    const contacts = entity?.['md:ContactPerson'];
    if (!contacts) return '';

    const contactsArr = Array.isArray(contacts) ? contacts : [contacts];
    
    for (const contact of contactsArr) {
      if (contact.$.contactType === 'other' && contact['md:Extensions']) {
        const ext = contact['md:Extensions'];
        const type = this.enteTypeFromExtensions(ext);
        if (type) return type;
      }
    }
    
    return '';
  }

  /**
   * Ricerca ricorsiva tipo ente (logica esistente)
   */
  enteTypeFromExtensions(extObj) {
    if (!extObj) return '';
    
    const allKeys = Object.keys(extObj);
    for (const key of allKeys) {
      if (key === 'spid:Public' && (
        extObj[key] === '' || extObj[key] === null || 
        typeof extObj[key] === 'undefined' ||
        (typeof extObj[key] === 'object' && Object.keys(extObj[key]).length === 0)
      )) return 'Pubblico';
      
      if (key === 'spid:Public' && typeof extObj[key] === 'object') return 'Pubblico';
      
      if (key === 'spid:Private' && (
        extObj[key] === '' || extObj[key] === null || 
        typeof extObj[key] === 'undefined' ||
        (typeof extObj[key] === 'object' && Object.keys(extObj[key]).length === 0)
      )) return 'Privato';
      
      if (key === 'spid:Private' && typeof extObj[key] === 'object') return 'Privato';
      
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
   * Valida batch di file
   */
  async validateBatch(files) {
    const results = [];
    
    for (const file of files) {
      const validation = await this.validateXML(file.content, file.filename);
      results.push({
        filename: file.filename,
        ...validation
      });
    }

    return {
      allValid: results.every(r => r.valid),
      totalFiles: results.length,
      validFiles: results.filter(r => r.valid).length,
      invalidFiles: results.filter(r => !r.valid).length,
      results
    };
  }
}
