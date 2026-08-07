/**
 * Compliance analytics and business intelligence engine
 * Trends, KPIs, benchmarking, and strategic insights
 */

/**
 * Compliance metric data point
 */
export interface MetricPoint {
  date: string;
  gdpr: number;
  security: number;
  performance: number;
}

/**
 * KPI definition
 */
export interface KPI {
  id: string;
  name: string;
  description: string;
  value: number;
  target: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
  status: 'on_track' | 'at_risk' | 'critical';
  lastUpdated: number;
}

/**
 * Trend analysis result
 */
export interface TrendAnalysis {
  metric: 'gdpr' | 'security' | 'performance';
  currentScore: number;
  previousScore: number;
  trend: 'improving' | 'declining' | 'stable';
  changePercent: number;
  projectedScore30: number;
  projectedScore90: number;
  volatility: number;
}

/**
 * Compliance insight
 */
export interface ComplianceInsight {
  id: string;
  category: 'risk' | 'opportunity' | 'trend' | 'anomaly';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  impact: string;
  recommendation: string;
  affectedMetrics: string[];
  createdAt: number;
}

/**
 * Benchmark data
 */
export interface BenchmarkData {
  metric: string;
  yourScore: number;
  industryAverage: number;
  industryLeader: number;
  percentile: number;
}

/**
 * Compliance analytics engine
 */
export class ComplianceAnalyticsEngine {
  private metrics: MetricPoint[] = [];
  private kpis: Map<string, KPI> = new Map();
  private insights: Map<string, ComplianceInsight> = new Map();
  private benchmarks: Map<string, BenchmarkData> = new Map();

  constructor() {
    this.initializeDefaultKPIs();
    this.initializeDefaultBenchmarks();
  }

  /**
   * Initialize default KPIs
   */
  private initializeDefaultKPIs(): void {
    // GDPR KPIs
    this.kpis.set('gdpr-response-time', {
      id: 'gdpr-response-time',
      name: 'GDPR Response Time',
      description: 'Average days to respond to data requests',
      value: 8,
      target: 20,
      unit: 'days',
      trend: 'stable',
      status: 'on_track',
      lastUpdated: Date.now(),
    });

    this.kpis.set('gdpr-compliance-score', {
      id: 'gdpr-compliance-score',
      name: 'GDPR Compliance Score',
      description: 'Overall GDPR compliance percentage',
      value: 94,
      target: 95,
      unit: '%',
      trend: 'up',
      status: 'on_track',
      lastUpdated: Date.now(),
    });

    // Security KPIs
    this.kpis.set('security-score', {
      id: 'security-score',
      name: 'Security Score',
      description: 'Overall security posture rating',
      value: 87,
      target: 90,
      unit: '%',
      trend: 'up',
      status: 'on_track',
      lastUpdated: Date.now(),
    });

    this.kpis.set('mttr', {
      id: 'mttr',
      name: 'Mean Time To Resolution',
      description: 'Average time to resolve security incidents',
      value: 18,
      target: 30,
      unit: 'minutes',
      trend: 'down',
      status: 'on_track',
      lastUpdated: Date.now(),
    });

    // Performance KPIs
    this.kpis.set('lcp', {
      id: 'lcp',
      name: 'Largest Contentful Paint',
      description: 'Page load speed metric',
      value: 2100,
      target: 2500,
      unit: 'ms',
      trend: 'stable',
      status: 'on_track',
      lastUpdated: Date.now(),
    });

    this.kpis.set('uptime', {
      id: 'uptime',
      name: 'System Uptime',
      description: 'Service availability percentage',
      value: 99.95,
      target: 99.9,
      unit: '%',
      trend: 'stable',
      status: 'on_track',
      lastUpdated: Date.now(),
    });
  }

  /**
   * Initialize default benchmarks
   */
  private initializeDefaultBenchmarks(): void {
    this.benchmarks.set('gdpr-compliance', {
      metric: 'GDPR Compliance',
      yourScore: 94,
      industryAverage: 82,
      industryLeader: 98,
      percentile: 85,
    });

    this.benchmarks.set('security-score', {
      metric: 'Security Score',
      yourScore: 87,
      industryAverage: 78,
      industryLeader: 95,
      percentile: 82,
    });

    this.benchmarks.set('lcp', {
      metric: 'Largest Contentful Paint',
      yourScore: 2100,
      industryAverage: 2800,
      industryLeader: 1500,
      percentile: 76,
    });
  }

  /**
   * Add metric data point
   */
  addMetricPoint(point: MetricPoint): void {
    this.metrics.push(point);
    // Keep last 365 days
    if (this.metrics.length > 365) {
      this.metrics.shift();
    }
  }

