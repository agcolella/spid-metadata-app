// backend/services/XMLValidatorService.js

import xml2js from 'xml2js';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import crypto from 'crypto';

export class XMLValidatorService {
  constructor(config) {
    this.config = config;
    this.strictMode = config?.validation?.strictMode || false;
	this.checkMetadataSignature =
    config?.validation?.checkMetadataSignature === true; // nuovo flag

    this.allowedRequestedAttributes = [
      'address',
      'companyName',
      'companyFiscalNumber',
      'countyOfBirth',
      'dateOfBirth',
      'digitalAddress',
      'email',
      'expirationDate',
      'familyName',
      'fiscalNumber',
      'gender',
      'idCard',
      'ivaCode',
      'mobilePhone',
      'name',
      'placeOfBirth',
      'registeredOffice',
      'spidCode',
      'domicileStreetAddress',
      'domicilePostalCode',
      'domicileMunicipality',
      'domicileProvince',
      'domicileNation'
    ]; // [file:80]
  }

  async validate(xmlContent, filename) {
    const errors = [];
    const warnings = [];

    // ---------- Parse XML ----------
    let result;
    try {
      const parser = new xml2js.Parser({
        explicitArray: false,
        mergeAttrs: true,
        trim: true,
        tagNameProcessors: [xml2js.processors.stripPrefix],
        attrNameProcessors: [xml2js.processors.stripPrefix]
      });
      result = await parser.parseStringPromise(xmlContent);
    } catch (e) {
      errors.push(`Errore parsing XML: ${e.message}`);
      return { valid: false, errors, warnings };
    }

    // ---------- EntityDescriptor (1.3.x) ----------
    const entity = this.getSingleEntityDescriptor(result, errors);
    if (!entity) {
      return { valid: false, errors, warnings };
    }
    this.checkEntityDescriptor(entity, errors);

    // ---------- SPSSODescriptor (1.6.x) ----------
    const sp = this.getSingleSPSSODescriptor(entity, errors);
    if (!sp) {
      return {
        valid: errors.length === 0,
        errors,
        warnings,
        entityID: entity.entityID || null
      };
    }
    this.checkSPSSODescriptor(sp, errors);

    // ---------- AssertionConsumerService (1.1.x) ----------
    this.checkAssertionConsumerService(sp, errors);

    // ---------- AttributeConsumingService (1.2.x) ----------
    this.checkAttributeConsumingService(sp, errors);

    // ---------- KeyDescriptor (1.4.x) ----------
    this.checkKeyDescriptor(sp, errors);

    // ---------- Organization (1.5.x) ----------
    const orgInfo = this.checkOrganization(entity, errors);

    // ---------- SingleLogoutService (1.8.x) ----------
    this.checkSingleLogoutService(sp, errors);

    // ---------- Signature struttura (1.7.x) ----------
    this.checkSignatureStructure(result, errors);

    // ---------- Firma crittografica + certificato (1.9.0 + check-certificate.py) ----------
    if (this.checkMetadataSignature) {
      this.checkSignatureCryptoAndCert(xmlContent, errors, warnings);
    }

    const valid = errors.length === 0;

    return {
      valid,
      errors,
      warnings,
      entityID: entity.entityID || null,
      organizationName: orgInfo.displayName || orgInfo.name || null,
      entityType: 'SP'
    };
  }

  // =====================================================
  // Helpers parsing
  // =====================================================

  getSingleEntityDescriptor(result, errors) {
    const keys = Object.keys(result || {}).filter(k => k.includes('EntityDescriptor'));
    if (keys.length === 0) {
      errors.push('1.3.0: Nessun EntityDescriptor presente');
      return null;
    }
    if (keys.length > 1) {
      errors.push('1.3.0: Deve essere presente un solo EntityDescriptor');
    }
    return result[keys[0]];
  }

