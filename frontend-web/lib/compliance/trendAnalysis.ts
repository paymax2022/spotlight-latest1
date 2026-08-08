/**
 * Compliance trend analysis and forecasting
 * Predictive models for GDPR, security, and performance compliance
 */

/**
 * Historical metric data point
 */
export interface MetricDataPoint {
  date: string;
  score: number;
  value?: number;
}

/**
 * Trend analysis result
 */
export interface TrendAnalysis {
  currentScore: number;
  previousScore: number;
  trend: 'improving' | 'stable' | 'declining';
  changePercent: number;
  velocity: number; // Score change per day
  volatility: number; // Standard deviation of changes
  direction: 'up' | 'down' | 'stable';
}

/**
 * Forecast prediction
 */
export interface Forecast {
  date: string;
  predictedScore: number;
  confidenceLevel: number; // 0-1
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
}

/**
 * Compliance forecast
 */
export interface ComplianceForecast {
  metric: 'gdpr' | 'security' | 'performance';
  currentScore: number;
  forecasts: Forecast[];
  trend: TrendAnalysis;
  riskFactors: string[];
  escalationWarning: boolean;
  actionItems: string[];
}

/**
 * Trend analyzer for compliance metrics
 */
export class TrendAnalyzer {
  /**
   * Calculate linear regression trend
   */
  static calculateTrend(data: MetricDataPoint[]): TrendAnalysis {
    if (data.length < 2) {
      return {
        currentScore: data[0]?.score || 0,
        previousScore: data[0]?.score || 0,
        trend: 'stable',
        changePercent: 0,
        velocity: 0,
        volatility: 0,
        direction: 'stable',
      };
    }

    const scores = data.map((d) => d.score);
    const current = scores[scores.length - 1];
    const previous = scores[0];
    const changePercent = ((current - previous) / previous) * 100;

    // Calculate velocity (change per day)
    const daysDiff = data.length - 1 || 1;
    const velocity = (current - previous) / daysDiff;

    // Calculate volatility (standard deviation)
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
    const volatility = Math.sqrt(variance);

    // Determine trend
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (velocity > 0.5) {
      trend = 'improving';
    } else if (velocity < -0.5) {
      trend = 'declining';
    }

    const direction = velocity > 0.1 ? 'up' : velocity < -0.1 ? 'down' : 'stable';

    return {
      currentScore: current,
      previousScore: previous,
      trend,
      changePercent,
      velocity,
      volatility,
      direction,
    };
  }

  /**
   * Forecast future scores using linear extrapolation
   */
  static forecast(data: MetricDataPoint[], daysAhead: number = 30): Forecast[] {
    if (data.length < 2) {
      return [];
    }

    const trend = this.calculateTrend(data);
    const forecasts: Forecast[] = [];
    const currentDate = new Date(data[data.length - 1].date);

    // Simple linear extrapolation
    for (let i = 1; i <= daysAhead; i++) {
      const forecastDate = new Date(currentDate);
      forecastDate.setDate(forecastDate.getDate() + i);

      const predictedScore = Math.max(0, Math.min(100, trend.currentScore + trend.velocity * i));
      const confidenceLevel = Math.max(0.5, 1 - i * 0.01); // Decrease confidence over time
      const riskLevel = this.calculateRiskLevel(predictedScore);
      const recommendation = this.generateRecommendation(predictedScore, riskLevel);

      forecasts.push({
        date: forecastDate.toISOString().split('T')[0],
        predictedScore: Math.round(predictedScore),
        confidenceLevel,
        riskLevel,
        recommendation,
      });
    }

    return forecasts;
  }

