// backend/services/XMLValidationService.js
import { DOMParser } from '@xmldom/xmldom';
import { select, select1 } from 'xpath';

// ─── Costanti SPID ───────────────────────────────────────────────────────────

const ALLOWED_BINDINGS = [
  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
];

const ALLOWED_SINGLELOGOUT_BINDINGS = [
  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
  'urn:oasis:names:tc:SAML:2.0:bindings:SOAP',
];

const ALLOWED_XMLDSIG_ALGS = [
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha384',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512',
  'http://www.w3.org/2007/05/xmldsig-more#ecdsa-sha256',
  'http://www.w3.org/2007/05/xmldsig-more#ecdsa-sha384',
  'http://www.w3.org/2007/05/xmldsig-more#ecdsa-sha512',
];

const ALLOWED_DGST_ALGS = [
  'http://www.w3.org/2001/04/xmlenc#sha256',
  'http://www.w3.org/2001/04/xmlenc#sha384',
  'http://www.w3.org/2001/04/xmlenc#sha512',
];

const SPID_ATTRIBUTES = [
  'spidCode', 'name', 'familyName', 'placeOfBirth', 'countyOfBirth',
  'dateOfBirth', 'gender', 'companyName', 'registeredOffice', 'fiscalNumber',
  'ivaCode', 'idCard', 'mobilePhone', 'email', 'address', 'expirationDate',
  'digitalAddress',
];

const NAMEID_TRANSIENT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient';

// ─── Namespace map per xpath ──────────────────────────────────────────────────

const NS = {
  md:   'urn:oasis:names:tc:SAML:2.0:metadata',
  ds:   'http://www.w3.org/2000/09/xmldsig#',
  spid: 'https://spid.gov.it/saml-extensions',
  xml:  'http://www.w3.org/XML/1998/namespace',
};

// ─── Helper xpath ─────────────────────────────────────────────────────────────

function xpSelect(doc, expr) {
  return select(expr, doc, false);   // ritorna array di nodi
}

function xpSelect1(doc, expr) {
  return select1(expr, doc);         // ritorna primo nodo o undefined
}

function attrVal(node, attr) {
  if (!node) return null;
  const a = node.getAttribute ? node.getAttribute(attr) : null;
  return a || null;
}

function textContent(node) {
  return node?.textContent?.trim() || null;
}

function isValidUrl(str) {
  try { new URL(str); return true; } catch { return false; }
}

function isHttpsUrl(str) {
  try { return new URL(str).protocol === 'https:'; } catch { return false; }
}

function hasNoCustomPort(str) {
  try { return !new URL(str).port; } catch { return false; }
}

// ─── Classe principale ────────────────────────────────────────────────────────

export class XMLValidationService {
  constructor(options = {}) {
    this.production = options.production ?? false;
  }

  /**
   * Valida un documento XML SPID SP Metadata.
   * Ritorna { valid, errors, warnings, entityID, organizationName }
   */
  async validate(xmlContent, filename = '') {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      entityID: null,
      organizationName: null,
    };

    // ── Parse XML ──────────────────────────────────────────────────────────
    let doc;
    try {
      const parser = new DOMParser({
        errorHandler: {
          warning: () => {},
          error: (msg) => { throw new Error(msg); },
          fatalError: (msg) => { throw new Error(msg); },
        },
      });
      doc = parser.parseFromString(xmlContent, 'application/xml');
    } catch (e) {
      result.valid = false;
      result.errors.push({ test_id: '0.0.0', message: `Errore parsing XML: ${e.message}` });
      return result;
    }

    const addError   = (test_id, message) => { result.errors.push({ test_id, message }); result.valid = false; };
    const addWarning = (test_id, message) => { result.warnings.push({ test_id, message }); };

    // ── 1. EntityDescriptor ────────────────────────────────────────────────
    this._testEntityDescriptor(doc, addError, addWarning, result);

    // ── 2. SPSSODescriptor ─────────────────────────────────────────────────
    this._testSPSSODescriptor(doc, addError);
    this._testSPSSODescriptorSPID(doc, addError);

    // ── 3. NameIDFormat ────────────────────────────────────────────────────
    this._testNameIDFormat(doc, addError);

    // ── 4. Signature ───────────────────────────────────────────────────────
    this._testSignature(doc, addError);

    // ── 5. KeyDescriptor ───────────────────────────────────────────────────
    this._testKeyDescriptor(doc, addError);

    // ── 6. SingleLogoutService ─────────────────────────────────────────────
    this._testSingleLogoutService(doc, addError, addWarning);

    // ── 7. AssertionConsumerService ────────────────────────────────────────
    this._testAssertionConsumerService(doc, addError);
    this._testAssertionConsumerServiceSPID(doc, addError);