  getSingleSPSSODescriptor(entity, errors) {
    const sp = entity.SPSSODescriptor;
    if (!sp) {
      errors.push('1.6.0: SPSSODescriptor mancante (deve essere presente e unico)');
      return null;
    }
    if (Array.isArray(sp)) {
      if (sp.length === 0) {
        errors.push('1.6.0: Nessun SPSSODescriptor presente');
        return null;
      }
      if (sp.length > 1) {
        errors.push('1.6.0: Deve essere presente un solo SPSSODescriptor');
      }
      return sp[0];
    }
    return sp;
  }

  // =====================================================
  // 1.3.x EntityDescriptor
  // =====================================================

  checkEntityDescriptor(entity, errors) {
    if (!('entityID' in entity)) {
      errors.push('1.3.1: Attributo entityID mancante in EntityDescriptor');
    } else if (!entity.entityID || String(entity.entityID).trim() === '') {
      errors.push('1.3.2: Attributo entityID presente ma senza valore');
    }
  }

  // =====================================================
  // 1.7.x struttura Signature
  // =====================================================

  checkSignatureStructure(parsed, errors) {
    const entity = parsed.EntityDescriptor || parsed['md:EntityDescriptor'];
    if (!entity) {
      errors.push('1.3.0: EntityDescriptor mancante, impossibile verificare Signature');
      return;
    }

    const sig = entity.Signature || entity['ds:Signature'];
    if (!sig) {
      errors.push('1.7.0: Elemento Signature mancante');
      return;
    }

    const signedInfo = sig.SignedInfo || sig['ds:SignedInfo'];
    if (!signedInfo) {
      errors.push('1.7.1: SignedInfo/SignatureMethod mancante');
      return;
    }

    const sigMethod = signedInfo.SignatureMethod || signedInfo['ds:SignatureMethod'];
    if (!sigMethod || !sigMethod.Algorithm) {
      errors.push('1.7.1/1.7.2: SignatureMethod o attributo Algorithm mancante');
    } else {
      const alg = sigMethod.Algorithm;
      const allowedSig = [
        'http://www.w3.org/2001/04/xmldsig-more#ecdsasha256',
        'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384',
        'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512',
        'http://www.w3.org/2001/04/xmldsig-more#hmac-sha256',
        'http://www.w3.org/2001/04/xmldsig-more#hmac-sha384',
        'http://www.w3.org/2001/04/xmldsig-more#hmac-sha512',
        'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
        'http://www.w3.org/2001/04/xmldsig-more#rsa-sha384',
        'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512'
      ]; // [file:80]
      if (!allowedSig.includes(alg)) {
        errors.push('1.7.3: Algoritmo di firma non ammesso per SignatureMethod');
      }
    }

    const ref = signedInfo.Reference || signedInfo['ds:Reference'];
    if (!ref) {
      errors.push('1.7.4: Reference/DigestMethod mancante');
    } else {
      const digestMethod = ref.DigestMethod || ref['ds:DigestMethod'];
      if (!digestMethod || !digestMethod.Algorithm) {
        errors.push('1.7.4/1.7.5: DigestMethod o attributo Algorithm mancante');
      } else {
        const alg = digestMethod.Algorithm;
        const allowedDigest = [
          'http://www.w3.org/2001/04/xmlenc#sha256',
          'http://www.w3.org/2001/04/xmlenc#sha384',
          'http://www.w3.org/2001/04/xmlenc#sha512'
        ]; // [file:80]
        if (!allowedDigest.includes(alg)) {
          errors.push('1.7.6: Algoritmo di digest non ammesso');
        }
      }
    }
  }

  // =====================================================
  // 1.9.0 verifica crittografica + check certificato (script Python)
  // =====================================================

