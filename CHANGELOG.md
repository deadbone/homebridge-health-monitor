# Changelog

## Unreleased

- Fix inode replacement, truncation, incomplete lines, split UTF-8 and overlapping log reads; bound per-cycle work and line buffering.
- Retry unavailable log files automatically, expose operational/fault state with standard HomeKit characteristics, and drain pending work during shutdown.
- Prefer explicit severity prefixes and native Homebridge ANSI levels; stop matching arbitrary words and trailing message brackets as sources.
- Add bounded per-source diagnostics, conservative repeated-error grouping, critical thresholds and explicit unknown states.
- Serialize atomic history writes, migrate existing records, redact common secrets and recover corrupt/oversized files without disabling detection.
- Prevent old anomaly evidence from reactivating an alert after quiet reset; retain active alerts during monitoring outages.
- Preserve the existing global sensor by default; optionally separate warnings into a second sensor with an independent threshold and alert state.
- Add configuration defaults, real-file integration tests, actual HAP service tests, and bilingual diagnostic/privacy/monitoring-limit documentation.
- Keep package version, runtime dependencies and declared Node.js/Homebridge ranges unchanged. No publication performed.

## 0.1.0-beta.1

- Stop asynchronous monitor startup cleanly when shutdown happens during initialization.
- Close the log file handle if startup is cancelled after opening the log file.
- Add tests for entrypoint registration, cached accessory cleanup, history parsing, lazy log tail reads, and stopped-during-startup behavior.
- Raise test coverage above 90%.

## 0.1.0-alpha.8

- Guard Homebridge storage path resolution and platform startup so container restarts cannot loop because of a plugin startup exception.

## 0.1.0-alpha.7

- Made package verification independent of npm dry-run JSON output differences.

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
