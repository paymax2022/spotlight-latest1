/**
 * Performance metrics collection and monitoring
 * Web Vitals, custom metrics, and performance analytics
 */

/**
 * Web Vitals metrics
 */
export interface WebVitals {
  // Largest Contentful Paint (when largest element becomes visible)
  lcp?: number; // milliseconds
  lcpElement?: string;

  // First Input Delay (responsiveness)
  fid?: number; // milliseconds

  // Cumulative Layout Shift (visual stability)
  cls?: number; // score 0-1

  // First Contentful Paint (when first content appears)
  fcp?: number; // milliseconds

  // Time to First Byte (server response)
  ttfb?: number; // milliseconds

  // Interaction to Next Paint (responsiveness)
  inp?: number; // milliseconds
}

/**
 * Exam-specific performance metrics
 */
export interface ExamMetrics {
  examDuration: number; // total time in exam
  questionAnswerTime: number; // average per question
  navigationTime: number; // time between questions
  offlineTime: number; // time spent offline
  syncDuration: number; // time for sync operations
  questionsAnswered: number;
  questionsSkipped: number;
  flaggedForReview: number;
  networkChanges: number; // offline/online transitions
  gesturesTouchCount: number;
  errorCount: number;
}

/**
 * System health metrics
 */
export interface SystemMetrics {
  memoryUsage: number; // MB
  batteryLevel: number; // 0-100%
  networkType: string; // 4g, 3g, etc
  deviceOrientation: 'portrait' | 'landscape';
  screenBrightness: number; // 0-100%
  cpuUsage: number; // 0-100% (estimated)
  fps: number; // frames per second
}

/**
 * Collected metrics snapshot
 */
export interface MetricsSnapshot {
  timestamp: number;
  webVitals: Partial<WebVitals>;
  examMetrics: Partial<ExamMetrics>;
  systemMetrics: Partial<SystemMetrics>;
  sessionId: string;
}

/**
 * Performance metrics collector
 */
