import { timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

/** Output order. Workflows built with earlier versions depend on these positions. */
const OUTPUT_ANSWERED = 0;
const OUTPUT_VOICEMAIL = 1;
const OUTPUT_NO_ANSWER = 2;
const OUTPUT_FAILED = 3;
const OUTPUT_OTHER = 4;

function safeEqual(received: string, expected: string): boolean {
	const a = Buffer.from(received);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Picks the output for a post-call payload (`{ data: { call: { ... } } }`).
 * `call_result` is only sent when the call has a contact; without it, the
 * analysis and the disconnection reason are used, and anything unclear goes
 * to "Other".
 */
export function getOutputIndex(body: IDataObject): number {
	const data = body?.data as IDataObject | undefined;
	const call = data?.call as IDataObject | undefined;
	if (!call || typeof call !== 'object') return OUTPUT_OTHER;

	const result = String(call.call_result ?? '').toLowerCase();
	switch (result) {
		case 'answered':
			return OUTPUT_ANSWERED;
		case 'voicemail':
			return OUTPUT_VOICEMAIL;
		case 'no_answer':
		case 'busy':
			return OUTPUT_NO_ANSWER;
		case 'failed':
			return OUTPUT_FAILED;
		case '':
			break;
		default:
			return OUTPUT_OTHER;
	}

	const analysis = call.call_analysis as IDataObject | undefined;
	if (analysis?.in_voicemail === true) return OUTPUT_VOICEMAIL;

	const reason = String(call.disconnection_reason ?? '').toLowerCase();
	if (reason === 'voicemail_reached') return OUTPUT_VOICEMAIL;
	if (['no_answer', 'dial_no_answer', 'dial_busy', 'busy'].includes(reason))
		return OUTPUT_NO_ANSWER;
	if (
		String(call.call_status ?? '').toLowerCase() === 'failed' ||
		reason === 'failed' ||
		reason === 'dial_failed'
	) {
		return OUTPUT_FAILED;
	}
	return OUTPUT_OTHER;
}

export class ContactShipTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ContactShip Trigger',
		name: 'contactShipTrigger',
		icon: {
			light: 'file:../../icons/contactship.svg',
			dark: 'file:../../icons/contactship.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: 'Post-call results',
		description:
			'Starts the workflow when a ContactShip voice agent finishes a call and its analysis is ready',
		defaults: {
			name: 'ContactShip Trigger',
		},
		inputs: [],
		outputs: [
			NodeConnectionTypes.Main,
			NodeConnectionTypes.Main,
			NodeConnectionTypes.Main,
			NodeConnectionTypes.Main,
			NodeConnectionTypes.Main,
		],
		outputNames: ['Answered', 'Voicemail', 'No Answer', 'Failed', 'Other'],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					"In ContactShip, open your voice agent, go to Advanced → Post-call, paste this node's Production URL as the webhook URL and publish the agent. You can also send the URL in 'Webhook URL' when making a call with the ContactShip node. Activate the workflow so the Production URL accepts calls.",
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{
						name: 'Basic Auth',
						value: 'basicAuth',
						description:
							'Requires the username and password in the URL or in an Authorization header',
					},
					{ name: 'None', value: 'none' },
				],
				default: 'none',
				description: 'How the webhook checks that requests come from you',
			},
			{
				displayName: 'Username',
				name: 'username',
				type: 'string',
				default: '',
				displayOptions: { show: { authentication: ['basicAuth'] } },
			},
			{
				displayName: 'Password',
				name: 'password',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				displayOptions: { show: { authentication: ['basicAuth'] } },
			},
			{
				displayName: 'Required Headers',
				name: 'headers',
				placeholder: 'Add Header',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				description:
					'Headers that every request must include with the exact value. Others are rejected.',
				default: {},
				options: [
					{
						name: 'header',
						displayName: 'Header',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'e.g. x-webhook-secret',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								typeOptions: { password: true },
								default: '',
							},
						],
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			// ContactShip has no API to register post-call webhooks: the URL is set on the
			// voice agent (Advanced → Post-call) or sent per call in `webhook_url`.
			// There is nothing to create or remove on the ContactShip side.
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const authentication = this.getNodeParameter('authentication', 'none') as string;

		if (authentication === 'basicAuth') {
			const username = this.getNodeParameter('username', '') as string;
			const password = this.getNodeParameter('password', '') as string;
			const header = req.headers.authorization ?? '';
			const [scheme, encoded] = header.split(' ');
			const [user, ...rest] = Buffer.from(encoded ?? '', 'base64')
				.toString()
				.split(':');
			const authorized =
				scheme?.toLowerCase() === 'basic' &&
				safeEqual(user ?? '', username) &&
				safeEqual(rest.join(':'), password);
			if (!authorized) {
				res.setHeader('WWW-Authenticate', 'Basic realm="ContactShip Trigger"');
				res.status(401).json({ message: 'Authorization is required' });
				return { noWebhookResponse: true };
			}
		}

		const requiredHeaders =
			((this.getNodeParameter('headers', {}) as IDataObject).header as IDataObject[] | undefined) ??
			[];
		for (const required of requiredHeaders) {
			const name = String(required.name ?? '')
				.trim()
				.toLowerCase();
			if (!name) continue;
			const received = req.headers[name];
			const value = Array.isArray(received) ? received.join(',') : String(received ?? '');
			if (!safeEqual(value, String(required.value ?? ''))) {
				res.status(403).json({ message: 'A required header is missing or has a different value' });
				return { noWebhookResponse: true };
			}
		}

		const raw = this.getBodyData() as unknown;
		const body: IDataObject =
			raw !== null && typeof raw === 'object' && !Array.isArray(raw)
				? (raw as IDataObject)
				: { body: raw as IDataObject[] };

		const outputs: INodeExecutionData[][] = [[], [], [], [], []];
		outputs[getOutputIndex(body)] = this.helpers.returnJsonArray(body);

		return {
			webhookResponse: { status: 'success' },
			workflowData: outputs,
		};
	}
}
