# Windows Model Credential Persistence Design

## Status

Approved direction: persist each Agent user's model configuration on the current Windows development machine. Protect API keys with Windows DPAPI so only the same Windows user on the same machine can decrypt them.

This design is intentionally local-development scoped. It does not define credential synchronization, multi-machine deployment, or a production secret-management service.

## Problem

The model configuration dialog already sends provider, base URL, model ID, and an optional API key to the Agent. The dialog clears its password field after each request and never receives the stored key back.

The Agent currently stores the configuration in an in-memory `Map`. Restarting the Agent therefore loses both UI-saved configuration and the launch-time environment default. The secure launcher compensates by asking for the key on every restart, which interrupts the DOCX-to-scene workflow.

Writing the key into frontend source, browser storage, a committed `.env`, logs, or plain SQLite would solve the restart symptom by creating a credential leak. Those locations are forbidden.

## Considered Approaches

### 1. Agent SQLite plus Windows DPAPI (selected)

Store non-secret model metadata and a DPAPI-protected key blob in the existing Agent SQLite database, keyed by authenticated subject. The frontend continues to receive only the redacted public view.

This matches the existing user-isolated model configuration API and gives save-once restart behavior without introducing a separate service.

### 2. DPAPI-protected launcher credential

Store one encrypted launch credential and expose it as a global environment default on every restart. This is smaller, but it bypasses the existing per-user frontend configuration and makes all users share one model identity.

### 3. Plain local persistence

Store the key in `.env`, local storage, JSON, or plain SQLite. This is rejected because repository access, browser developer tools, backups, or database inspection would reveal the credential.

## Architecture

### Credential protection boundary

Add a small `CredentialProtector` interface owned by the Agent model-configuration module:

- `protect(plaintext)` returns an opaque ciphertext string.
- `unprotect(ciphertext)` returns the plaintext only inside the Agent process.
- `WindowsDpapiCredentialProtector` invokes Windows PowerShell DPAPI operations with constant command text.
- Plaintext is passed only through the short-lived child process environment, never through command arguments, stdout logs, files, or error messages.
- Decryption output is captured by the parent process and is never printed.

The implementation must fail closed. If DPAPI or Windows PowerShell is unavailable, remote-provider credentials cannot be persisted as plaintext.

### Persistent repository

Add a `model_configs` table to the existing Agent schema with:

- authenticated `subject` as the primary key;
- provider, normalized base URL, and model ID as non-secret metadata;
- nullable DPAPI ciphertext;
- a cleared tombstone flag so clearing a user configuration continues to suppress any launch-time default for that subject;
- creation and update timestamps.

The table belongs to the Agent database. It has no foreign key to the Nest database because the Agent already treats the authenticated subject string as its tenant boundary.

Add a focused repository that performs transactional read, upsert, and clear/tombstone operations. Database rows and diagnostic output must never contain the plaintext key.

### ModelConfigStore

Keep `ModelConfigStore` as the policy boundary for URL validation, key-preserving updates, per-subject isolation, and redacted public views. Give it the persistent repository and credential protector as optional dependencies so unit tests and in-memory service fixtures remain lightweight.

Production behavior:

1. `get(subject)` resolves the subject row, verifies that its ciphertext can be decrypted, and returns only the existing `PublicModelConfig` shape.
2. `set(subject, input)` normalizes and validates the input, preserves an existing key only for the same provider and base URL, encrypts the resulting key, then commits the row before updating any process cache.
3. `require(subject)` returns the decrypted configuration to the model adapter without exposing it outside the Agent.
4. `resolve(subject, input)` may use a submitted transient key or the persisted key for model discovery and connection testing; it does not persist transient input.
5. `clear(subject)` writes a tombstone and removes any cached plaintext, without needing to decrypt the old blob.

The existing launch-time environment configuration remains an optional fallback for subjects with no row. A persisted tombstone continues to disable that fallback for the cleared subject.

### Frontend and provider preset

