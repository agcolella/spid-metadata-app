// Sistema di notifiche toast al posto di alert()
class NotificationService {
  constructor() {
    this.container = null;
    this.notifications = [];
    this.init();
  }

  init() {
    // Crea container per le notifiche
    if (!document.getElementById('notification-container')) {
      this.container = document.createElement('div');
      this.container.id = 'notification-container';
      this.container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 12px;
        pointer-events: none;
      `;
      document.body.appendChild(this.container);
    } else {
      this.container = document.getElementById('notification-container');
    }
  }

  show(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    const id = Date.now() + Math.random();
    
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };

    const colors = {
      success: { bg: '#d1fae5', border: '#10b981', text: '#065f46' },
      error: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
      warning: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
      info: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' }
    };

    const color = colors[type] || colors.info;

    notification.style.cssText = `
      background: ${color.bg};
      color: ${color.text};
      border-left: 4px solid ${color.border};
      padding: 16px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      min-width: 300px;
      max-width: 500px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      font-size: 0.95rem;
      font-weight: 500;
      pointer-events: auto;
      cursor: pointer;
      animation: slideIn 0.3s ease-out;
      transition: all 0.3s ease;
    `;

    notification.innerHTML = `
      <span style="font-size: 1.4rem; flex-shrink: 0;">${icons[type]}</span>
      <span style="flex: 1; line-height: 1.4;">${message}</span>
      <span style="font-size: 1.2rem; opacity: 0.6; flex-shrink: 0;">×</span>
    `;

    // Aggiungi animazione CSS
    if (!document.getElementById('notification-styles')) {
      const style = document.createElement('style');
      style.id = 'notification-styles';
      style.textContent = `
        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(400px);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    // Click per chiudere
    notification.onclick = () => this.remove(notification);

    // Hover per fermare timer
    let timeoutId;
    notification.onmouseenter = () => {
      if (timeoutId) clearTimeout(timeoutId);
    };

    notification.onmouseleave = () => {
      timeoutId = setTimeout(() => this.remove(notification), 2000);
    };

    this.container.appendChild(notification);
    this.notifications.push({ id, element: notification });

    // Auto-remove dopo durata
    timeoutId = setTimeout(() => this.remove(notification), duration);
  }

  remove(notification) {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
      this.notifications = this.notifications.filter(n => n.element !== notification);
    }, 300);
  }

  success(message, duration) {
    this.show(message, 'success', duration);
  }

  error(message, duration) {
    this.show(message, 'error', duration);
  }

  warning(message, duration) {
    this.show(message, 'warning', duration);
  }

  info(message, duration) {
    this.show(message, 'info', duration);
  }

  clear() {
    this.notifications.forEach(n => this.remove(n.element));
  }
}

// Esporta istanza singleton
export const notify = new NotificationService();
