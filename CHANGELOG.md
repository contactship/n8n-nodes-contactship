# Changelog

All notable changes to this package are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses [semantic versioning](https://semver.org/).

## [1.0.0] - 2026-10-12

Rebuilt with the official n8n community node tooling (`@n8n/node-cli`) to meet the n8n verification guidelines, and extended to cover the current ContactShip public API.

### Breaking changes

- New ContactShip nodes use **node version 2**, with a new set of resources and operations, and return the records themselves instead of the raw API response (for example `$json.id` instead of `$json.data.id`). Lists return one item per record.
- Workflows created with 0.x keep **node version 1**, with the same parameters and output, so they do not need changes.
- Requires n8n 1.85.0 or later.

### Added

- Call: Call Contact, Get, Get Many (filters, sorting, transcript options), Get Status, Stop and Cancel Scheduled Call. Make Phone Call now supports a schedule with time zone, variables, metadata, a per-call webhook URL and updating an existing contact.
- Contact: Create or Update (by phone number), Update Properties, Get Tags, Add Tag and Remove Tag with a tag picker, comments written as a member, AI, system or automation, and pagination with Return All and Limit on Get Many.
- Board (pipeline): Get Many, Get, Add Contact, Get Contact Card, Move Card and Remove Card, with board and stage pickers.
- Tag: Create, Get Many, Update and Delete.
- WhatsApp: Send Message, Send Template (template picker, body variables, automatic language detection, raw components), Send Media (URL or binary file) and Get Many Templates, with a channel picker.
- Event: Send, which batches input items into requests of up to 100 events.
- Task: Create, Get, Get Many, Update and Delete.
- Pickers (resource locators) for agents, phone numbers, boards, tags and WhatsApp channels, and lists for stages, templates and contact properties.
- Simplify option for calls and agents.
- Error messages that say what happened and how to fix it (invalid API key, missing add-on, record not found, rate limits).
- Credential test (`GET /v1/credits`) and authentication through the credential (`x-api-key` header).
- Light and dark icons.
- Example workflows in `templates/`.
- GitHub Actions workflow that publishes to npm with provenance.

### Changed

- All requests use n8n's built-in HTTP helpers; the `axios` runtime dependency was removed. The package has no runtime dependencies.
- All texts are in English.
- ContactShip Trigger: when a call has no `call_result` (for example web calls without a contact), the output is chosen from the voicemail detection, the call status and the disconnection reason; anything unclear still goes to **Other**. Unauthorized requests now get a `401`/`403` response instead of hanging. The webhook path and the five outputs are unchanged.
- Node version 1: Add Comment sends the author type the API now requires, the tag operations show the contact field they need, and the default limit of Phone Number → Get Many is 50.

### Removed

- ContactShip Trigger: the Debug Mode option, which wrote payloads to the server log.
- The unused optional credential on the ContactShip Trigger.

## [0.5.1] - 2025-05-27

Last release built with the previous tooling: AI phone calls, contacts, tags, boards, agents, credits and phone numbers, and the ContactShip Trigger.