The current model configuration dialog remains the only user-facing entry point. Its password field stays empty after load and after save. No key is added to React state beyond the current transient input lifetime, and no browser storage is introduced.

Update the DeepSeek preset's default model ID to `deepseek-v4-pro`. Keep the existing base URL. Discovery and connection testing remain the authority for whether the provider actually exposes that exact model ID.

No layout or styling redesign is needed.

### Startup behavior

The Agent already accepts startup without any model environment variables. Update the secure development launcher so its normal path starts the Agent without prompting for a bootstrap key. A separately named or explicit bootstrap option may retain the old transient environment flow for recovery, but it must not be the default.

After a user saves a model configuration once through the frontend, subsequent Agent restarts load it from the DPAPI-protected database row.

## Data Flow

1. The authenticated user opens the existing model configuration dialog.
2. The user selects DeepSeek, keeps the existing base URL, selects or enters `deepseek-v4-pro`, and supplies the key once.
3. The frontend sends the existing authenticated `PUT /model-config` request over the local Agent proxy.
4. The Agent validates the provider endpoint and model ID, protects the key with DPAPI, and transactionally stores metadata plus ciphertext.
5. The response contains only `configured`, provider, base URL, model ID, and `hasApiKey`.
6. On restart, the Agent starts without a key prompt. The first authenticated config read or model use decrypts the stored blob in process.
7. Model calls receive the decrypted key only through the existing model adapter constructor.

## Failure Handling

- DPAPI protection unavailable: return `MODEL_CREDENTIAL_STORAGE_UNAVAILABLE`; do not write a partial row.
- Ciphertext corrupt, copied to another machine, or opened by another Windows user: return `MODEL_CREDENTIAL_UNAVAILABLE`; keep the Agent running and allow the user to clear and re-enter the configuration.
- Database flush failure: retain the previously committed configuration and do not report the new configuration as saved.
- Provider/model unavailable: preserve the current discovery and connection-test behavior; do not silently substitute another model.
- Clear request: remove cached plaintext and persist the tombstone even if decryption of the old blob fails.

Errors, logs, HTTP responses, test snapshots, and persisted artifacts must not contain plaintext credentials or provider authorization headers.

## Testing

### Agent unit tests

- save and load a subject through a fake protector and a reopened database;
- prove another subject cannot observe or use the configuration;
- prove stored rows, public views, JSON, and errors do not contain the plaintext test credential;
- preserve a key when only the model ID changes for the same provider/base URL;
- require a new key when provider or base URL changes;
- clear persists across restart and suppresses an environment default;
- protection, decryption, and database-flush failures use stable public errors without losing the prior config;
- transient discovery and connection tests do not persist submitted keys.

### Windows integration test

- round-trip a generated test-only value through the real DPAPI protector;
- verify the ciphertext differs from the plaintext;
- skip with an explicit reason only when the Windows DPAPI prerequisite is unavailable.

### Frontend tests

- DeepSeek defaults to `deepseek-v4-pro` for an unconfigured user;
- persisted config loads only redacted metadata;
- saving still clears the password field;
- no local/session storage is used for credentials.

### Acceptance

1. Save the DeepSeek V4 Pro configuration once from the existing frontend dialog.
2. Stop and restart the Agent without supplying model environment variables.
3. Confirm the frontend still reports DeepSeek V4 Pro with `hasApiKey: true` and never renders the key.
4. Run the real DOCX flow and confirm the model-backed draft/revision steps complete.
5. Inspect the Agent database and repository diff for absence of the plaintext credential.

## Migration and Secret Handling

There is no migration path from the current in-memory key because reading another process's environment would violate the credential boundary. The user must enter the key once after this feature is deployed. Future restarts then use the DPAPI-protected row.

The credential already posted in chat should be rotated after the current integration session. Rotation uses the same frontend save flow and overwrites the prior ciphertext without exposing either value.

## Out of Scope

- cloud or multi-machine secret synchronization;
- credentials shared across Agent users;
- non-Windows credential backends;
- frontend redesign;
- unrelated DOCX, compiler, runtime, or asset changes.
