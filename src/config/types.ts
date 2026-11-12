export type SensorType = 'contact' | 'leak';

export interface NormalizedPlatformConfig {
  readonly name: string;
  readonly logFile: string;
  readonly scanIntervalSeconds: number;
  readonly analysisWindowSeconds: number;
  readonly resetAfterSeconds: number;
  readonly errorThreshold: number;
  readonly monitorWarnings: boolean;
  readonly debug: boolean;
  readonly groupRepeatedErrors: boolean;
  readonly repeatWindowSeconds: number;
  readonly pluginErrorThreshold: number;
  readonly reconnectIntervalSeconds: number;
  readonly historyLimit: number;
  readonly separateWarningSensor: boolean;
  readonly errorSensorType: SensorType;
  readonly warningSensorType: SensorType;
  readonly warningThreshold: number;
}
