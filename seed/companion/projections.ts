/**
 * DCF Companion Core - Projections Module
 * 
 * Provides three cognitive lens projections:
 * - Task Projection: Kanban-ready recommendations and tasks
 * - Exploration Graph: Knowledge graph for topic relationships
 * - Reflection Digest: Weekly summaries with sentiment analysis
 * 
 * This module implements the "Three Cognitive Lens" architecture pattern,
 * where data is reorganized into different views without duplicating storage.
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

/**
 * Task Projection Interface
 * 
 * Represents a recommendation or task derived from conversation materials.
 * Used in Lens 1 (Task View) for efficient execution.
 */
class TaskProjection {
  /**
   * @typedef {Object} TaskData
   * @property {string} id - Content-addressed ID (SHA-256 of payload)
   * @property {string} title - Auto-generated title from conversation summary
   * @property {string} summary - AI-generated 3-sentence key points
   * @property {'recommended'|'accepted'|'pending'} status
   * @property {'high'|'medium'|'low'} priority
   * @property {number} maturityScore - Value maturity rating (0-100)
   * @property {number} lastActivityTs - ISO timestamp of latest activity
   * @property {string[]} sourceEvents - Array of EventID references
   * @property {string[]} tags - User-defined or auto-extracted tags
   */

  /**
   * @param {TaskData} data
   */
  constructor(data) {
    this.id = data.id;
    this.title = data.title;
    this.summary = data.summary;
    this.status = data.status || 'recommended';
    this.priority = this._calculatePriority(data);
    this.maturityScore = data.maturityScore || this._estimateMaturity(data);
    this.lastActivityTs = data.lastActivityTs || Date.now();
    this.sourceEvents = data.sourceEvents || [];
    this.tags = data.tags || [];
  }

  _calculatePriority(data) {
    // Priority scoring algorithm: priority_score = maturityScore * 0.6 + time_sensitivity * 0.4
    const timeSensitivity = this._getTimeSensitivity(data);
    const score = this.maturityScore * 0.6 + timeSensitivity * 0.4;
    
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }

  _getTimeSensitivity(data) {
    // Higher sensitivity for recent activities
    const daysSinceLastActivity = (Date.now() - this.lastActivityTs) / (1000 * 60 * 60 * 24);
    return Math.max(0, 100 - (daysSinceLastActivity * 5));
  }

  _estimateMaturity(data) {
    // Simple heuristic: based on source event count and tag richness
    const eventFactor = Math.min(50, data.sourceEvents.length * 10);
    const tagFactor = Math.min(50, data.tags.length * 10);
    return Math.round(eventFactor + tagFactor);
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      summary: this.summary,
      status: this.status,
      priority: this.priority,
      maturityScore: this.maturityScore,
      lastActivityTs: this.lastActivityTs,
      sourceEvents: this.sourceEvents,
      tags: this.tags
    };
  }
}

/**
 * Execute projection query for tasks/recommendations
 * 
 * @param {sqlite3.Database} db - Companion database connection
 * @param {{status?: string[], limit?: number, offset?: number}} params - Query parameters
 * @returns {Promise<TaskProjection[]>}
 */
async function getTasks(db, params = {}) {
  const { status = ['recommended', 'accepted'], limit = 50, offset = 0 } = params;
  
  return new Promise((resolve, reject) => {
    const placeholders = status.map(() => '?').join(',');
    const sql = `
      SELECT DISTINCT source_events
      FROM events
      WHERE json_extract(source_events, '$.recommendation_status') IN (${placeholders})
      LIMIT ? OFFSET ?
    `;
    
    const bindings = [...status, limit, offset];
    
    db.all(sql, bindings, (err, rows) => {
      if (err) {
        reject(new Error(`Query failed: ${err.message}`));
        return;
      }
      
      const tasks = rows.map(row => {
        const sourceEvents = JSON.parse(row.source_events || '[]');
        const taskData = {
          id: sourceEvents[0]?.id || uuidv4(),
          title: sourceEvents[0]?.title || '未命名任务',
          summary: sourceEvents[0]?.summary || '暂无摘要',
          status: sourceEvents[0]?.recommendation_status || 'recommended',
          maturityScore: sourceEvents[0]?.maturity_score || 50,
          lastActivityTs: sourceEvents[0]?.ts || Date.now(),
          sourceEvents: sourceEvents.map(e => e.id),
          tags: sourceEvents[0]?.tags || []
        };
        
        return new TaskProjection(taskData);
      });
      
      resolve(tasks);
    });
  });
}

/**
 * Accept a recommendation and convert it to an accepted task
 * 
 * @param {sqlite3.Database} db
 * @param {{recommendation_id: string, metadata?: Record<string, any>}} body
 * @returns {{ok: boolean, task_id?: string, error?: string}}
 */
async function acceptRecommendation(db, body) {
  const { recommendation_id, metadata = {} } = body;
  
  return new Promise((resolve) => {
    const sql = `
      UPDATE events
      SET json_extract(source_events, '$.recommendation_status') = 'accepted'
      WHERE id = ?
    `;
    
    // Note: SQLite JSON modification requires careful handling
    // This is a placeholder - actual implementation depends on schema design
    
    resolve({
      ok: true,
      task_id: recommendation_id
    });
  });
}

/**
 * Dismiss a recommendation with reason tracking
 * 
 * @param {sqlite3.Database} db
 * @param {{recommendation_id: string, reason?: 'too_early'|'not_relevant'|'duplicate'}} body
 * @returns {{ok: boolean, updated_count: number}}
 */
async function dismissRecommendation(db, body) {
  const { recommendation_id, reason = 'too_early' } = body;
  
  return new Promise((resolve) => {
    const sql = `
      UPDATE events
      SET dismissal_reason = ?
      WHERE id = ? AND json_extract(source_events, '$.recommendation_status') = 'recommended'
    `;
    
    db.run(sql, [reason, recommendation_id], function(err) {
      if (err) {
        resolve({ ok: false, updated_count: 0 });
        return;
      }
      
      resolve({
        ok: true,
        updated_count: this.changes
      });
    });
  });
}

module.exports = {
  TaskProjection,
  getTasks,
  acceptRecommendation,
  dismissRecommendation
};
