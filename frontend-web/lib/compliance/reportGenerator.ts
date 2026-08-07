/**
 * Compliance report generation
 * GDPR, audit, and performance reports for regulatory requirements
 */

import { encryptData, hashData, generateToken } from '@/lib/utils/encryption';

/**
 * Report types
 */
export enum ReportType {
  GDPR_AUDIT = 'gdpr_audit',
  SECURITY_AUDIT = 'security_audit',
  PERFORMANCE_REPORT = 'performance_report',
  DATA_INVENTORY = 'data_inventory',
  CONSENT_AUDIT = 'consent_audit',
  INCIDENT_REPORT = 'incident_report',
  COMPLIANCE_SUMMARY = 'compliance_summary',
}

/**
 * Report format
 */
export enum ReportFormat {
  JSON = 'json',
  CSV = 'csv',
  PDF = 'pdf',
}

/**
 * GDPR compliance metrics
 */
export interface GDPRMetrics {
  totalDataRequests: number;
  exportRequests: number;
  deletionRequests: number;
  consentWithdrawals: number;
  dataBreaches: number;
  averageResponseTime: number; // days
  complianceScore: number; // 0-100
}

/**
 * Security audit metrics
 */
export interface SecurityMetrics {
  totalAuthAttempts: number;
  failedAuthAttempts: number;
  anomaliesDetected: number;
  anomaliesResolved: number;
  securityAlerts: number;
  criticalIncidents: number;
  mttr: number; // mean time to resolution in minutes
  securityScore: number; // 0-100
}

/**
 * Performance metrics for report
 */
export interface PerformanceReportData {
  averageLCP: number;
  averageFID: number;
  averageCLS: number;
  uptime: number; // percentage
  errorRate: number; // percentage
  performanceScore: number; // 0-100
}

/**
 * Compliance report
 */
export interface ComplianceReport {
  id: string;
  type: ReportType;
  generatedAt: number;
  period: {
    startDate: number;
    endDate: number;
  };
  organization: string;
  reportedBy: string;
  gdprMetrics?: GDPRMetrics;
  securityMetrics?: SecurityMetrics;
  performanceData?: PerformanceReportData;
  summary: string;
  recommendations: string[];
  signature: string; // Digital signature for authenticity
}

/**
 * Data inventory entry
 */
export interface DataInventoryEntry {
  category: string;
  description: string;
  dataElements: string[];
  retentionPeriod: string;
  purpose: string;
  legalBasis: string;
  processingLocation: string;
  encryptedAtRest: boolean;
  encryptedInTransit: boolean;
}

/**
 * Report generator for compliance
 */
export class ComplianceReportGenerator {
  private organizationName: string;
  private reportedByName: string;
  private signingKey: string;

  constructor(organizationName: string, reportedByName: string, signingKey: string) {
    this.organizationName = organizationName;
    this.reportedByName = reportedByName;
    this.signingKey = signingKey;
  }

  /**
   * Generate GDPR audit report
   */
  async generateGDPRReport(metrics: GDPRMetrics): Promise<ComplianceReport> {
    const report: ComplianceReport = {
      id: generateToken(16),
      type: ReportType.GDPR_AUDIT,
      generatedAt: Date.now(),
      period: {
        startDate: Date.now() - 30 * 24 * 60 * 60 * 1000, // Last 30 days
        endDate: Date.now(),
      },
      organization: this.organizationName,
      reportedBy: this.reportedByName,
      gdprMetrics: metrics,
      summary: this.generateGDPRSummary(metrics),
      recommendations: this.generateGDPRRecommendations(metrics),
      signature: await this.signReport(JSON.stringify(metrics)),
    };

    return report;
  }

  /**
   * Generate security audit report
   */
  async generateSecurityReport(metrics: SecurityMetrics): Promise<ComplianceReport> {
    const report: ComplianceReport = {
      id: generateToken(16),
      type: ReportType.SECURITY_AUDIT,
      generatedAt: Date.now(),
      period: {
        startDate: Date.now() - 30 * 24 * 60 * 60 * 1000,
        endDate: Date.now(),
      },
      organization: this.organizationName,
      reportedBy: this.reportedByName,
      securityMetrics: metrics,
      summary: this.generateSecuritySummary(metrics),
      recommendations: this.generateSecurityRecommendations(metrics),
      signature: await this.signReport(JSON.stringify(metrics)),
    };

    return report;
  }

