# Password Reset Implementation Plan

**Goal:** Make login failures visible and provide a usable one-time password reset flow.

**Architecture:** Store a hashed reset token and expiry on `User`; issue a raw token only in the email URL, invalidate it on use, and expose a generic request response. Add login and reset UI routes using the existing auth API patterns.

**Verification:** API auth tests, web Login tests, API build, and one local reset request/use flow.

## Tasks

- [ ] Add reset fields and migration, then test token expiry and one-time use.
- [ ] Add `forgot-password` and `reset-password` API routes with generic responses and mail/log delivery.
- [ ] Catch login errors and add forgot/reset pages.
- [ ] Rebuild API/web and verify the local flow.