  /**
   * Calculate risk level based on score
   */
  static calculateRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 85) return 'low';
    if (score >= 70) return 'medium';
    if (score >= 50) return 'high';
    return 'critical';
  }

  /**
   * Generate recommendation based on score and risk
   */
  static generateRecommendation(score: number, riskLevel: string): string {
    if (riskLevel === 'critical') {
      return 'Immediate action required to prevent compliance violation';
    }
    if (riskLevel === 'high') {
      return 'Escalate to compliance team for priority remediation';
    }
    if (riskLevel === 'medium') {
      return 'Monitor closely and plan corrective measures';
    }
    return 'Continue current practices with periodic monitoring';
  }

  /**
   * Detect anomalies in data using z-score method
   */
  static detectAnomalies(data: MetricDataPoint[]): string[] {
    if (data.length < 3) {
      return [];
    }

    const scores = data.map((d) => d.score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    const anomalies: string[] = [];

    data.forEach((point, index) => {
      const zScore = Math.abs((point.score - mean) / (stdDev || 1));
      if (zScore > 2.5) {
        const direction = point.score > mean ? 'spike' : 'drop';
        anomalies.push(`Anomaly detected on ${point.date}: ${direction} in score (${point.score})`);
      }
    });

    return anomalies;
  }

  /**
   * Calculate moving average for smoothing
   */
  static calculateMovingAverage(data: MetricDataPoint[], period: number = 7): MetricDataPoint[] {
    const smoothed: MetricDataPoint[] = [];

    for (let i = 0; i < data.length; i++) {
      const start = Math.max(0, i - Math.floor(period / 2));
      const end = Math.min(data.length, i + Math.ceil(period / 2));
      const window = data.slice(start, end);
      const average = window.reduce((sum, d) => sum + d.score, 0) / window.length;

      smoothed.push({
        date: data[i].date,
        score: Math.round(average),
      });
    }

    return smoothed;
  }

  /**
   * Compare current trend against historical average
   */
  static compareAgainstHistorical(current: MetricDataPoint[], historical: MetricDataPoint[]): {
    aboveAverage: boolean;
    percentilRank: number;
    benchmarkDiff: number;
  } {
    if (historical.length === 0) {
      return { aboveAverage: true, percentilRank: 50, benchmarkDiff: 0 };
    }

    const currentScore = current[current.length - 1]?.score || 0;
    const historicalScores = historical.map((d) => d.score).sort((a, b) => a - b);
    const median = historicalScores[Math.floor(historicalScores.length / 2)];
    const average = historicalScores.reduce((a, b) => a + b, 0) / historicalScores.length;

    // Calculate percentile rank
    const higherCount = historicalScores.filter((s) => s < currentScore).length;
    const percentilRank = (higherCount / historicalScores.length) * 100;

    return {
      aboveAverage: currentScore > average,
      percentilRank,
      benchmarkDiff: currentScore - average,
    };
  }
}

/**
 * Risk calculator for compliance escalation
 */
export class RiskCalculator {
  /**
   * Calculate composite risk score across multiple metrics
   */
  static calculateCompositeRisk(
    gdprTrend: TrendAnalysis,
    securityTrend: TrendAnalysis,
    performanceTrend: TrendAnalysis
  ): {
    overallRisk: number;
    escalationNeeded: boolean;
    highestRiskCategory: string;
    riskFactors: string[];
  } {
    const riskScores = {
      gdpr: 100 - gdprTrend.currentScore,
      security: 100 - securityTrend.currentScore,
      performance: 100 - performanceTrend.currentScore,
    };

    const overallRisk = (riskScores.gdpr + riskScores.security + riskScores.performance) / 3;
    const escalationNeeded = overallRisk > 40;

    const riskFactors: string[] = [];

    // GDPR risk factors
    if (gdprTrend.currentScore < 75) {
      riskFactors.push('GDPR compliance below acceptable threshold');
    }
    if (gdprTrend.trend === 'declining') {
      riskFactors.push('GDPR compliance trending downward');
    }
    if (gdprTrend.volatility > 10) {
      riskFactors.push('High volatility in GDPR metrics');
    }

    // Security risk factors
    if (securityTrend.currentScore < 70) {
      riskFactors.push('Security posture critically low');
    }
    if (securityTrend.trend === 'declining') {
      riskFactors.push('Security metrics degrading');
    }
    if (securityTrend.velocity < -1) {
      riskFactors.push('Rapid security score decline');
    }

    // Performance risk factors
    if (performanceTrend.currentScore < 80) {
      riskFactors.push('Performance below standards');
    }
    if (performanceTrend.volatility > 15) {
      riskFactors.push('Unstable performance metrics');
    }

    const highestRiskCategory =
      riskScores.security > riskScores.gdpr && riskScores.security > riskScores.performance
        ? 'Security'
        : riskScores.gdpr > riskScores.performance
          ? 'GDPR'
          : 'Performance';

    return {
      overallRisk,
      escalationNeeded,
      highestRiskCategory,
      riskFactors,
    };
  }