  /**
   * Get metrics for date range
   */
  getMetricsForRange(startDate: string, endDate: string): MetricPoint[] {
    return this.metrics.filter((m) => m.date >= startDate && m.date <= endDate);
  }

  /**
   * Calculate trend for metric
   */
  calculateTrend(metric: 'gdpr' | 'security' | 'performance'): TrendAnalysis {
    if (this.metrics.length < 2) {
      return {
        metric,
        currentScore: 0,
        previousScore: 0,
        trend: 'stable',
        changePercent: 0,
        projectedScore30: 0,
        projectedScore90: 0,
        volatility: 0,
      };
    }

    const current = this.metrics[this.metrics.length - 1][metric];
    const previous = this.metrics[Math.max(0, this.metrics.length - 8)][metric];
    const changePercent = ((current - previous) / previous) * 100;

    // Calculate volatility
    const recentMetrics = this.metrics.slice(-30).map((m) => m[metric]);
    const mean = recentMetrics.reduce((a, b) => a + b, 0) / recentMetrics.length;
    const variance = recentMetrics.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recentMetrics.length;
    const volatility = Math.sqrt(variance);

    // Project future scores (simplified linear model)
    const velocity = (current - previous) / 7;
    const projectedScore30 = Math.max(0, Math.min(100, current + velocity * 30));
    const projectedScore90 = Math.max(0, Math.min(100, current + velocity * 90));

    // Determine trend
    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (velocity > 0.5) {
      trend = 'improving';
    } else if (velocity < -0.5) {
      trend = 'declining';
    }

    return {
      metric,
      currentScore: current,
      previousScore: previous,
      trend,
      changePercent,
      projectedScore30,
      projectedScore90,
      volatility,
    };
  }

  /**
   * Get all KPIs
   */
  getAllKPIs(): KPI[] {
    return Array.from(this.kpis.values());
  }

  /**
   * Get KPI
   */
  getKPI(kpiId: string): KPI | null {
    return this.kpis.get(kpiId) || null;
  }

  /**
   * Update KPI
   */
  updateKPI(kpiId: string, updates: Partial<KPI>): void {
    const kpi = this.kpis.get(kpiId);
    if (kpi) {
      this.kpis.set(kpiId, { ...kpi, ...updates, lastUpdated: Date.now() });
    }
  }

  /**
   * Generate insights
   */
  generateInsights(): ComplianceInsight[] {
    const insights: ComplianceInsight[] = [];

    // Analyze trends and generate insights
    const gdprTrend = this.calculateTrend('gdpr');
    const securityTrend = this.calculateTrend('security');
    const perfTrend = this.calculateTrend('performance');

    // Risk insight: declining security score
    if (securityTrend.trend === 'declining') {
      insights.push({
        id: `insight-security-decline-${Date.now()}`,
        category: 'risk',
        priority: 'high',
        title: 'Security Score Declining',
        description: `Security score has declined ${Math.abs(securityTrend.changePercent).toFixed(1)}% in the last week`,
        impact: 'Potential security vulnerabilities may go unnoticed',
        recommendation: 'Review recent security incidents and implement preventive measures',
        affectedMetrics: ['security'],
        createdAt: Date.now(),
      });
    }

    // Opportunity insight: strong GDPR compliance
    if (gdprTrend.currentScore >= 90) {
      insights.push({
        id: `insight-gdpr-strong-${Date.now()}`,
        category: 'opportunity',
        priority: 'low',
        title: 'Strong GDPR Compliance Position',
        description: 'GDPR compliance is at an excellent level',
        impact: 'Reduced regulatory risk and user trust',
        recommendation: 'Maintain current practices and use as case study for other teams',
        affectedMetrics: ['gdpr'],
        createdAt: Date.now(),
      });
    }

    // Anomaly insight: unusual volatility
    if (perfTrend.volatility > 15) {
      insights.push({
        id: `insight-perf-volatility-${Date.now()}`,
        category: 'anomaly',
        priority: 'medium',
        title: 'High Performance Volatility',
        description: 'Performance metrics are fluctuating significantly',
        impact: 'Inconsistent user experience and unpredictable system behavior',
        recommendation: 'Investigate infrastructure stability and optimize caching strategies',
        affectedMetrics: ['performance'],
        createdAt: Date.now(),
      });
    }

    // Trend insight: positive trajectory
    if (gdprTrend.trend === 'improving' && securityTrend.trend === 'improving') {
      insights.push({
        id: `insight-improving-trajectory-${Date.now()}`,
        category: 'trend',
        priority: 'low',
        title: 'Positive Compliance Trajectory',
        description: 'Multiple compliance metrics showing improvement',
        impact: 'Building compliance culture and reducing risk exposure',
        recommendation: 'Allocate resources to reinforcing improvements',
        affectedMetrics: ['gdpr', 'security'],
        createdAt: Date.now(),
      });
    }

    return insights.sort((a, b) => {
      const priorityMap = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityMap[a.priority] - priorityMap[b.priority];
    });
  }