  checkSignatureCryptoAndCert(xmlContent, errors, warnings) {
    try {
      const doc = new DOMParser().parseFromString(xmlContent);

      const signatureNode = doc.getElementsByTagNameNS(
        'http://www.w3.org/2000/09/xmldsig#',
        'Signature'
      )[0];
      if (!signatureNode) {
        errors.push('1.9.0: Signature mancante, impossibile verificare la firma del metadata');
        return;
      }

      const x509Nodes = signatureNode.getElementsByTagNameNS(
        'http://www.w3.org/2000/09/xmldsig#',
        'X509Certificate'
      );
      if (!x509Nodes || x509Nodes.length === 0) {
        errors.push('1.9.0: nessun X509Certificate trovato in Signature/KeyInfo');
        return;
      }

      const rawCert = (x509Nodes[0].textContent || '').replace(/\s+/g, '');
      if (!rawCert) {
        errors.push('1.9.0: X509Certificate presente ma vuoto');
        return;
      }

      const pemCert =
        '-----BEGIN CERTIFICATE-----\n' +
        rawCert.match(/.{1,64}/g).join('\n') +
        '\n-----END CERTIFICATE-----\n';

      // Controlli sul certificato (equivalenti a check-certificate.py)
      this.checkX509CertificateQuality(pemCert, errors, warnings);

      const sig = new SignedXml({
        publicCert: pemCert
      });

      sig.loadSignature(signatureNode);

      const ok = sig.checkSignature(xmlContent);
      if (!ok) {
        const detail = sig.validationErrors ? sig.validationErrors.join('; ') : 'motivo sconosciuto';
        errors.push(`1.9.0: la firma del metadata non è valida: ${detail}`);
      }
    } catch (e) {
      errors.push(`1.9.0: errore durante la verifica crittografica della firma: ${e.message}`);
    }
  }

checkX509CertificateQuality(pemCert, errors, warnings) {
  try {
    const x509 = new crypto.X509Certificate(pemCert);

    // NON controlliamo più l'algoritmo di firma del certificato perché Node non lo espone in modo affidabile

    // ---- Key type & length ----
    const pub = x509.publicKey;
    const asn1 = pub.asymmetricKeyType; // 'rsa', 'ec', ...

    if (asn1 !== 'rsa' && asn1 !== 'ec') {
      errors.push(`CERT: tipo di chiave non ammesso (${asn1 || 'sconosciuto'})`);
    } else {
      const bits = pub.asymmetricKeySize;
      if (asn1 === 'rsa' && bits < 2048) {
        errors.push(`CERT: lunghezza chiave RSA troppo corta (${bits} bit, minimo 2048)`);
      }
      if (asn1 === 'ec' && bits < 256) {
        errors.push(`CERT: lunghezza chiave EC troppo corta (${bits} bit, minimo 256)`);
      }
    }

    // ---- Scadenza ----
    const now = new Date();
    const notAfter = new Date(x509.validTo);
    if (isFinite(notAfter.getTime()) && notAfter < now) {
      errors.push('CERT: il certificato è scaduto');
    }

    // ---- CN nel subject ----
    const subject = x509.subject || '';
    if (!subject.includes('CN=')) {
      warnings.push('CERT: CN non presente nel subject del certificato');
    } else {
      const cnMatch = subject.match(/CN=([^,]+)/);
      const cnValue = cnMatch && cnMatch[1] ? cnMatch[1].trim() : '';
      if (!cnValue) {
        warnings.push('CERT: CN presente nel subject ma senza valore');
      }
    }
  } catch (e) {
    warnings.push(`CERT: impossibile analizzare il certificato X509 (${e.message})`);
  }
}

  // =====================================================
  // 1.6.x SPSSODescriptor
  // =====================================================

