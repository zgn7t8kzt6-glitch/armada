# Terraform

Placeholder. Infrastructure as Code arrives when a HIPAA-eligible cloud
environment is selected and approved (blueprint §5.3). Requirements already
fixed by the blueprint:

- Separate development, test, staging, and production environments.
- Managed secrets vault; no secrets in code or state committed to git.
- Encryption at rest with managed keys; TLS 1.2+ in transit.
- Managed container platform (avoid Kubernetes unless justified).
- Centralized structured logging and OpenTelemetry-compatible metrics.

Provisioning code must land here with its own ADR and a security review before
first apply.
