type HealthStatus = 'passed' | 'warning' | 'failed';
export type HealthCheck = {
  id: string;
  status: HealthStatus;
  message: string;
  details?: string[];
};
export type HealthReport = { version: 1; healthy: boolean; checks: HealthCheck[] };
