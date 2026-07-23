export interface NormalizedPlatformConfig {
  readonly name: string;
  readonly logFile: string;
  readonly scanIntervalSeconds: number;
  readonly analysisWindowSeconds: number;
  readonly resetAfterSeconds: number;
  readonly errorThreshold: number;
  readonly monitorWarnings: boolean;
  readonly debug: boolean;
}
