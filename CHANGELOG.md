# Changelog

## 0.1.0-alpha.6

- Fixed package verification compatibility with npm versions that return a single dry-run package object instead of an array.

## 0.1.0-alpha.5

- Fixed package verification compatibility with npm versions that prefix dry-run package file paths.

## 0.1.0-alpha.4

- Added focused test coverage for configuration validation, log tailing, anomaly history, HomeKit accessory updates, platform config failure handling, and health monitor polling/reset behavior.
- Added global coverage thresholds to prevent test coverage regressions.

## 0.1.0

- Initial Homebridge Health Monitor implementation.
- Added read-only Homebridge log tailing that starts at end-of-file.
- Added conservative ERROR detection with optional WARN monitoring.
- Added one HomeKit Leak Sensor for health alerts.
- Added automatic alert reset after a quiet period.
- Added bounded JSON anomaly history in Homebridge storage.
- Added Homebridge UI schema, bilingual README, and package icon asset.
- Added GitHub Actions for CI, PR beta publication, tagged alpha and beta publication, and stable npm publication through Trusted Publishing.
