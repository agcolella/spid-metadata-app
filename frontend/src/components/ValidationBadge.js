import React from 'react';
import './ValidationBadge.css';

export function ValidationBadge({ validation }) {
  if (!validation) return null;

  const hasErrors = validation.errors && validation.errors.length > 0;
  const hasWarnings = validation.warnings && validation.warnings.length > 0;

  if (!hasErrors && !hasWarnings) {
    return <span className="validation-badge success">✓ Valido</span>;
  }

  if (hasErrors) {
    return (
      <span 
        className="validation-badge error" 
        title={validation.errors.join('\n')}
      >
        ✕ {validation.errors.length} errore{validation.errors.length > 1 ? 'i' : ''}
      </span>
    );
  }

  return (
    <span 
      className="validation-badge warning" 
      title={validation.warnings.join('\n')}
    >
      ⚠ {validation.warnings.length} warning
    </span>
  );
}