  checkSPSSODescriptor(sp, errors) {
    if (!('protocolSupportEnumeration' in sp)) {
      errors.push('1.6.1: protocolSupportEnumeration mancante in SPSSODescriptor');
    } else if (!sp.protocolSupportEnumeration || String(sp.protocolSupportEnumeration).trim() === '') {
      errors.push('1.6.2: protocolSupportEnumeration presente ma senza valore');
    } else if (!String(sp.protocolSupportEnumeration).includes('urn:oasis:names:tc:SAML:2.0:protocol')) {
      errors.push('1.6.6: protocolSupportEnumeration deve contenere "urn:oasis:names:tc:SAML:2.0:protocol"');
    }

    if (!('AuthnRequestsSigned' in sp)) {
      errors.push('1.6.3: AuthnRequestsSigned mancante in SPSSODescriptor');
    } else if (sp.AuthnRequestsSigned === '' || sp.AuthnRequestsSigned === null || sp.AuthnRequestsSigned === undefined) {
      errors.push('1.6.4: AuthnRequestsSigned presente ma senza valore');
    } else if (!(sp.AuthnRequestsSigned === true || sp.AuthnRequestsSigned === 'true')) {
      errors.push('1.6.5: AuthnRequestsSigned deve essere true');
    }

    if (!('WantAssertionsSigned' in sp)) {
      errors.push('1.6.7: WantAssertionsSigned mancante in SPSSODescriptor');
    } else if (sp.WantAssertionsSigned === '' || sp.WantAssertionsSigned === null || sp.WantAssertionsSigned === undefined) {
      errors.push('1.6.8: WantAssertionsSigned presente ma senza valore');
    } else if (!(sp.WantAssertionsSigned === true || sp.WantAssertionsSigned === 'true')) {
      errors.push('1.6.9: WantAssertionsSigned deve essere true');
    }
  }

  // =====================================================
  // 1.1.x AssertionConsumerService
  // =====================================================

  checkAssertionConsumerService(sp, errors) {
    const raw = sp.AssertionConsumerService;
    if (!raw) {
      errors.push('1.1.0: Almeno un AssertionConsumerService deve essere presente');
      return;
    }
    const list = Array.isArray(raw) ? raw : [raw];

    let defaultCount = 0;
    list.forEach((acs, idx) => {
      const label = `AssertionConsumerService[${idx}]`;

      if (!('index' in acs)) {
        errors.push(`1.1.1: ${label} manca l'attributo index`);
      } else if (isNaN(Number(acs.index)) || Number(acs.index) < 0) {
        errors.push(`1.1.2: ${label} index deve essere >= 0`);
      }

      if (!('Binding' in acs)) {
        errors.push(`1.1.3: ${label} Binding mancante`);
      } else if (
        acs.Binding !== 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST' &&
        acs.Binding !== 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect'
      ) {
        errors.push(`1.1.4: ${label} Binding deve essere HTTP-POST o HTTP-Redirect`);
      }

      if (!('Location' in acs) || !acs.Location) {
        errors.push(`1.1.5: ${label} Location mancante`);
      } else if (!String(acs.Location).startsWith('https://')) {
        errors.push(`1.1.6: ${label} Location deve essere una URL HTTPS`);
      }

      if (acs.isDefault === true || acs.isDefault === 'true') {
        defaultCount++;
        if (!(acs.index === 0 || acs.index === '0')) {
          errors.push(`1.1.8: ${label} default deve avere index = 0`);
        }
      }
    });

    if (defaultCount === 0) {
      errors.push('1.1.7: Deve essere presente un solo AssertionConsumerService default');
    }
    if (defaultCount > 1) {
      errors.push('1.1.7: È presente più di un AssertionConsumerService default');
    }
  }

  // =====================================================
  // 1.2.x AttributeConsumingService
  // =====================================================

