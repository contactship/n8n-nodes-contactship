# n8n-nodes-contactship

This is an n8n community node package. It lets you use [ContactShip](https://contactship.ai) in your n8n workflows.

ContactShip is a contact center platform where AI voice agents and people handle phone calls and WhatsApp conversations together. With these nodes you can start AI phone calls, keep contacts, boards and tasks up to date, send WhatsApp messages and events, manage voice agents and their versions, work with inbox conversations, and run a workflow every time a call ends.

The package has two nodes:

- **ContactShip**: actions on calls, contacts, boards, tags, tasks, events, WhatsApp, conversations, channels, voice agents and their versions, voices, phone numbers and credits.
- **ContactShip Trigger**: starts a workflow with the results of a call (outcome, summary, extracted data, transcript), with one output per call result, and with the follow-up closures of text agents.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [ContactShip Trigger](#contactship-trigger) · [Example workflows](#example-workflows) · [Usage notes](#usage-notes) · [Compatibility](#compatibility) · [Upgrading from 0.x](#upgrading-from-0x) · [Development](#development) · [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

In short, on a self-hosted n8n instance:

1. Go to **Settings → Community Nodes**.
2. Select **Install a community node**.
3. Enter `n8n-nodes-contactship` and confirm.

The package has no runtime dependencies: it only uses the HTTP helpers that n8n provides.

## Credentials

The nodes use the ContactShip public API (`https://api.contactship.ai`) with an organization API key, sent in the `x-api-key` header.

1. Sign in to [ContactShip](https://app.contactship.ai). Your plan must include API access.
2. Open **Organization → API Keys** and generate a key. Each key belongs to one organization.
3. In n8n, create a **ContactShip API** credential and paste the key in **API Key**. Leave **Base URL** as `https://api.contactship.ai` unless ContactShip support tells you otherwise.

n8n tests the credential by reading your credit balance (`GET /v1/credits`), which does not change anything in your account.

Keep the key private: it gives access to the whole organization. See [API keys](https://docs.contactship.ai/en/organization/api-keys.md) in the ContactShip docs.

## Operations

Fields that point to a ContactShip record (agent, agent version, voice, phone number, board, stage, tag, contact, organization member, WhatsApp channel, template) can be picked from a list loaded from your account, or set by ID with an expression. When a list has nothing to pick, it says why (for example, *No approved templates in this channel*).

- **Contact** fields can be picked from a list (search by name, phone number or email), or set by ID, phone number or email. With a phone number or email, the node looks the contact up first (`GET /v1/contacts/{identifier}`).
- **Phone numbers** show the country (from the calling code), alias and type; **voices** show gender, accent and language.
- Fields with values that depend on your account (WhatsApp template variables, the `{{variables}}` of an agent's prompt, your contact properties) show one input per value.

### Call

| Operation | What it does | API |
| --- | --- | --- |
| Make Phone Call | Calls a phone number with an AI voice agent. Optional: country, email, delay, schedule (date, time and time zone), variables passed to the agent, metadata, per-call webhook URL, and whether to update an existing contact. | `POST /v1/calls/single-phone-call` |
| Call Contact | Calls an existing contact with an AI voice agent. Optional: schedule, variables and metadata. | `POST /v1/calls/single-contact-call` |
| Get | Retrieves a call with its analysis. With Simplify off, it includes the transcript, and optionally the timing of each word. | `GET /v1/calls/{callId}` |
| Get Many | Lists the calls made through the API, newest or oldest first, filtered by phone number, result, status and creation date. | `GET /v1/calls` |
| Get Status | Tells whether a call is queued, ringing, in progress or finished. | `GET /v1/calls/{callId}/status` |
| Stop | Hangs up a call that is ringing or in progress. | `POST /v1/calls/single-phone-call/{callId}/stop` |
| Cancel Scheduled Call | Cancels a scheduled call before it is placed. | `POST /v1/calls/single-phone-call/{callId}/cancel` |

Phone numbers must be in international format (`+12125551234`). The node removes spaces, dashes, dots and parentheses before sending them.

**Get Many** sends the phone number filter to ContactShip; the result, status and date filters are applied by the node to the calls ContactShip returns, so a filter on an old date range reads more pages. With a 'Created After' date, the node stops reading at that date.

**Agent Variables** lists the `{{variables}}` written in the selected agent's prompt and begin message, one input each (ContactShip's own variables, such as `{{contact_data}}` or `{{current_time}}`, are left out). **Extra Variables** (name and value) and **Extra Variables (JSON)** add any other context. All of them are sent as `additional_data`; when two have the same name, the later one wins.

### Contact

| Operation | What it does | API |
| --- | --- | --- |
| Create | Creates a contact with name, phone number, country and, optionally, email and properties. | `POST /v1/contacts` |
| Create or Update | Looks up the contact by phone number and updates it, or creates it if it does not exist. | `GET /v1/contacts/{phone}` + `PATCH` or `POST` |
| Get | Retrieves a contact by ID, phone number or email. | `GET /v1/contacts/{identifier}` |
| Get Many | Lists contacts, filtered by name, email or phone number (partial match). | `GET /v1/contacts` |
| Update | Changes name, phone number, country, email or properties. Properties sent here replace all the contact's properties. | `PATCH /v1/contacts/{contactId}` |
| Update Properties | Changes property values (additional data) of a contact. | `PATCH /v1/contacts/{contactId}/additional-data` |
| Delete | Deletes a contact permanently. | `DELETE /v1/contacts/{contactId}` |
| Get Call History | Retrieves the calls of a contact, one item per call. | `GET /v1/contacts/{contactId}/call-history` |
| Get Comments | Retrieves the comments of a contact, one item per comment. | `GET /v1/contacts/{contactId}/comments` |
| Create Comment | Adds a comment to the contact's activity, written as an organization member (picked from the list or by email), AI, system or automation. | `POST /v1/comments` |
| Get Tags | Retrieves the tags assigned to a contact. | `GET /v1/contacts/{contactId}/tags` |
| Add Tag | Assigns a tag to a contact. | `POST /v1/contacts/{contactId}/tags/{tagId}` |
| Remove Tag | Removes a tag from a contact. The tag itself is kept. | `DELETE /v1/contacts/{contactId}/tags/{tagId}` |

**Contact Properties** shows one input per property defined in your organization (`GET /v1/organization/contact-properties`): a list for properties with options, a number, a toggle or a date picker where it applies, and text otherwise. **Custom Properties** stores any other field, with a type (text, number, calendar, URL or location).

### Board

Boards (pipelines) organize contacts into stages. Each contact on a board is a card.

| Operation | What it does | API |
| --- | --- | --- |
| Get Many | Lists contact boards (or agent boards). | `GET /v1/board/list` |
| Get | Retrieves a board with its stages. | `GET /v1/board/{id}` |
| Add Contact | Adds a contact to a stage of a board. | `POST /v1/card` |
| Get Contact Card | Retrieves the card of a contact on a board. Use its ID in Move Card and Remove Card. | `GET /v1/board/{id}/contact/{contactId}` |
| Move Card | Moves a contact's card to another stage. | `PUT /v1/card/move` |
| Remove Card | Removes a contact's card from a board. The contact is kept. | `DELETE /v1/card/{id}` |

### Tag

| Operation | What it does | API |
| --- | --- | --- |
| Create | Creates a tag with name, label and color. | `POST /v1/tags` |
| Get Many | Lists tags, filtered by name or label. | `GET /v1/tags` |
| Update | Changes the name, label or color of a tag. | `PATCH /v1/tags/{tagId}` |
| Delete | Deletes a tag and removes it from every contact. | `DELETE /v1/tags/{tagId}` |

### WhatsApp

Messages are sent through a WhatsApp Business channel connected in ContactShip, to an existing contact.

| Operation | What it does | API |
| --- | --- | --- |
| Send Message | Sends a text message. WhatsApp only allows free text within 24 hours of the contact's last message. | `POST /v1/waba/send` |
| Send Template | Sends an approved template, needed to start or reopen a conversation. See below. | `POST /v1/waba/send-template` |
| Send Media | Sends an image, video, audio file or document, from a public URL or from a binary file of a previous node. | `POST /v1/waba/send-media` |
| Send Voice Note | Sends an audio file as a voice note, from a public URL or from a binary file of a previous node. | `POST /v1/waba/send-voice` |
| Get Many Templates | Lists the templates of a channel. | `GET /v1/waba/templates` |

The channel list comes from `GET /v1/channels` (channels of type `WABA`; disconnected channels show their status).

**Send Template**: the template list shows the approved templates of the channel as *name (language)*, so a template that exists in several languages can be told apart, and the language is sent with it. With an expression, use the template name, or `name:language` (for example `welcome:es_MX`). **Variables** has two modes:

- **Map Each Variable** (default) shows one input per value the template needs, with Meta's example values as hints: the header (text variable, or the image, video or document URL, or the location), every body variable (`{{1}}` or named, such as `{{first_name}}`) and the button parameters (URL suffix, coupon code, one-time password). The node builds the `components` array.
- **Using JSON** sends **Components (JSON)** as it is, in the Meta Cloud API format.

### Event

| Operation | What it does | API |
| --- | --- | --- |
| Send | Records something a contact did in another system (a purchase, an order, a form) in their ContactShip activity, Google Analytics 4 style: event name, contact (ID, external ID, phone or email), parameters, value, currency, links, company and session ID. Each input item becomes one event; the node sends them in batches of up to 100 and returns one result per item. | `POST /v1/events` |

| Identify Session | Links the session ID of a visit (for example, the Google Analytics client ID) to a contact found by ID, external ID, phone or email, or created. The anonymous events sent with that session move to the contact within a minute. | `POST /v1/identify` |

Events require the Events add-on. Without it, ContactShip answers `403`. Events that ContactShip marks as `invalid` or `rejected` stop the node (or are returned with an `error` field when **Continue On Fail** is on).

### Task

| Operation | What it does | API |
| --- | --- | --- |
| Create | Creates a task with title, details, creator and type. Optional: assignees, priority, status and additional data. The creator and the assignees are picked from the members of your organization (`GET /v1/organization/users`) or set by email. | `POST /v1/tasks` |
| Get | Retrieves a task. | `GET /v1/tasks/{id}` |
| Get Many | Lists tasks, filtered by status or priority and sorted by creation or update date. | `GET /v1/tasks` |
| Update | Changes title, details, assignees, priority, status or additional data. | `PUT /v1/tasks/{id}` |
| Delete | Deletes a task. | `DELETE /v1/tasks/{id}` |

### Agent

| Operation | What it does | API |
| --- | --- | --- |
| Create | Creates a voice agent with a name, voice and time zone, plus any other field. Its first version is published right away. | `POST /v1/agents` |
| Delete | Deletes a voice agent permanently. | `DELETE /v1/agents/{agentId}` |
| Get Many | Lists your voice agents. | `GET /v1/agents` |
| Get | Retrieves the published configuration of a voice agent. | `GET /v1/agents/{agentId}` |
| Update | Changes a voice agent (prompt, begin message, voice, language, time zone, tools, post-call fields, webhook URL and more) and publishes the change right away. If someone has a draft of the agent open in ContactShip, the draft stays open but is based on the previous version; turn on **Stop If a Draft Is Open** to stop instead. | `PUT /v1/agents/{agentId}` |

Create, Update and Update Draft have a **Configuration** switch: **Define Below** (one input per field, with the voice picked from a list) or **Using JSON** (the API field names). **Tools (JSON)** and **Post-Call Analysis Fields (JSON)** replace the whole list: read the agent first and send everything it should keep.

### Agent Version

The ContactShip editor works on a draft and publishes it explicitly. Publishing archives the previous version.

| Operation | What it does | API |
| --- | --- | --- |
| Get Many | Lists the versions of an agent (draft, published and archived), newest first. | `GET /v1/agents/{agentId}/versions` |
| Get Draft | Retrieves the open draft, or `draft: null` when there is none. | `GET /v1/agents/{agentId}/versions/draft` |
| Get Published | Retrieves the version that is live for calls. | `GET /v1/agents/{agentId}/versions/published` |
| Open Draft | Opens a draft from the published version, or returns the one already open. | `POST /v1/agents/{agentId}/versions/draft` |
| Update Draft | Changes the draft without publishing it, opening one first if needed. Same fields as Update. Booking tools cannot be staged in a draft. | `POST` + `PATCH /v1/agents/{agentId}/versions/draft` |
| Publish | Publishes the open draft, or a version you pick, with an optional changelog. | `POST /v1/agents/{agentId}/versions/publish` |
| Rollback | Publishes an archived version again, as a new version. | `POST /v1/agents/{agentId}/versions/rollback` |

### Voice

| Operation | What it does | API |
| --- | --- | --- |
| Get Many | Lists the voices available for voice agents, filtered by gender, language or text. | `GET /v1/agents/voices` |
| Get | Retrieves a voice. | `GET /v1/agents/voices/{voiceId}` |

### Conversation

Conversations (threads) are the WhatsApp and chat conversations of the ContactShip inbox. The ID is returned as `thread_id` when a WhatsApp message is sent.

| Operation | What it does | API |
| --- | --- | --- |
| Get | Retrieves a conversation with its channel, contact, status and assignee. | `GET /v1/thread/{threadId}` |
| Get Message | Retrieves one message. | `GET /v1/messages/{messageId}` |
| Update | Closes or reopens a conversation, and assigns it to a member of your organization (picked from the list), to a text agent (by ID) or to nobody. Closing runs the on-close automations of your inbox. If your organization protects assignments, ContactShip refuses assignment changes made with an API key. | `PUT /v1/thread/{threadId}` |

### Channel

| Operation | What it does | API |
| --- | --- | --- |
| Get Many | Lists the messaging channels of your organization (WhatsApp, Instagram, Messenger, TikTok…), filtered by type, status, name or who answers. Only the ID, name, type, status, answer method, display value and dates are returned. | `GET /v1/channels` |

### Phone Number

| Operation | What it does | API |
| --- | --- | --- |
| Get Many | Lists the phone numbers of your organization, filtered by type (inbound or outbound). | `GET /v1/phone-numbers` |

### Credit

| Operation | What it does | API |
| --- | --- | --- |
| Get Balance | Retrieves the credit balance of your organization. | `GET /v1/credits` |

### Output

Version 2 of the ContactShip node returns the records themselves (the `data` field of the API response). Operations that list records return one item per record, and delete operations return `{ "deleted": true }`. Calls and agents have a **Simplify** option, on by default, that returns the 10 most useful fields; turn it off to get the full record. Agent Version → Get Many has the same option, which returns the version details without the configuration.

## ContactShip Trigger

The trigger receives the post-call webhook that ContactShip sends when a call ends and its analysis is ready, and, from trigger version 2, the follow-up closure webhook of text agents.

### Setup

1. Add a **ContactShip Trigger** node and activate the workflow.
2. Copy the node's **Production URL**.
3. Send ContactShip that URL in one of these ways:
   - **For every call of an agent**: in ContactShip, open the voice agent, go to **Advanced → Post-call**, paste the URL as the webhook and publish the agent. You can also set it with the ContactShip node: **Agent → Update → Webhook URL**.
   - **For one call**: in the ContactShip node, **Call → Make Phone Call → Additional Fields → Webhook URL**.
   - **For text-agent follow-ups**: open the text agent, go to **Advanced → Follow-ups → Close webhook**, paste the URL and choose the **POST** method.
4. Make a test call and check the execution in n8n, and the delivery in ContactShip under **Calls → Webhooks**.

ContactShip has no API to register webhooks, so the trigger does not create or remove anything in your account: activating or deactivating the workflow only turns the URL on or off. Use the **Test URL** only while you listen for a test event in the editor.

### Outputs

The node has one output per call result:

| Output | When |
| --- | --- |
| Answered | `call_result` is `answered` |
| Voicemail | `call_result` is `voicemail`, or the analysis detected voicemail |
| No Answer | `call_result` is `no_answer` or `busy`, or the call disconnected for no answer |
| Failed | `call_result` is `failed`, or the call status is `failed` |
| Other | Anything else, for example web calls without a contact, which have no `call_result` |
| Follow-Up Closed | The follow-up closure webhook of a text agent (`event` is `follow_up_closed`). Only in trigger version 2; in version 1 these payloads go to **Other**. |

Each item is the webhook body as ContactShip sends it. The most used fields are:

| Field | Content |
| --- | --- |
| `data.call.call_id` | Call ID, the same `call_id` returned by Make Phone Call |
| `data.call.call_type` | `api_call`, `campaign_call`, `inbound_call`, `platform_contact_call`, `test_phone_call`, `test_web_call`, `web_call` or `widget_web_call` |
| `data.call.call_result` | `answered`, `voicemail`, `no_answer`, `busy` or `failed` (only when the call has a contact) |
| `data.call.duration` | Duration in seconds |
| `data.call.call_analysis.call_summary` | Summary of the conversation |
| `data.call.call_analysis.custom_analysis_data` | The fields you configured to extract in the agent's post-call settings |
| `data.call.call_analysis.evaluation_results` | Results of the agent's evaluation criteria, when configured |
| `data.call.transcript` | Plain-text transcript |
| `data.call.recording_url` | Recording URL, when available |
| `data.contact` | Contact name, phone, email, country and properties, when the call has a contact |
| `data.agent` | Agent ID, name, language and voice |
| `data.campaign` | Campaign details for campaign calls |

See [Call webhook payload](https://docs.contactship.ai/api-reference/webhooks.md) for the full reference and examples. ContactShip can deliver the same call more than once (retries): use `data.call.call_id` to avoid repeating actions.

Follow-up closures have no `data` envelope: `event`, `threadId`, `agentId`, `closureReason` (`all_stages_completed_no_response` or `ai_determined_conversation_resolved`), `closureReasonDescription`, `totalStages`, `currentStage`, `closedAt`, `contact` (`id`, `phone`, `name`) and `conversationSummary`. See [Follow-up closure webhook](https://docs.contactship.ai/api-reference/follow-up-webhook.md). They are not retried, and one conversation can have more than one follow-up cycle.

### Authentication

ContactShip does not sign post-call webhooks or add custom headers to them. The n8n webhook URL contains a random ID, so keep it private. The trigger can also require Basic Auth or specific headers and rejects requests that do not match; these options are useful when a proxy or another system calls the URL.

## Example workflows

The [`templates`](templates) folder has workflows you can import in n8n (**Workflows → Import from File**). Each one has a sticky note with the setup steps.

| Template | What it does |
| --- | --- |
| [Call new form leads within seconds](templates/call-new-form-leads.json) | Webhook → ContactShip **Make Phone Call**: an AI agent calls each new lead right away. |
| [Log call results in Google Sheets](templates/post-call-results-to-google-sheets.json) | ContactShip Trigger → Google Sheets: one row per finished call with result, summary, extracted data and recording. |
| [WhatsApp template on new sheet row](templates/whatsapp-template-on-new-sheet-row.json) | Google Sheets Trigger → ContactShip **Create or Update** contact → **Send Template**. |
| [Daily call summary in Slack](templates/daily-call-summary-to-slack.json) | Schedule → ContactShip **Get Many** calls (yesterday) → Code → Slack. |
| [Caller context before an inbound call](templates/inbound-context-webhook.json) | Webhook → Code → Respond to Webhook: returns the JSON object ContactShip asks for before an inbound call (the inbound context webhook), whose keys the agent uses as `{{variables}}`. |
| [HTTP tool for a voice agent](templates/http-tool-for-voice-agent.json) | Webhook → Code → Respond to Webhook: answers a custom tool of a voice agent during a call, reading `args` and returning the result. |

## Usage notes

- **Calls and messages are real.** Make Phone Call, Call Contact and the WhatsApp operations contact real people and use credits. Test with your own number first. If a request times out, check the call or message before running it again, so the person is not contacted twice.
- **Agent changes go live.** Agent → Create and Update, and Agent Version → Publish and Rollback, change what callers hear right away. Use Agent Version → Update Draft to stage a change and publish it later.
- **Rate limits.** ContactShip limits requests per organization, with a lower limit on listing contacts and calls. When it answers `429`, the node says so; turn on **Retry On Fail** in the node settings to retry automatically.
- **Call results arrive later.** A call ends seconds after it starts, but its analysis and transcript are ready later. Use the ContactShip Trigger, or poll **Get Status** and then **Get**.
- **Scheduled calls.** A date without a time zone offset is read in the **Time Zone** field, or in the workflow time zone when it is empty.
- **AI agents.** Version 2 of the ContactShip node is usable as a tool by n8n AI agents. On self-hosted n8n, community nodes work as tools when `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` is set.

## Compatibility

- Requires n8n 1.85.0 or later.
- Built and linted with `@n8n/node-cli` 0.51 and `n8n-workflow` 2.42.
- Works on self-hosted n8n. To appear in n8n Cloud, the package must be verified by n8n.

## Upgrading from 0.x

Version 1.0.0 keeps the node and credential names (`contactShip`, `contactShipTrigger`, `contactShipApi`), so existing workflows and credentials keep working:

- Workflows created with 0.x keep using **version 1** of the ContactShip node, with the same parameters and the same output (the full API response, including `statusCode` and `data`).
- New ContactShip nodes use **version 2**, with the resources and operations listed above. To move a workflow to version 2, add a new ContactShip node and update the expressions that read its output: version 2 returns the records directly (for example `$json.id` instead of `$json.data.id`).
- The ContactShip Trigger keeps its webhook path, and workflows created with 0.x keep **trigger version 1** with its five outputs, so URLs already pasted in ContactShip keep working. New trigger nodes use **version 2**, which adds a sixth output, **Follow-Up Closed**, after the other five.

See the [changelog](CHANGELOG.md) for details.

## Development

Requirements: Node.js 24 or later (`lts/*`) and npm.

```bash
git clone https://github.com/contactship/n8n-nodes-contactship.git
cd n8n-nodes-contactship
npm install
npm run build   # compile to dist/
npm run lint    # n8n community node linter
npm run dev     # start n8n with the nodes loaded, at http://localhost:5678
```

`npm run dev` starts n8n in a container (Docker or Podman). To use an n8n you run yourself, use `npx n8n-node dev --external-n8n`.

### Releasing

Releases are published to npm from GitHub Actions with a [provenance statement](https://docs.npmjs.com/generating-provenance-statements), as n8n requires for verified community nodes. The workflow is [`.github/workflows/publish.yml`](.github/workflows/publish.yml) and runs when a version tag (`1.2.3` or `v1.2.3`) is pushed. The tag must match `version` in `package.json`.

One-time setup, on [npmjs.com](https://www.npmjs.com/): open the package settings, go to **Publish access → Trusted Publishers**, add a **GitHub Actions** publisher with owner `contactship`, repository `n8n-nodes-contactship` and workflow `publish.yml`. No token is needed. As a fallback, create a granular access token with publish rights for this package and store it as the `NPM_TOKEN` secret of the repository.

To release:

```bash
npm run release   # lint, build, bump the version, update the changelog, commit, tag and push
```

or bump `version` in `package.json`, update [CHANGELOG.md](CHANGELOG.md), commit, and push a tag with the same version (`git tag 1.0.1 && git push origin 1.0.1`).

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [ContactShip API reference](https://docs.contactship.ai/api-reference/introduction.md)
- [ContactShip post-call webhook payload](https://docs.contactship.ai/api-reference/webhooks.md)
- [ContactShip follow-up closure webhook](https://docs.contactship.ai/api-reference/follow-up-webhook.md), [inbound context webhook](https://docs.contactship.ai/api-reference/inbound-webhook.md) and [HTTP tool execution](https://docs.contactship.ai/api-reference/tool-execution.md)
- [ContactShip documentation](https://docs.contactship.ai)
- Support: [support@contactship.ai](mailto:support@contactship.ai) or [open an issue](https://github.com/contactship/n8n-nodes-contactship/issues)

## License

[MIT](LICENSE.md)