  /**
   * Generate performance report
   */
  async generatePerformanceReport(data: PerformanceReportData): Promise<ComplianceReport> {
    const report: ComplianceReport = {
      id: generateToken(16),
      type: ReportType.PERFORMANCE_REPORT,
      generatedAt: Date.now(),
      period: {
        startDate: Date.now() - 7 * 24 * 60 * 60 * 1000, // Last 7 days
        endDate: Date.now(),
      },
      organization: this.organizationName,
      reportedBy: this.reportedByName,
      performanceData: data,
      summary: this.generatePerformanceSummary(data),
      recommendations: this.generatePerformanceRecommendations(data),
      signature: await this.signReport(JSON.stringify(data)),
    };

    return report;
  }

  /**
   * Generate data inventory report
   */
  async generateDataInventory(entries: DataInventoryEntry[]): Promise<ComplianceReport> {
    const report: ComplianceReport = {
      id: generateToken(16),
      type: ReportType.DATA_INVENTORY,
      generatedAt: Date.now(),
      period: {
        startDate: Date.now() - 365 * 24 * 60 * 60 * 1000, // Annual
        endDate: Date.now(),
      },
      organization: this.organizationName,
      reportedBy: this.reportedByName,
      summary: this.generateInventorySummary(entries),
      recommendations: this.generateInventoryRecommendations(entries),
      signature: await this.signReport(JSON.stringify(entries)),
    };

    return report;
  }

  /**
   * Generate GDPR summary
   */
  private generateGDPRSummary(metrics: GDPRMetrics): string {
    return `GDPR Compliance Report

Total Data Access Requests: ${metrics.totalDataRequests}
- Export Requests: ${metrics.exportRequests}
- Deletion Requests: ${metrics.deletionRequests}
- Consent Withdrawals: ${metrics.consentWithdrawals}

Average Response Time: ${metrics.averageResponseTime} days
Compliance Score: ${metrics.complianceScore}%
Data Breaches: ${metrics.dataBreaches}

Status: ${metrics.complianceScore >= 90 ? 'COMPLIANT' : 'NEEDS IMPROVEMENT'}`;
  }

  /**
   * Generate security summary
   */
  private generateSecuritySummary(metrics: SecurityMetrics): string {
    return `Security Audit Report

Total Authentication Attempts: ${metrics.totalAuthAttempts}
Failed Attempts: ${metrics.failedAuthAttempts} (${((metrics.failedAuthAttempts / metrics.totalAuthAttempts) * 100).toFixed(1)}%)

Anomalies Detected: ${metrics.anomaliesDetected}
Resolved: ${metrics.anomaliesResolved}

Critical Incidents: ${metrics.criticalIncidents}
Mean Time to Resolution: ${metrics.mttr} minutes

Security Score: ${metrics.securityScore}%
Status: ${metrics.criticalIncidents === 0 ? 'SECURE' : 'ALERT'}`;
  }

  /**
   * Generate performance summary
   */
  private generatePerformanceSummary(data: PerformanceReportData): string {
    return `Performance Report

Core Web Vitals:
- LCP (Largest Contentful Paint): ${data.averageLCP.toFixed(1)}ms
- FID (First Input Delay): ${data.averageFID.toFixed(1)}ms
- CLS (Cumulative Layout Shift): ${data.averageCLS.toFixed(2)}

System Health:
- Uptime: ${data.uptime.toFixed(2)}%
- Error Rate: ${data.errorRate.toFixed(2)}%

Performance Score: ${data.performanceScore}%
Status: ${data.performanceScore >= 90 ? 'EXCELLENT' : data.performanceScore >= 75 ? 'GOOD' : 'NEEDS IMPROVEMENT'}`;
  }

  /**
   * Generate inventory summary
   */
  private generateInventorySummary(entries: DataInventoryEntry[]): string {
    const encryptedCount = entries.filter((e) => e.encryptedAtRest && e.encryptedInTransit).length;

    return `Data Inventory Report

Total Data Categories: ${entries.length}
Fully Encrypted: ${encryptedCount}/${entries.length} (${((encryptedCount / entries.length) * 100).toFixed(0)}%)

Categories:
${entries.map((e) => `- ${e.category}: ${e.dataElements.join(', ')}`).join('\n')}

Retention Policies: All configured
Legal Basis: Documented for all categories
Processing Locations: Documented`;
  }

  /**
   * Generate GDPR recommendations
   */
  private generateGDPRRecommendations(metrics: GDPRMetrics): string[] {
    const recs: string[] = [];

    if (metrics.complianceScore < 90) {
      recs.push('Improve compliance score by addressing user rights requests faster');
    }
    if (metrics.dataBreaches > 0) {
      recs.push('Conduct post-incident review of data breach incidents');
    }
    if (metrics.averageResponseTime > 30) {
      recs.push('Streamline data request process to meet 30-day GDPR deadline');
    }
    if (recs.length === 0) {
      recs.push('Continue current compliance practices');
    }

    return recs;
  }