    // ── 8. AttributeConsumingService ───────────────────────────────────────
    this._testAttributeConsumingService(doc, addError);
    this._testAttributeConsumingServiceSPID(doc, addError);

    // ── 9. Organization ────────────────────────────────────────────────────
    this._testOrganization(doc, addError, addWarning, result);

    return result;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST: EntityDescriptor
  // ────────────────────────────────────────────────────────────────────────────

  _testEntityDescriptor(doc, addError, addWarning, result) {
    const root = doc.documentElement;
    const localName = root?.localName;

    if (localName !== 'EntityDescriptor') {
      addError('1.3.0', 'Deve essere presente esattamente un elemento EntityDescriptor');
      return;
    }

    const entityID = root.getAttribute('entityID');
    if (!entityID) {
      addError('1.3.1', "L'attributo entityID DEVE essere presente in EntityDescriptor");
    } else {
      result.entityID = entityID;
      if (this.production) {
        if (!isHttpsUrl(entityID))
          addError('1.3.2', "L'attributo entityID DEVE essere un URL HTTPS valido");
        if (!hasNoCustomPort(entityID))
          addError('1.3.3', "L'attributo entityID NON deve contenere porte TCP custom (es. :8000)");
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST: SPSSODescriptor
  // ────────────────────────────────────────────────────────────────────────────

  _testSPSSODescriptor(doc, addError) {
    const nodes = doc.getElementsByTagNameNS('*', 'SPSSODescriptor');
    if (nodes.length !== 1) {
      addError('1.6.0', 'Deve essere presente esattamente un elemento SPSSODescriptor');
    }
  }

  _testSPSSODescriptorSPID(doc, addError) {
    const nodes = doc.getElementsByTagNameNS('*', 'SPSSODescriptor');
    if (!nodes.length) return;
    const spsso = nodes[0];

    for (const [attr, test_present, test_value, test_true] of [
      ['protocolSupportEnumeration', '1.6.1', '1.6.2', null],
      ['AuthnRequestsSigned',        '1.6.3', '1.6.4', '1.6.5'],
    ]) {
      const val = spsso.getAttribute(attr);
      if (!val && val !== '0') {
        addError(test_present, `L'attributo ${attr} DEVE essere presente in SPSSODescriptor`);
        addError(test_value,   `L'attributo ${attr} DEVE avere un valore`);
      } else {
        if (attr === 'AuthnRequestsSigned' && val.toLowerCase() !== 'true') {
          addError(test_true, `L'attributo AuthnRequestsSigned DEVE essere "true"`);
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST: NameIDFormat
  // ────────────────────────────────────────────────────────────────────────────

  _testNameIDFormat(doc, addError) {
    const nodes = doc.getElementsByTagNameNS('*', 'NameIDFormat');
    if (!nodes.length) return;
    const val = nodes[0]?.textContent?.trim();
    if (val !== NAMEID_TRANSIENT) {
      addError('1.10.0', `NameIDFormat DEVE essere "${NAMEID_TRANSIENT}"`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST: Signature
  // ────────────────────────────────────────────────────────────────────────────

  _testSignature(doc, addError) {
    const signs = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature');
    if (!signs.length) {
      addError('1.7.0', "L'elemento Signature DEVE essere presente in EntityDescriptor");
      return;
    }

    const sign = signs[0];

    // SignatureMethod
    const sigMethods = sign.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'SignatureMethod');
    if (!sigMethods.length) {
      addError('1.7.1', "L'elemento SignatureMethod DEVE essere presente");
    } else {
      const alg = sigMethods[0].getAttribute('Algorithm');
      if (!alg) {
        addError('1.7.2', "L'attributo Algorithm DEVE essere presente in SignatureMethod");
      } else if (!ALLOWED_XMLDSIG_ALGS.includes(alg)) {
        addError('1.7.3', `L'algoritmo di firma "${alg}" non è valido. Consentiti: ${ALLOWED_XMLDSIG_ALGS.join(', ')}`);
      }
    }

    // DigestMethod
    const digestMethods = sign.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'DigestMethod');
    if (!digestMethods.length) {
      addError('1.7.4', "L'elemento DigestMethod DEVE essere presente");
    } else {
      const alg = digestMethods[0].getAttribute('Algorithm');
      if (!alg) {
        addError('1.7.5', "L'attributo Algorithm DEVE essere presente in DigestMethod");
      } else if (!ALLOWED_DGST_ALGS.includes(alg)) {
        addError('1.7.6', `L'algoritmo di digest "${alg}" non è valido. Consentiti: ${ALLOWED_DGST_ALGS.join(', ')}`);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST: KeyDescriptor
  // ────────────────────────────────────────────────────────────────────────────

  _testKeyDescriptor(doc, addError) {
    const allKds = doc.getElementsByTagNameNS('*', 'KeyDescriptor');

    // signing
    const signingKds = Array.from(allKds).filter(kd => kd.getAttribute('use') === 'signing');
    if (signingKds.length < 1) {
      addError('1.4.0', 'Almeno un KeyDescriptor con use="signing" DEVE essere presente');
    } else {
      for (const kd of signingKds) {
        const certs = kd.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'X509Certificate');
        if (!certs.length || !certs[0]?.textContent?.trim()) {
          addError('1.4.1', 'Almeno un certificato X509 di signing DEVE essere presente');
        }
      }
    }

    // encryption (opzionale ma se presente deve avere certificato)
    const encKds = Array.from(allKds).filter(kd => kd.getAttribute('use') === 'encryption');
    for (const kd of encKds) {
      const certs = kd.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'X509Certificate');
      if (!certs.length || !certs[0]?.textContent?.trim()) {
        addError('1.4.2', 'Almeno un certificato X509 di encryption DEVE essere presente');
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST: SingleLogoutService
  // ────────────────────────────────────────────────────────────────────────────

  _testSingleLogoutService(doc, addError, addWarning) {
    const slos = doc.getElementsByTagNameNS('*', 'SingleLogoutService');
    if (!slos.length) {
      addError('1.8.0', 'Almeno un elemento SingleLogoutService DEVE essere presente');
      return;
    }

    for (const slo of Array.from(slos)) {
      // Binding
      const binding = slo.getAttribute('Binding');
      if (!binding) {
        addError('1.8.1', "L'attributo Binding in SingleLogoutService DEVE essere presente");
      } else if (!ALLOWED_SINGLELOGOUT_BINDINGS.includes(binding)) {
        addError('1.8.3', `Il Binding "${binding}" non è valido. Consentiti: ${ALLOWED_SINGLELOGOUT_BINDINGS.join(', ')}`);
      }

      // Location
      const location = slo.getAttribute('Location');
      if (!location) {
        addError('1.8.4', "L'attributo Location in SingleLogoutService DEVE essere presente");
      } else {
        if (this.production) {
          if (!isHttpsUrl(location))
            addError('1.8.6', "Location in SingleLogoutService DEVE essere un URL HTTPS valido");
          if (!hasNoCustomPort(location))
            addWarning('1.8.7', "Location in SingleLogoutService NON dovrebbe contenere porte TCP custom");
        } else if (!isValidUrl(location)) {
          addError('1.8.5', "Location in SingleLogoutService DEVE essere un URL valido");
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST: AssertionConsumerService
  // ────────────────────────────────────────────────────────────────────────────

  _testAssertionConsumerService(doc, addError) {
    const acss = doc.getElementsByTagNameNS('*', 'AssertionConsumerService');
    if (!acss.length) {
      addError('1.1.0', 'Almeno un elemento AssertionConsumerService DEVE essere presente');
      return;
    }

    for (const acs of Array.from(acss)) {
      const index = acs.getAttribute('index');
      if (index === null || index === '') {
        addError('1.1.1', "L'attributo index DEVE essere presente in AssertionConsumerService");
      } else if (parseInt(index) < 0) {
        addError('1.1.2', "L'attributo index DEVE essere >= 0");
      }

      const binding = acs.getAttribute('Binding');
      if (!binding) {
        addError('1.1.3', "L'attributo Binding DEVE essere presente in AssertionConsumerService");
      } else if (!ALLOWED_BINDINGS.includes(binding)) {
        addError('1.1.4', `Il Binding "${binding}" non è valido. Consentiti: ${ALLOWED_BINDINGS.join(', ')}`);
      }

      const location = acs.getAttribute('Location');
      if (!location) {
        addError('1.1.5', "L'attributo Location DEVE essere presente in AssertionConsumerService");
      } else if (this.production && !isHttpsUrl(location)) {
        addError('1.1.6', "Location in AssertionConsumerService DEVE essere un URL HTTPS valido");
      }
    }
  }

  _testAssertionConsumerServiceSPID(doc, addError) {
    const allAcs = doc.getElementsByTagNameNS('*', 'AssertionConsumerService');

    // Deve esserci esattamente un ACS con isDefault="true"
    const defaults = Array.from(allAcs).filter(a => a.getAttribute('isDefault') === 'true');
    if (defaults.length !== 1) {
      addError('1.1.7', 'Deve essere presente esattamente un AssertionConsumerService con isDefault="true"');
    }

    // Deve esserci un ACS con index="0" e isDefault="true"
    const defaultZero = Array.from(allAcs).filter(
      a => a.getAttribute('isDefault') === 'true' && a.getAttribute('index') === '0'
    );
    if (defaultZero.length !== 1) {
      addError('1.1.8', 'Deve essere presente il default AssertionConsumerService con index="0" e isDefault="true"');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST: AttributeConsumingService
  // ────────────────────────────────────────────────────────────────────────────

  _testAttributeConsumingService(doc, addError) {
    const acss = doc.getElementsByTagNameNS('*', 'AttributeConsumingService');
    if (!acss.length) {
      addError('1.2.0', 'Almeno un elemento AttributeConsumingService DEVE essere presente');
    }
  }

  _testAttributeConsumingServiceSPID(doc, addError) {
    const acss = doc.getElementsByTagNameNS('*', 'AttributeConsumingService');

    for (const acs of Array.from(acss)) {
      const index = acs.getAttribute('index');
      if (index === null || index === '') {
        addError('1.2.1', "L'attributo index DEVE essere presente in AttributeConsumingService");
      } else if (parseInt(index) < 0) {
        addError('1.2.2', "L'attributo index in AttributeConsumingService DEVE essere >= 0");
      }

      // ServiceName
      const sn = acs.getElementsByTagNameNS('*', 'ServiceName');
      if (!sn.length) {
        addError('1.2.3', "L'elemento ServiceName DEVE essere presente in AttributeConsumingService");
      } else {
        for (const s of Array.from(sn)) {
          if (!s.textContent?.trim()) {
            addError('1.2.4', "L'elemento ServiceName DEVE avere un valore");
          }
        }
      }

      // RequestedAttribute
      const ras = acs.getElementsByTagNameNS('*', 'RequestedAttribute');
      if (!ras.length) {
        addError('1.2.5', 'Almeno un elemento RequestedAttribute DEVE essere presente');
      }

      const usedNames = [];
      for (const ra of Array.from(ras)) {
        const name = ra.getAttribute('Name');
        if (!name) {
          addError('1.2.6', "L'attributo Name DEVE essere presente in RequestedAttribute");
        } else {
          if (!SPID_ATTRIBUTES.includes(name)) {
            addError('1.2.7', `L'attributo RequestedAttribute Name="${name}" non è un attributo SPID valido. Consentiti: ${SPID_ATTRIBUTES.join(', ')}`);
          }
          usedNames.push(name);
        }
      }

      // No duplicati
      if (usedNames.length !== new Set(usedNames).size) {
        addError('1.2.8', 'AttributeConsumingService NON deve contenere RequestedAttribute duplicati');
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST: Organization
  // ────────────────────────────────────────────────────────────────────────────

  _testOrganization(doc, addError, addWarning, result) {
    const orgs = doc.getElementsByTagNameNS('*', 'Organization');
    if (orgs.length !== 1) {
      addError('1.5.0', 'Deve essere presente esattamente un elemento Organization');
      return;
    }

    const org = orgs[0];
    const enames = ['OrganizationName', 'OrganizationDisplayName', 'OrganizationURL'];
    const langCounters = {};

    for (const ename of enames) {
      const elements = org.getElementsByTagNameNS('*', ename);
      if (!elements.length) {
        addError('1.5.1', `Almeno un elemento ${ename} DEVE essere presente in Organization`);
        continue;
      }

      for (const el of Array.from(elements)) {
        const lang = el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang');
        if (!lang) {
          addError('1.5.2', `L'attributo xml:lang DEVE essere presente in ${ename}`);
        } else {
          langCounters[lang] = (langCounters[lang] || 0) + 1;
        }

        const text = el.textContent?.trim();
        if (!text) {
          addError('1.5.3', `L'elemento ${ename} DEVE avere un valore`);
        }

        // Estrai OrganizationName per la lista file
        if (ename === 'OrganizationName' && lang === 'it' && text) {
          result.organizationName = text;
        }

        if (ename === 'OrganizationURL' && this.production && text) {
          const url = text.startsWith('http') ? text : `https://${text}`;
          if (!isValidUrl(url)) {
            addError('1.5.10', `${ename} DEVE essere un URL valido`);
          }
        }
      }
    }

    // Verifica che ogni lingua abbia tutti e 3 gli elementi
    for (const [lang, count] of Object.entries(langCounters)) {
      if (count !== enames.length) {
        addWarning('1.5.5', `Gli elementi OrganizationName, OrganizationDisplayName e OrganizationURL DEVONO avere lo stesso numero di attributi xml:lang (lingua: ${lang})`);
      }
    }

    // Deve esserci almeno la lingua italiana
    if (!langCounters['it']) {
      addError('1.5.6', 'Gli elementi Organization DEVONO avere almeno la lingua "it"');
    }
  }
}

export default XMLValidationService;