  /**
   * Generate escalation alert if needed
   */
  static generateEscalationAlert(overallRisk: number, highestRiskCategory: string): {
    shouldEscalate: boolean;
    severity: 'warning' | 'alert' | 'critical';
    message: string;
  } {
    let severity: 'warning' | 'alert' | 'critical' = 'warning';
    let message = '';

    if (overallRisk > 60) {
      severity = 'critical';
      message = `CRITICAL: Overall compliance risk at ${overallRisk.toFixed(0)}%. ${highestRiskCategory} category requires immediate attention.`;
    } else if (overallRisk > 40) {
      severity = 'alert';
      message = `ALERT: Compliance risk elevated at ${overallRisk.toFixed(0)}%. ${highestRiskCategory} category at risk.`;
    } else if (overallRisk > 25) {
      severity = 'warning';
      message = `WARNING: Compliance risk trending toward ${overallRisk.toFixed(0)}%. Monitor ${highestRiskCategory} metrics.`;
    }

    return {
      shouldEscalate: overallRisk > 25,
      severity,
      message,
    };
  }
}

/**
 * Predictive compliance analyzer
 */
export class PredictiveCompliance {
  /**
   * Generate full compliance forecast
   */
  static generateForecast(
    metric: 'gdpr' | 'security' | 'performance',
    data: MetricDataPoint[],
    daysAhead: number = 30
  ): ComplianceForecast {
    const trend = TrendAnalyzer.calculateTrend(data);
    const forecasts = TrendAnalyzer.forecast(data, daysAhead);
    const anomalies = TrendAnalyzer.detectAnomalies(data);

    const lastForecast = forecasts[forecasts.length - 1];
    const escalationWarning =
      trend.currentScore < 70 ||
      (lastForecast && lastForecast.riskLevel === 'critical') ||
      trend.trend === 'declining';

    // Generate action items
    const actionItems: string[] = [];
    if (trend.currentScore < 75) {
      actionItems.push(`Immediate remediation needed for ${metric} compliance`);
    }
    if (trend.trend === 'declining') {
      actionItems.push(`Investigate and reverse ${metric} score decline`);
    }
    if (anomalies.length > 0) {
      actionItems.push(`Address anomalies detected in ${metric} data`);
    }
    if (forecasts.some((f) => f.riskLevel === 'critical')) {
      actionItems.push(`High-priority: ${metric} compliance projected to become critical`);
    }

    return {
      metric,
      currentScore: trend.currentScore,
      forecasts,
      trend,
      riskFactors: anomalies,
      escalationWarning,
      actionItems,
    };
  }

  /**
   * Generate action plan based on forecast
   */
  static generateActionPlan(forecast: ComplianceForecast): {
    priority: 'low' | 'medium' | 'high' | 'critical';
    timeframe: string;
    actions: Array<{ action: string; priority: string; daysToComplete: number }>;
  } {
    let priority: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let timeframe = '';
    const actions: Array<{ action: string; priority: string; daysToComplete: number }> = [];

    if (forecast.currentScore < 50) {
      priority = 'critical';
      timeframe = 'Immediate (within 24 hours)';
      actions.push({
        action: `Escalate ${forecast.metric} compliance failure to leadership`,
        priority: 'critical',
        daysToComplete: 0,
      });
    } else if (forecast.currentScore < 70) {
      priority = 'high';
      timeframe = 'Urgent (within 7 days)';
      actions.push({
        action: `Develop remediation plan for ${forecast.metric}`,
        priority: 'high',
        daysToComplete: 3,
      });
    } else if (forecast.trend.trend === 'declining') {
      priority = 'medium';
      timeframe = 'Soon (within 14 days)';
      actions.push({
        action: `Investigate ${forecast.metric} decline`,
        priority: 'medium',
        daysToComplete: 7,
      });
    }

    // Add metric-specific actions
    switch (forecast.metric) {
      case 'gdpr':
        if (forecast.currentScore < 90) {
          actions.push({
            action: 'Review and expedite data subject access requests',
            priority,
            daysToComplete: 7,
          });
        }
        break;
      case 'security':
        if (forecast.currentScore < 80) {
          actions.push({
            action: 'Conduct security audit and patch vulnerabilities',
            priority,
            daysToComplete: 14,
          });
        }
        break;
      case 'performance':
        if (forecast.currentScore < 85) {
          actions.push({
            action: 'Optimize critical performance bottlenecks',
            priority,
            daysToComplete: 14,
          });
        }
        break;
    }

    return { priority, timeframe, actions };
  }
}
