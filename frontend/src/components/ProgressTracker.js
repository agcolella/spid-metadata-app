import React from 'react';
import './ProgressTracker.css';

export function ProgressTracker({ steps, currentStep }) {
  return (
    <div className="progress-tracker-container">
      <div className="progress-tracker">
        {steps.map((step, idx) => (
          <div 
            key={idx} 
            className={`progress-step ${idx < currentStep ? 'completed' : ''} ${idx === currentStep ? 'active' : ''} ${idx > currentStep ? 'pending' : ''}`}
          >
            <div className="step-indicator">
              {idx < currentStep ? (
                <span className="step-check">✓</span>
              ) : idx === currentStep ? (
                <span className="step-spinner"></span>
              ) : (
                <span className="step-number">{idx + 1}</span>
              )}
            </div>
            <div className="step-label">{step}</div>
          </div>
        ))}
      </div>
      <div className="progress-tracker-message">
        {currentStep < steps.length ? (
          <>Elaborazione in corso: <strong>{steps[currentStep]}</strong></>
        ) : (
          <>Completato!</>
        )}
      </div>
    </div>
  );
}
