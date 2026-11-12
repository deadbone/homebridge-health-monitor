# Changelog

## 0.2.1

- Clarify the contact sensor states in Homebridge settings for both errors and warnings. Closed means no alert, and open means an active alert. Eve displays a closed sensor as “Contact Detected: Yes”.

Dans Eve, **« Contact détecté : Oui »** signifie que le capteur est fermé et qu’aucune alerte n’est active. La précision figure dans les réglages Homebridge des deux capteurs.

## 0.2.0

- Use HomeKit contact sensors by default for the main alert and the optional separate warning alert. Each can independently use a leak sensor, whose notifications may sound during Do Not Disturb.
- **Upgrade from 0.1.x:** Homebridge replaces existing leak sensors at the first restart unless the corresponding `errorSensorType` or `warningSensorType` is set to `leak` beforehand. After a replacement, set up activity notifications again and recreate automations tied to the old sensor.
- Keep automatic reset after a quiet period for both sensor types.
- Catch and log accessory update and history initialization errors so monitoring can continue.
- Build before packing so npm installs the published plugin without an install lifecycle script.

**Mise à jour depuis 0.1.x.** Contact devient le type par défaut pour les erreurs et les avertissements. Au premier redémarrage, Homebridge remplace les anciens capteurs de fuite. Pour conserver un capteur et ses automatisations, choisissez Fuite pour ce capteur avant ce redémarrage. Une notification de fuite peut sonner même en mode « Ne pas déranger ».

## 0.1.0

- Fix inode replacement, truncation, incomplete lines, split UTF-8 and overlapping log reads; bound per-cycle work and line buffering.
- Retry unavailable log files automatically, expose operational/fault state with standard HomeKit characteristics, and drain pending work during shutdown.
- Prefer explicit severity prefixes and native Homebridge ANSI levels; stop matching arbitrary words and trailing message brackets as sources.
- Add bounded per-source diagnostics, conservative repeated-error grouping, critical thresholds and explicit unknown states.
- Serialize atomic history writes, migrate existing records, redact common secrets and recover corrupt/oversized files without disabling detection.
- Prevent old anomaly evidence from reactivating an alert after quiet reset; retain active alerts during monitoring outages.
- Preserve the existing global sensor by default; optionally separate warnings into a second sensor with an independent threshold and alert state.
- Add configuration defaults, real-file integration tests, actual HAP service tests, and bilingual diagnostic/privacy/monitoring-limit documentation.
- Ignore log entries whose recognized timestamp is older than the analysis window so replayed entries cannot trigger stale alerts.
- Declare Node.js 22.12.0 as the minimum supported version, including Node.js 26.

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