  /**
   * Get benchmark for metric
   */
  getBenchmark(metric: string): BenchmarkData | null {
    return this.benchmarks.get(metric) || null;
  }

  /**
   * Get all benchmarks
   */
  getAllBenchmarks(): BenchmarkData[] {
    return Array.from(this.benchmarks.values());
  }

  /**
   * Calculate compliance health score
   */
  getComplianceHealthScore(): {
    score: number;
    status: 'healthy' | 'needs_attention' | 'critical';
    trend: 'improving' | 'stable' | 'declining';
    breakdown: Record<string, number>;
  } {
    const trends = {
      gdpr: this.calculateTrend('gdpr'),
      security: this.calculateTrend('security'),
      performance: this.calculateTrend('performance'),
    };

    const score = (trends.gdpr.currentScore + trends.security.currentScore + trends.performance.currentScore) / 3;

    let status: 'healthy' | 'needs_attention' | 'critical' = 'healthy';
    if (score < 70) status = 'critical';
    else if (score < 80) status = 'needs_attention';

    const trendCounts = {
      improving: Object.values(trends).filter((t) => t.trend === 'improving').length,
      declining: Object.values(trends).filter((t) => t.trend === 'declining').length,
      stable: Object.values(trends).filter((t) => t.trend === 'stable').length,
    };

    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (trendCounts.improving > trendCounts.declining) {
      trend = 'improving';
    } else if (trendCounts.declining > trendCounts.improving) {
      trend = 'declining';
    }

    return {
      score: Math.round(score),
      status,
      trend,
      breakdown: {
        gdpr: trends.gdpr.currentScore,
        security: trends.security.currentScore,
        performance: trends.performance.currentScore,
      },
    };
  }

  /**
   * Get historical data
   */
  getHistoricalData(days: number = 30): {
    dates: string[];
    gdpr: number[];
    security: number[];
    performance: number[];
  } {
    const data = this.metrics.slice(-days);

    return {
      dates: data.map((d) => d.date),
      gdpr: data.map((d) => d.gdpr),
      security: data.map((d) => d.security),
      performance: data.map((d) => d.performance),
    };
  }

  /**
   * Calculate compliance statistics
   */
  getStatistics(): {
    averageScore: number;
    lowestMetric: string;
    highestMetric: string;
    improvingMetrics: number;
    decliningMetrics: number;
    daysToProjectedCritical: number;
  } {
    const health = this.getComplianceHealthScore();
    const trends = {
      gdpr: this.calculateTrend('gdpr'),
      security: this.calculateTrend('security'),
      performance: this.calculateTrend('performance'),
    };

    const scores = Object.values(trends).map((t) => ({ metric: t.metric, score: t.currentScore }));
    const lowestMetric = scores.reduce((a, b) => (a.score < b.score ? a : b)).metric;
    const highestMetric = scores.reduce((a, b) => (a.score > b.score ? a : b)).metric;

    // Calculate days until critical (score < 50)
    let daysToProjectedCritical = Infinity;
    Object.values(trends).forEach((trend) => {
      if (trend.projectedScore90 < 50) {
        daysToProjectedCritical = Math.min(daysToProjectedCritical, 90);
      }
      if (trend.projectedScore30 < 50) {
        daysToProjectedCritical = Math.min(daysToProjectedCritical, 30);
      }
    });

    return {
      averageScore: health.score,
      lowestMetric,
      highestMetric,
      improvingMetrics: Object.values(trends).filter((t) => t.trend === 'improving').length,
      decliningMetrics: Object.values(trends).filter((t) => t.trend === 'declining').length,
      daysToProjectedCritical: daysToProjectedCritical === Infinity ? -1 : daysToProjectedCritical,
    };
  }
}

/**
 * Create singleton instance
 */
let engineInstance: ComplianceAnalyticsEngine | null = null;

export function getAnalyticsEngine(): ComplianceAnalyticsEngine {
  if (!engineInstance) {
    engineInstance = new ComplianceAnalyticsEngine();
  }
  return engineInstance;
}