  checkAttributeConsumingService(sp, errors) {
    const raw = sp.AttributeConsumingService;
    if (!raw) {
      errors.push('1.2.0: Uno o più AttributeConsumingService devono essere presenti');
      return;
    }
    const list = Array.isArray(raw) ? raw : [raw];

    list.forEach((acs, idx) => {
      const label = `AttributeConsumingService[${idx}]`;

      if (!('index' in acs)) {
        errors.push(`1.2.1: ${label} index mancante`);
      } else if (isNaN(Number(acs.index)) || Number(acs.index) < 0) {
        errors.push(`1.2.2: ${label} index deve essere >= 0`);
      }

      const serviceName = acs.ServiceName;
      if (!serviceName) {
        errors.push(`1.2.3: ${label} ServiceName mancante`);
      } else {
        const value =
          typeof serviceName === 'object' ? serviceName._ || serviceName['#text'] : serviceName;
        if (!value || String(value).trim() === '') {
          errors.push(`1.2.4: ${label} ServiceName deve avere un valore`);
        }
      }

      const reqAttrRaw = acs.RequestedAttribute;
      const reqList = reqAttrRaw ? (Array.isArray(reqAttrRaw) ? reqAttrRaw : [reqAttrRaw]) : [];

      if (reqList.length === 0) {
        errors.push(`1.2.5: ${label} deve contenere almeno un RequestedAttribute`);
      }

      reqList.forEach((ra, ridx) => {
        const rLabel = `${label}/RequestedAttribute[${ridx}]`;
        if (!('Name' in ra) || !ra.Name) {
          errors.push(`1.2.6: ${rLabel} attributo Name mancante o vuoto`);
        } else if (!this.allowedRequestedAttributes.includes(ra.Name)) {
          errors.push(`1.2.7: ${rLabel} Name="${ra.Name}" non è tra i valori ammessi per SPID`);
        }
      });
    });
  }

  // =====================================================
  // 1.4.x KeyDescriptor
  // =====================================================

  checkKeyDescriptor(sp, errors) {
    const raw = sp.KeyDescriptor;
    if (!raw) {
      errors.push('1.4.0: Deve essere presente almeno un KeyDescriptor per la firma');
      return;
    }

    const list = Array.isArray(raw) ? raw : [raw];

    const signing = list.filter(k => !k.use || k.use === 'signing');
    if (signing.length === 0) {
      errors.push('1.4.0: Nessun KeyDescriptor con use="signing" trovato');
    } else {
      const hasX509 = signing.some(k => {
        const kd = k.KeyInfo || k['ds:KeyInfo'];
        const x = kd && (kd.X509Data || kd['ds:X509Data']);
        const cert =
          x && (x.X509Certificate || x['ds:X509Certificate'] || x.certificate);
        return !!cert;
      });
      if (!hasX509) {
        errors.push('1.4.1: Nessun certificato X509 per signing trovato');
      }
    }

    const enc = list.filter(k => k.use === 'encryption');
    if (enc.length > 0) {
      const hasEncX509 = enc.some(k => {
        const kd = k.KeyInfo || k['ds:KeyInfo'];
        const x = kd && (kd.X509Data || kd['ds:X509Data']);
        const cert =
          x && (x.X509Certificate || x['ds:X509Certificate'] || x.certificate);
        return !!cert;
      });
      if (!hasEncX509) {
        errors.push(
          '1.4.2: È presente KeyDescriptor use="encryption" ma nessun certificato X509 di encryption'
        );
      }
    }
  }

  // =====================================================
  // 1.5.x Organization
  // =====================================================

