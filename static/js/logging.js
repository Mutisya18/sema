// logging.js — Client-side structured logging service
// Queues logs and batches them to /api/dev/logs every BATCH_INTERVAL_MS

'use strict';

const BATCH_INTERVAL_MS = 5000; // Send logs every 5 seconds
const MAX_BATCH_SIZE = 50; // Max logs per batch

class FrontendLogger {
  constructor() {
    this.logQueue = [];
    this.sessionId = null;
    this.batchIntervalId = null;
  }

  /**
   * Initialize the logger with a session ID from the login response.
   * Starts the batch submission interval.
   *
   * @param {string} sessionId - The server-side session ID
   */
  init(sessionId) {
    console.log('[LOGGER] Initializing with session ID:', sessionId?.substring(0, 8) + '...');
    this.sessionId = sessionId;
    this.logQueue = [];
    console.log('[LOGGER] Queue cleared');

    // Start periodic batch submission
    if (this.batchIntervalId) {
      console.log('[LOGGER] Clearing existing batch interval');
      clearInterval(this.batchIntervalId);
    }
    this.batchIntervalId = setInterval(() => {
      console.log('[LOGGER] Batch interval triggered, queue size:', this.logQueue.length);
      this._submitBatch();
    }, BATCH_INTERVAL_MS);
    console.log('[LOGGER] Batch interval started, interval ID:', this.batchIntervalId);
  }

  /**
   * Queue a structured log event.
   *
   * @param {string} event - Event name (e.g., 'login_success', 'api_call')
   * @param {string} status - 'success', 'failure', or custom status
   * @param {object} metadata - Additional context
   */
  log(event, status = 'success', metadata = {}) {
    if (!this.sessionId) {
      console.warn('[LOGGER] log() called but sessionId is not set');
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      status,
      metadata,
    };

    console.log('[LOGGER] Queued event:', event, 'status:', status, 'total in queue:', this.logQueue.length + 1);
    this.logQueue.push(logEntry);

    // Submit immediately if batch is full
    if (this.logQueue.length >= MAX_BATCH_SIZE) {
      console.log('[LOGGER] Queue is full (' + MAX_BATCH_SIZE + '), submitting batch immediately');
      this._submitBatch();
    }
  }

  /**
   * Submit queued logs to the backend as a batch.
   * Private method — called on interval or when batch is full.
   */
  async _submitBatch() {
    if (this.logQueue.length === 0 || !this.sessionId) {
      console.log('[LOGGER] _submitBatch skipped: queue empty or no sessionId');
      return;
    }

    const logsToSubmit = this.logQueue.splice(0, this.logQueue.length);
    console.log('[LOGGER] Submitting batch of', logsToSubmit.length, 'logs');

    try {
      const body = JSON.stringify({ logs: logsToSubmit });
      console.log('[LOGGER] Fetch request to /api/dev/logs with body:', body.substring(0, 100) + '...');
      
      const res = await fetch('/api/dev/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: body,
      });

      console.log('[LOGGER] Response status:', res.status, res.ok);
      
      if (!res.ok) {
        console.warn('[LOGGER] Failed to submit logs: HTTP', res.status);
        // Re-queue on failure (optional — prevents log loss)
        // this.logQueue.unshift(...logsToSubmit);
      } else {
        console.log('[LOGGER] Batch submitted successfully');
      }
    } catch (err) {
      console.error('[LOGGER] Fetch error:', err);
      console.error('[LOGGER] Stack:', err.stack);
      // Re-queue on network error
      // this.logQueue.unshift(...logsToSubmit);
    }
  }

  /**
   * Force submit any pending logs immediately.
   * Call this before logout.
   */
  flushLogs() {
    console.log('[LOGGER] flushLogs called, queue size:', this.logQueue.length);
    this._submitBatch();
  }

  /**
   * Cleanup: stop the batch interval.
   */
  destroy() {
    console.log('[LOGGER] destroy called');
    if (this.batchIntervalId) {
      console.log('[LOGGER] Clearing batch interval');
      clearInterval(this.batchIntervalId);
      this.batchIntervalId = null;
    }
    console.log('[LOGGER] Final flush before destroy');
    this._submitBatch();
    this.sessionId = null;
    console.log('[LOGGER] Logger destroyed');
  }
}

// Global logger instance
const logger = new FrontendLogger();
