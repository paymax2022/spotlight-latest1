'use client';

import { useCallback, useState } from 'react';
import { ComplianceReportGenerator, ReportType, ReportFormat } from '@/lib/compliance/reportGenerator';
import type { ComplianceReport, GDPRMetrics, SecurityMetrics, PerformanceReportData } from '@/lib/compliance/reportGenerator';

/**
 * Hook for compliance report generation
 */
export function useComplianceReporting(organizationName: string, reportedByName: string) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedReports, setGeneratedReports] = useState<ComplianceReport[]>([]);
  const [error, setError] = useState<string | null>(null);

  const generator = new ComplianceReportGenerator(
    organizationName,
    reportedByName,
    'report-signing-key' // In production, use a secure key
  );

  const generateGDPRReport = useCallback(
    async (metrics: GDPRMetrics) => {
      setIsGenerating(true);
      setError(null);

      try {
        const report = await generator.generateGDPRReport(metrics);
        setGeneratedReports((prev) => [...prev, report]);
        return report;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to generate GDPR report';
        setError(errorMsg);
        return null;
      } finally {
        setIsGenerating(false);
      }
    },
    [generator]
  );

  const generateSecurityReport = useCallback(
    async (metrics: SecurityMetrics) => {
      setIsGenerating(true);
      setError(null);

      try {
        const report = await generator.generateSecurityReport(metrics);
        setGeneratedReports((prev) => [...prev, report]);
        return report;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to generate security report';
        setError(errorMsg);
        return null;
      } finally {
        setIsGenerating(false);
      }
    },
    [generator]
  );

  const generatePerformanceReport = useCallback(
    async (data: PerformanceReportData) => {
      setIsGenerating(true);
      setError(null);

      try {
        const report = await generator.generatePerformanceReport(data);
        setGeneratedReports((prev) => [...prev, report]);
        return report;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to generate performance report';
        setError(errorMsg);
        return null;
      } finally {
        setIsGenerating(false);
      }
    },
    [generator]
  );

  const downloadReport = useCallback(
    (report: ComplianceReport, format: ReportFormat) => {
      generator.downloadReport(report, format);
    },
    [generator]
  );

  const sendReportToEmail = useCallback(
    async (report: ComplianceReport, email: string, format: ReportFormat) => {
      try {
        const blob = generator.createDownloadBlob(report, format);
        const formData = new FormData();
        formData.append('report', blob);
        formData.append('email', email);
        formData.append('reportType', report.type);

        const response = await fetch('/api/compliance/send-report', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error('Failed to send report');
        }

        return true;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to send report';
        setError(errorMsg);
        return false;
      }
    },
    [generator]
  );

  const scheduleAutomaticReport = useCallback(
    async (
      reportType: ReportType,
      frequency: 'daily' | 'weekly' | 'monthly',
      recipients: string[]
    ) => {
      try {
        const response = await fetch('/api/compliance/schedule-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reportType,
            frequency,
            recipients,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to schedule report');
        }

        return true;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to schedule report';
        setError(errorMsg);
        return false;
      }
    },
    []
  );

  return {
    isGenerating,
    generatedReports,
    error,
    generateGDPRReport,
    generateSecurityReport,
    generatePerformanceReport,
    downloadReport,
    sendReportToEmail,
    scheduleAutomaticReport,
  };
}