  checkOrganization(entity, errors) {
    const org = entity.Organization;
    const result = { name: null, displayName: null, url: null };

    if (!org) {
      errors.push('1.5.0: Elemento Organization mancante');
      return result;
    }

    const orgNames = this.toArray(org.OrganizationName);
    const orgDisp = this.toArray(org.OrganizationDisplayName);
    const orgUrls = this.toArray(org.OrganizationURL);

    if (orgNames.length === 0) {
      errors.push('1.5.1: Deve essere presente almeno un OrganizationName');
    }
    orgNames.forEach((n, idx) => {
      const val = this.getLangValue(n);
      if (!this.getLangCode(n)) {
        errors.push(`1.5.2: OrganizationName[${idx}] deve avere attributo lang`);
      }
      if (!val || String(val).trim() === '') {
        errors.push(`1.5.3: OrganizationName[${idx}] deve avere un valore`);
      } else if (idx === 0) {
        result.name = val;
      }
    });

    if (orgDisp.length === 0) {
      errors.push('1.5.4: Deve essere presente almeno un OrganizationDisplayName');
    }
    orgDisp.forEach((n, idx) => {
      const val = this.getLangValue(n);
      if (!this.getLangCode(n)) {
        errors.push(`1.5.5: OrganizationDisplayName[${idx}] deve avere attributo lang`);
      }
      if (!val || String(val).trim() === '') {
        errors.push(`1.5.6: OrganizationDisplayName[${idx}] deve avere un valore`);
      } else if (idx === 0) {
        result.displayName = val;
      }
    });

    if (orgUrls.length === 0) {
      errors.push('1.5.7: Deve essere presente almeno un OrganizationURL');
    }
    orgUrls.forEach((u, idx) => {
      const val = this.getLangValue(u);
      if (!this.getLangCode(u)) {
        errors.push(`1.5.8: OrganizationURL[${idx}] deve avere attributo lang`);
      }
      if (!val || String(val).trim() === '') {
        errors.push(`1.5.9: OrganizationURL[${idx}] deve avere un valore`);
      } else if (!/^https?:\/\//.test(String(val))) {
        errors.push(`1.5.10: OrganizationURL[${idx}] deve essere una URL valida (http/https)`);
      } else if (idx === 0) {
        result.url = val;
      }
    });

    const countLang = arr => arr.map(this.getLangCode).filter(Boolean).length;
    if (
      countLang(orgNames) !== countLang(orgDisp) ||
      countLang(orgNames) !== countLang(orgUrls)
    ) {
      errors.push(
        '1.5.11: OrganizationName, OrganizationDisplayName e OrganizationURL devono avere lo stesso numero di lingue'
      );
    }

    return result;
  }

  // =====================================================
  // 1.8.x SingleLogoutService
  // =====================================================

  checkSingleLogoutService(sp, errors) {
    const raw = sp.SingleLogoutService;
    const list = raw ? (Array.isArray(raw) ? raw : [raw]) : [];

    if (list.length === 0) {
      errors.push('1.8.0: Deve essere presente almeno un SingleLogoutService');
      return;
    }

    list.forEach((slo, idx) => {
      const label = `SingleLogoutService[${idx}]`;

      if (!('Binding' in slo)) {
        errors.push(`1.8.1: ${label} Binding mancante`);
      } else if (!slo.Binding) {
        errors.push(`1.8.2: ${label} Binding presente ma senza valore`);
      } else if (
        slo.Binding !== 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST' &&
        slo.Binding !== 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect'
      ) {
        errors.push(`1.8.3: ${label} Binding deve essere HTTP-POST o HTTP-Redirect`);
      }

      if (!('Location' in slo)) {
        errors.push(`1.8.4: ${label} Location mancante`);
      } else if (!slo.Location) {
        errors.push(`1.8.5: ${label} Location presente ma senza valore`);
      } else if (!/^https?:\/\//.test(String(slo.Location))) {
        errors.push(`1.8.6: ${label} Location deve essere una URL valida (http/https)`);
      }
    });
  }

  // =====================================================
  // Utility
  // =====================================================

  toArray(val) {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
  }

  getLangCode(node) {
    if (!node || typeof node !== 'object') return null;
    return node['xml:lang'] || node.lang || null;
  }

  getLangValue(node) {
    if (!node) return null;
    if (typeof node === 'string') return node;
    return node._ || node['#text'] || null;
  }

  checkDuplicates(files) {
    const entityIDMap = new Map();
    const duplicates = [];

    files.forEach(file => {
      if (file.entityID) {
        if (entityIDMap.has(file.entityID)) {
          entityIDMap.get(file.entityID).push(file.filename);
        } else {
          entityIDMap.set(file.entityID, [file.filename]);
        }
      }
    });

    entityIDMap.forEach((filenames, entityID) => {
      if (filenames.length > 1) {
        duplicates.push({
          entityID,
          files: filenames
        });
      }
    });

    return duplicates;
  }
}