  /**
   * Generate security recommendations
   */
  private generateSecurityRecommendations(metrics: SecurityMetrics): string[] {
    const recs: string[] = [];

    if (metrics.criticalIncidents > 0) {
      recs.push('Investigate and remediate critical security incidents immediately');
    }
    if (metrics.securityScore < 80) {
      recs.push('Increase monitoring and alerting thresholds');
    }
    if (metrics.mttr > 60) {
      recs.push('Improve incident response procedures to reduce MTTR');
    }
    if (metrics.failedAuthAttempts / metrics.totalAuthAttempts > 0.1) {
      recs.push('Review authentication system for potential security issues');
    }
    if (recs.length === 0) {
      recs.push('Maintain current security posture and continue monitoring');
    }

    return recs;
  }

  /**
   * Generate performance recommendations
   */
  private generatePerformanceRecommendations(data: PerformanceReportData): string[] {
    const recs: string[] = [];

    if (data.averageLCP > 2500) {
      recs.push('Optimize LCP: reduce server response time and critical path resources');
    }
    if (data.averageFID > 100) {
      recs.push('Optimize FID: reduce JavaScript execution time');
    }
    if (data.averageCLS > 0.1) {
      recs.push('Improve CLS: stabilize layout shifts with explicit dimensions');
    }
    if (data.uptime < 99.9) {
      recs.push('Improve infrastructure reliability to achieve 99.9% uptime target');
    }
    if (data.errorRate > 0.1) {
      recs.push('Investigate and fix error sources to reduce error rate');
    }
    if (recs.length === 0) {
      recs.push('Maintain current performance standards');
    }

    return recs;
  }

  /**
   * Generate inventory recommendations
   */
  private generateInventoryRecommendations(entries: DataInventoryEntry[]): string[] {
    const unencrypted = entries.filter((e) => !e.encryptedAtRest || !e.encryptedInTransit);

    return [
      ...(unencrypted.length > 0
        ? [
            `Encrypt ${unencrypted.length} data categories currently stored or transmitted unencrypted`,
          ]
        : []),
      'Review and update retention policies annually',
      'Document all processing locations for audit trails',
      'Conduct regular data minimization reviews',
    ];
  }

  /**
   * Sign report for authenticity
   */
  private async signReport(data: string): Promise<string> {
    const signature = await hashData(`${data}-${this.signingKey}`);
    return signature.substring(0, 32); // Abbreviated signature
  }

  /**
   * Export report as JSON
   */
  exportAsJSON(report: ComplianceReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Export report as CSV
   */
  exportAsCSV(report: ComplianceReport): string {
    const lines: string[] = [];

    lines.push('Compliance Report');
    lines.push(`Report Type,${report.type}`);
    lines.push(`Generated At,${new Date(report.generatedAt).toISOString()}`);
    lines.push(`Organization,${report.organization}`);
    lines.push(`Reported By,${report.reportedBy}`);
    lines.push('');

    if (report.gdprMetrics) {
      lines.push('GDPR Metrics');
      Object.entries(report.gdprMetrics).forEach(([key, value]) => {
        lines.push(`${key},${value}`);
      });
    }

    if (report.securityMetrics) {
      lines.push('Security Metrics');
      Object.entries(report.securityMetrics).forEach(([key, value]) => {
        lines.push(`${key},${value}`);
      });
    }

    lines.push('');
    lines.push('Summary');
    lines.push(report.summary);
    lines.push('');
    lines.push('Recommendations');
    report.recommendations.forEach((rec) => {
      lines.push(`- ${rec}`);
    });

    return lines.join('\n');
  }

  /**
   * Create download blob
   */
  createDownloadBlob(report: ComplianceReport, format: ReportFormat): Blob {
    let content: string;
    let mimeType: string;

    switch (format) {
      case ReportFormat.JSON:
        content = this.exportAsJSON(report);
        mimeType = 'application/json';
        break;
      case ReportFormat.CSV:
        content = this.exportAsCSV(report);
        mimeType = 'text/csv';
        break;
      case ReportFormat.PDF:
        // PDF generation would require a library like jsPDF
        content = this.exportAsJSON(report);
        mimeType = 'application/pdf';
        break;
    }

    return new Blob([content], { type: mimeType });
  }

  /**
   * Download report
   */
  downloadReport(report: ComplianceReport, format: ReportFormat): void {
    const blob = this.createDownloadBlob(report, format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.type}-${new Date(report.generatedAt).toISOString().split('T')[0]}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