export class PerformanceMetricsCollector {
  private sessionId: string;
  private snapshots: MetricsSnapshot[] = [];
  private observers: PerformanceObserver[] = [];
  private startTime: number = Date.now();
  private examStart?: number;
  private networkChanges: number = 0;
  private lastNetworkType: string = '';

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.initializeWebVitalsCollection();
    this.initializeNetworkMonitoring();
  }

  /**
   * Initialize Web Vitals collection
   */
  private initializeWebVitalsCollection(): void {
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) {
      return;
    }

    try {
      // Largest Contentful Paint
      const lcpObserver = new PerformanceObserver((list) => {
        const lastEntry = list.getEntries().pop();
        if (lastEntry) {
          this.recordWebVital('lcp', {
            lcp: lastEntry.startTime,
            lcpElement: (lastEntry as any).element?.tagName || 'unknown',
          });
        }
      });
      lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
      this.observers.push(lcpObserver);

      // First Input Delay
      const fidObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry: any) => {
          this.recordWebVital('fid', {
            fid: entry.processingDuration,
          });
        });
      });
      fidObserver.observe({ entryTypes: ['first-input'] });
      this.observers.push(fidObserver);

      // Cumulative Layout Shift
      const clsObserver = new PerformanceObserver((list) => {
        let clsValue = 0;
        list.getEntries().forEach((entry: any) => {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
          }
        });
        this.recordWebVital('cls', { cls: clsValue });
      });
      clsObserver.observe({ entryTypes: ['layout-shift'] });
      this.observers.push(clsObserver);

      // First Contentful Paint
      const fcpObserver = new PerformanceObserver((list) => {
        const lastEntry = list.getEntries().pop();
        if (lastEntry) {
          this.recordWebVital('fcp', { fcp: lastEntry.startTime });
        }
      });
      fcpObserver.observe({ entryTypes: ['paint'] });
      this.observers.push(fcpObserver);
    } catch (error) {
      console.error('Failed to initialize Web Vitals collection:', error);
    }
  }

  /**
   * Monitor network changes
   */
  private initializeNetworkMonitoring(): void {
    const connection = (navigator as any).connection;
    if (!connection) return;

    this.lastNetworkType = connection.effectiveType;

    connection.addEventListener('change', () => {
      const newType = connection.effectiveType;
      if (newType !== this.lastNetworkType) {
        this.networkChanges++;
        this.lastNetworkType = newType;
      }
    });
  }

  /**
   * Record Web Vital
   */
  private recordWebVital(metricName: string, data: any): void {
    const snapshot: MetricsSnapshot = {
      timestamp: Date.now(),
      webVitals: data,
      examMetrics: {},
      systemMetrics: {},
      sessionId: this.sessionId,
    };
    this.snapshots.push(snapshot);
  }

  /**
   * Mark exam start
   */
  markExamStart(): void {
    this.examStart = Date.now();
  }

  /**
   * Record exam metrics
   */
  recordExamMetrics(metrics: Partial<ExamMetrics>): void {
    const snapshot: MetricsSnapshot = {
      timestamp: Date.now(),
      webVitals: {},
      examMetrics: {
        ...metrics,
        networkChanges: this.networkChanges,
      },
      systemMetrics: {},
      sessionId: this.sessionId,
    };
    this.snapshots.push(snapshot);
  }

  /**
   * Record system metrics
   */
  recordSystemMetrics(): void {
    const metrics: Partial<SystemMetrics> = {
      networkType: (navigator as any).connection?.effectiveType || 'unknown',
      deviceOrientation: window.innerWidth > window.innerHeight
        ? 'landscape'
        : 'portrait',
      screenBrightness: this.getScreenBrightness(),
    };

    // Memory usage (if available)
    if ((performance as any).memory) {
      metrics.memoryUsage = (performance as any).memory.usedJSHeapSize / 1048576; // Convert to MB
    }

    // Battery level (if available)
    if ((navigator as any).getBattery) {
      (navigator as any).getBattery().then((battery: any) => {
        metrics.batteryLevel = battery.level * 100;
      });
    }

    const snapshot: MetricsSnapshot = {
      timestamp: Date.now(),
      webVitals: {},
      examMetrics: {},
      systemMetrics: metrics,
      sessionId: this.sessionId,
    };
    this.snapshots.push(snapshot);
  }

  /**
   * Estimate screen brightness (best effort)
   */
  private getScreenBrightness(): number {
    if ((navigator as any).brightness) {
      return (navigator as any).brightness * 100;
    }
    // Fallback: check if dark mode is enabled (proxy for brightness)
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 20 : 80;
  }

  /**
   * Calculate average metrics
   */
  getAverageMetrics(): {
    webVitals: Partial<WebVitals>;
    examMetrics: Partial<ExamMetrics>;
    systemMetrics: Partial<SystemMetrics>;
  } {
    const vitals: any = {};
    const exam: any = {};
    const system: any = {};

    const vitalSnapshots = this.snapshots.filter((s) => Object.keys(s.webVitals).length > 0);
    const examSnapshots = this.snapshots.filter((s) => Object.keys(s.examMetrics).length > 0);
    const systemSnapshots = this.snapshots.filter((s) => Object.keys(s.systemMetrics).length > 0);

    // Average Web Vitals
    if (vitalSnapshots.length > 0) {
      const keys = new Set<string>();
      vitalSnapshots.forEach((s) => Object.keys(s.webVitals).forEach((k) => keys.add(k)));

      keys.forEach((key) => {
        const values = vitalSnapshots
          .map((s) => s.webVitals[key as keyof WebVitals])
          .filter((v) => typeof v === 'number');

        if (values.length > 0) {
          vitals[key] = values.reduce((a, b) => a + b, 0) / values.length;
        }
      });
    }

    // Last exam metrics (most recent)
    if (examSnapshots.length > 0) {
      Object.assign(exam, examSnapshots[examSnapshots.length - 1].examMetrics);
    }

    // Average system metrics
    if (systemSnapshots.length > 0) {
      const keys = new Set<string>();
      systemSnapshots.forEach((s) => Object.keys(s.systemMetrics).forEach((k) => keys.add(k)));

      keys.forEach((key) => {
        const values = systemSnapshots
          .map((s) => s.systemMetrics[key as keyof SystemMetrics])
          .filter((v) => typeof v === 'number');

        if (values.length > 0) {
          system[key] = values.reduce((a, b) => a + b, 0) / values.length;
        }
      });
    }

    return {
      webVitals: vitals,
      examMetrics: exam,
      systemMetrics: system,
    };
  }

  /**
   * Get session duration
   */
  getSessionDuration(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get all snapshots
   */
  getSnapshots(): MetricsSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Cleanup observers
   */
  cleanup(): void {
    this.observers.forEach((obs) => obs.disconnect());
  }
}

// Singleton instance
let collectorInstance: PerformanceMetricsCollector | null = null;

export function getMetricsCollector(sessionId: string): PerformanceMetricsCollector {
  if (!collectorInstance) {
    collectorInstance = new PerformanceMetricsCollector(sessionId);
  }
  return collectorInstance;
}
