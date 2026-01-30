import React from 'react';
import '../styles/ProgressBar.css';

/**
 * Barra di progresso con step
 */
function ProgressBar({ steps, currentStep }) {
  const percentage = ((currentStep + 1) / steps.length) * 100;

  return (
    <div className="progress-container">
      <div className="progress-steps">
        {steps.map((step, index) => (
          <div 
            key={index} 
            className={`progress-step ${
              index < currentStep ? 'completed' : 
              index === currentStep ? 'active' : 'pending'
            }`}
          >
            <div className="step-number">{index + 1}</div>
            <div className="step-label">{step}</div>
          </div>
        ))}
      </div>
      <div className="progress-bar">
        <div 
          className="progress-fill" 
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
