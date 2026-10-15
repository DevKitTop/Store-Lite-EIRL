# Structured Logging Specification

## Purpose

Provide a centralized logger abstraction that bridges console methods to Sentry Logs with structured formatting and level filtering.

## Requirements

### Requirement: Logger Abstraction

The system SHALL provide a centralized logger that wraps Sentry Logs and falls back to console when Sentry is unavailable.

#### Scenario: Logger available

- GIVEN Sentry SDK is initialized
- WHEN logger.info("message") is called
- THEN the message is sent to Sentry Logs with level "info"
- AND the message is also written to console

#### Scenario: Sentry unavailable

- GIVEN Sentry SDK is not initialized
- WHEN logger.error("message") is called
- THEN the message is written to console with level "error"
- AND no error is thrown

### Requirement: Level Filtering

The system SHALL support log levels (debug, info, warn, error) and filter based on environment.

#### Scenario: Production filtering

- GIVEN environment is production
- WHEN logger.debug("message") is called
- THEN the message is discarded (not sent to Sentry or console)

#### Scenario: Development verbose

- GIVEN environment is development
- WHEN logger.debug("message") is called
- THEN the message is written to console with level "debug"

### Requirement: Environment-Aware Formatting

The system SHALL format logs differently in development versus production.

#### Scenario: Development formatting

- GIVEN environment is development
- WHEN logger.info("user login", { userId: "123" }) is called
- THEN the console output includes timestamp, level, message, and structured data in readable format

#### Scenario: Production formatting

- GIVEN environment is production
- WHEN logger.info("user login", { userId: "123" }) is called
- THEN the console output is JSON-structured with timestamp, level, message, and data

### Requirement: PII Scrubbing

The system SHALL scrub sensitive data from log messages before sending to Sentry.

#### Scenario: Email in message

- GIVEN logger.info("User email: test@example.com") is called
- WHEN the message is sent to Sentry Logs
- THEN the email address is redacted or removed from the message

#### Scenario: Phone in metadata

- GIVEN logger.warn("Call failed", { phone: "+1234567890" }) is called
- WHEN the metadata is sent to Sentry Logs
- THEN the phone number is redacted or removed from the metadata
