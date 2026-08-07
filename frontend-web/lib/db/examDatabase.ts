/**
 * IndexedDB database for offline exam support
 * Stores exam templates, attempts, and progress locally
 */

export interface ExamTemplate {
  id: string;
  name: string;
  description: string;
  questionCount: number;
  duration: number;
  difficultyLevel: 'easy' | 'medium' | 'hard';
  syllabus: string;
  subject: string;
  classLevel: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExamProgress {
  attemptId: string;
  templateId: string;
  userId: string;
  answers: Record<number, string>;
  flagged: number[];
  currentQuestion: number;
  timeSpent: number;
  totalTime: number;
  startedAt: number;
  lastSavedAt: number;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
}

export interface ExamResult {
  attemptId: string;
  templateId: string;
  userId: string;
  score: number;
  grade: string;
  totalQuestions: number;
  correctAnswers: number;
  timeSpent: number;
  submittedAt: number;
  synced: boolean;
}

export interface SyncQueue {
  id: string;
  attemptId: string;
  action: 'save_progress' | 'submit_exam';
  payload: any;
  createdAt: number;
  retries: number;
  lastError?: string;
}

const DB_NAME = 'spotlight-exams';
const DB_VERSION = 1;

export class ExamDatabase {
  private db: IDBDatabase | null = null;

  /**
   * Initialize IndexedDB connection
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Exam templates store
        if (!db.objectStoreNames.contains('templates')) {
          const templateStore = db.createObjectStore('templates', { keyPath: 'id' });
          templateStore.createIndex('classLevel', 'classLevel', { unique: false });
          templateStore.createIndex('subject', 'subject', { unique: false });
        }

        // Exam progress store (in-progress attempts)
        if (!db.objectStoreNames.contains('progress')) {
          const progressStore = db.createObjectStore('progress', { keyPath: 'attemptId' });
          progressStore.createIndex('templateId', 'templateId', { unique: false });
          progressStore.createIndex('userId', 'userId', { unique: false });
          progressStore.createIndex('syncStatus', 'syncStatus', { unique: false });
        }

        // Exam results store (completed attempts)
        if (!db.objectStoreNames.contains('results')) {
          const resultsStore = db.createObjectStore('results', { keyPath: 'attemptId' });
          resultsStore.createIndex('templateId', 'templateId', { unique: false });
          resultsStore.createIndex('userId', 'userId', { unique: false });
          resultsStore.createIndex('synced', 'synced', { unique: false });
        }

        // Sync queue for offline submissions
        if (!db.objectStoreNames.contains('syncQueue')) {
          const queueStore = db.createObjectStore('syncQueue', {
            keyPath: 'id',
            autoIncrement: true,
          });
          queueStore.createIndex('attemptId', 'attemptId', { unique: false });
          queueStore.createIndex('action', 'action', { unique: false });
        }
      };
    });
  }

  /**
   * Save exam template for offline access
   */
  async saveTemplate(template: ExamTemplate): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['templates'], 'readwrite');
      const store = transaction.objectStore('templates');
      const request = store.put(template);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get exam template from cache
   */
  async getTemplate(templateId: string): Promise<ExamTemplate | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['templates'], 'readonly');
      const store = transaction.objectStore('templates');
      const request = store.get(templateId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Get all cached templates by class level
   */
  async getTemplatesByClass(classLevel: string): Promise<ExamTemplate[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['templates'], 'readonly');
      const store = transaction.objectStore('templates');
      const index = store.index('classLevel');
      const request = index.getAll(classLevel);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Save exam progress locally
   */
  async saveProgress(progress: ExamProgress): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['progress'], 'readwrite');
      const store = transaction.objectStore('progress');
      const request = store.put({
        ...progress,
        lastSavedAt: Date.now(),
      });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get exam progress by attempt ID
   */
  async getProgress(attemptId: string): Promise<ExamProgress | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['progress'], 'readonly');
      const store = transaction.objectStore('progress');
      const request = store.get(attemptId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Get all in-progress attempts for a user
   */
  async getProgressByUser(userId: string): Promise<ExamProgress[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['progress'], 'readonly');
      const store = transaction.objectStore('progress');
      const index = store.index('userId');
      const request = index.getAll(userId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Get pending syncs
   */
  async getPendingSyncs(): Promise<ExamProgress[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['progress'], 'readonly');
      const store = transaction.objectStore('progress');
      const index = store.index('syncStatus');
      const request = index.getAll('pending');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Save exam result locally
   */
  async saveResult(result: ExamResult): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['results'], 'readwrite');
      const store = transaction.objectStore('results');
      const request = store.put(result);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get exam result
   */
  async getResult(attemptId: string): Promise<ExamResult | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['results'], 'readonly');
      const store = transaction.objectStore('results');
      const request = store.get(attemptId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Get all results for a user
   */
  async getResultsByUser(userId: string): Promise<ExamResult[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['results'], 'readonly');
      const store = transaction.objectStore('results');
      const index = store.index('userId');
      const request = index.getAll(userId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Add to sync queue (for offline submissions)
   */
  async queueSync(
    attemptId: string,
    action: 'save_progress' | 'submit_exam',
    payload: any
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['syncQueue'], 'readwrite');
      const store = transaction.objectStore('syncQueue');
      const request = store.add({
        attemptId,
        action,
        payload,
        createdAt: Date.now(),
        retries: 0,
      });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get sync queue
   */
  async getSyncQueue(): Promise<SyncQueue[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['syncQueue'], 'readonly');
      const store = transaction.objectStore('syncQueue');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Remove from sync queue (after successful sync)
   */
  async removeSyncQueueItem(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['syncQueue'], 'readwrite');
      const store = transaction.objectStore('syncQueue');
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Update sync queue item after failed retry
   */
  async updateSyncQueueRetry(id: number, error: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise(async (resolve, reject) => {
      const transaction = this.db!.transaction(['syncQueue'], 'readwrite');
      const store = transaction.objectStore('syncQueue');
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const item = getRequest.result as SyncQueue;
        const updateRequest = store.put({
          ...item,
          retries: item.retries + 1,
          lastError: error,
        });

        updateRequest.onerror = () => reject(updateRequest.error);
        updateRequest.onsuccess = () => resolve();
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Clear all data (reset database)
   */
  async clear(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        ['templates', 'progress', 'results', 'syncQueue'],
        'readwrite'
      );

      const templates = transaction.objectStore('templates').clear();
      const progress = transaction.objectStore('progress').clear();
      const results = transaction.objectStore('results').clear();
      const queue = transaction.objectStore('syncQueue').clear();

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
    });
  }

  /**
   * Get database size estimate
   */
  async getStorageInfo(): Promise<{ usage: number; quota: number }> {
    if (!navigator.storage || !navigator.storage.estimate) {
      return { usage: 0, quota: 0 };
    }

    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0,
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton instance
let dbInstance: ExamDatabase | null = null;

export async function getExamDatabase(): Promise<ExamDatabase> {
  if (!dbInstance) {
    dbInstance = new ExamDatabase();
    await dbInstance.init();
  }
  return dbInstance;
}
