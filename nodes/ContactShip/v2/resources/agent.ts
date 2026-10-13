import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest } from '../../shared/transport';
import {
	getIdParameter,
	parseJsonParameter,
	simplifyAgent,
	splitList,
	toExecutionData,
	unwrap,
} from '../../shared/utils';
import type { ResourceHandler } from './common';
import { agentLocator, simplifyField, voiceLocator } from './common';

const RESOURCE = 'agent';

export const LANGUAGE_OPTIONS = [
	{ name: 'Catalan', value: 'ca-ES' },
	{ name: 'Chinese', value: 'zh-CN' },
	{ name: 'Danish', value: 'da-DK' },
	{ name: 'Dutch', value: 'nl-NL' },
	{ name: 'English (Australia)', value: 'en-AU' },
	{ name: 'English (India)', value: 'en-IN' },
	{ name: 'English (New Zealand)', value: 'en-NZ' },
	{ name: 'English (UK)', value: 'en-GB' },
	{ name: 'English (US)', value: 'en-US' },
	{ name: 'Finnish', value: 'fi-FI' },
	{ name: 'French (Canada)', value: 'fr-CA' },
	{ name: 'French (France)', value: 'fr-FR' },
	{ name: 'German', value: 'de-DE' },
	{ name: 'Greek', value: 'el-GR' },
	{ name: 'Hindi', value: 'hi-IN' },
	{ name: 'Hungarian', value: 'hu-HU' },
	{ name: 'Indonesian', value: 'id-ID' },
	{ name: 'Italian', value: 'it-IT' },
	{ name: 'Japanese', value: 'ja-JP' },
	{ name: 'Korean', value: 'ko-KR' },
	{ name: 'Multilingual (Spanish and English)', value: 'multi' },
	{ name: 'Norwegian', value: 'no-NO' },
	{ name: 'Polish', value: 'pl-PL' },
	{ name: 'Portuguese (Brazil)', value: 'pt-BR' },
	{ name: 'Portuguese (Portugal)', value: 'pt-PT' },
	{ name: 'Romanian', value: 'ro-RO' },
	{ name: 'Russian', value: 'ru-RU' },
	{ name: 'Slovak', value: 'sk-SK' },
	{ name: 'Spanish (Latin America)', value: 'es-419' },
	{ name: 'Spanish (Spain)', value: 'es-ES' },
	{ name: 'Swedish', value: 'sv-SE' },
	{ name: 'Turkish', value: 'tr-TR' },
	{ name: 'Vietnamese', value: 'vi-VN' },
];

export const AMBIENT_SOUND_OPTIONS = [
	{ name: 'Call Center', value: 'call-center' },
	{ name: 'Coffee Shop', value: 'coffee-shop' },
	{ name: 'Convention Hall', value: 'convention-hall' },
	{ name: 'Mountain Outdoor', value: 'mountain-outdoor' },
	{ name: 'None', value: 'none' },
	{ name: 'Static Noise', value: 'static-noise' },
	{ name: 'Summer Outdoor', value: 'summer-outdoor' },
];

const AGENT_TAG_OPTIONS = [
	{ name: 'Billing', value: 'billing_tag' },
	{ name: 'Collections', value: 'collections_tag' },
	{ name: 'Consultant', value: 'consultant_tag' },
	{ name: 'Customer Service', value: 'customer_service_tag' },
	{ name: 'Marketing', value: 'marketing_tag' },
	{ name: 'Onboarding', value: 'onboarding_tag' },
	{ name: 'Operations', value: 'operations_tag' },
	{ name: 'Order Taker', value: 'order_taker_tag' },
	{ name: 'Quality Assurance', value: 'quality_assurance_tag' },
	{ name: 'Retention', value: 'retention_tag' },
	{ name: 'Sales', value: 'sales_tag' },
	{ name: 'Scheduler', value: 'scheduler_tag' },
	{ name: 'Support', value: 'support_tag' },
	{ name: 'Surveyor', value: 'surveyor_tag' },
	{ name: 'Tech Support', value: 'tech_support_tag' },
];

/** Fields of the agent configuration, as in POST and PUT /v1/agents. */
function configOptions(kind: 'create' | 'update'): INodeProperties[] {
	const options: INodeProperties[] = [
		{
			displayName: 'Agent Tag',
			name: 'agentTag',
			type: 'options',
			options: AGENT_TAG_OPTIONS,
			default: 'sales_tag',
			description: 'Category of the agent',
		},
		{
			displayName: 'Ambient Sound',
			name: 'ambientSound',
			type: 'options',
			options: AMBIENT_SOUND_OPTIONS,
			default: 'none',
			description: 'Background sound played during calls',
		},
		{
			displayName: 'Ambient Sound Volume',
			name: 'ambientSoundVolume',
			type: 'number',
			typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 1 },
			default: 1,
			description: 'Volume of the ambient sound (0 to 2)',
		},
		{
			displayName: 'Begin Message',
			name: 'beginMessage',
			type: 'string',
			default: '',
			placeholder: 'e.g. Hi, this is Ana from Acme Realty.',
			description: 'First sentence the agent says, up to 240 characters',
		},
		{
			displayName: 'Begin Message Delay (Milliseconds)',
			name: 'beginMessageDelayMs',
			type: 'number',
			typeOptions: { minValue: 0, maxValue: 5000 },
			default: 0,
			description: 'Silence before the first sentence, from 0 to 5,000 milliseconds',
		},
		{
			displayName: 'Boosted Keywords',
			name: 'boostedKeywords',
			type: 'string',
			default: '',
			placeholder: 'e.g. Acme, Solaris, Gutiérrez',
			description:
				'Comma-separated words the speech recognition should favor, such as brand or product names. Replaces the current list.',
		},
		{
			displayName: 'Conversation Purpose',
			name: 'conversationPurpose',
			type: 'string',
			default: '',
			description: 'Goal of the conversations of this agent',
		},
		{
			displayName: 'Interruption Sensitivity',
			name: 'interruptionSensitivity',
			type: 'number',
			typeOptions: { minValue: 0.1, maxValue: 1, numberPrecision: 1 },
			default: 1,
			description: 'How easily the person can interrupt the agent (0.1 to 1)',
		},
		{
			displayName: 'Language',
			name: 'language',
			type: 'options',
			options: LANGUAGE_OPTIONS,
			default: 'es-419',
			description: 'Language the agent speaks and understands',
		},
		{
			displayName: 'Max Call Duration (Minutes)',
			name: 'maxCallDurationMinutes',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 10,
			description: 'Longest a call can last, subject to your plan limits',
		},
		{
			displayName: 'Person Name',
			name: 'personName',
			type: 'string',
			default: '',
			placeholder: 'e.g. Ana',
			description: 'Name the agent uses on the call',
		},
		{
			displayName: 'Post-Call Analysis Fields (JSON)',
			name: 'postCallAnalysisData',
			type: 'json',
			default: '[]',
			description:
				'Data to extract after each call, as a JSON array of { "type": "string" | "enum" | "boolean" | "number", "name", "description" }. Enum fields need "choices". Replaces the current list.',
		},
		{
			displayName: 'Prompt',
			name: 'prompt',
			type: 'string',
			typeOptions: { rows: 6 },
			default: '',
			description:
				'Instructions for the agent, up to 28,000 characters. Write {{variable}} for values sent with each call.',
		},
		{
			displayName: 'Responsiveness',
			name: 'responsiveness',
			type: 'number',
			typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 1 },
			default: 1,
			description: 'How quickly the agent answers (0 to 1)',
		},
		{
			displayName: 'Tools (JSON)',
			name: 'tools',
			type: 'json',
			default: '[]',
			description:
				'Tools the agent can use during calls (end_call, transfer_call, custom, booking, agent_swap), as a JSON array. Replaces the current list: read the agent first and send every tool it should keep.',
		},
		{
			displayName: 'Voice Model',
			name: 'voiceModel',
			type: 'options',
			options: [
				{ name: 'ElevenLabs Flash V2.5', value: 'eleven_flash_v2_5' },
				{ name: 'ElevenLabs Multilingual V2', value: 'eleven_multilingual_v2' },
			],
			default: 'eleven_flash_v2_5',
			description: 'Speech synthesis model',
		},
		{
			displayName: 'Voice Speed',
			name: 'voiceSpeed',
			type: 'number',
			typeOptions: { minValue: 0.5, maxValue: 2, numberPrecision: 1 },
			default: 1,
			description: 'Speed of the voice (0.5 to 2)',
		},
		{
			displayName: 'Voice Temperature',
			name: 'voiceTemperature',
			type: 'number',
			typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 1 },
			default: 1,
			description: 'Variation of the voice (0 to 2). Lower is more stable.',
		},
		{
			displayName: 'Volume',
			name: 'volume',
			type: 'number',
			typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 1 },
			default: 1,
			description: 'Volume of the voice (0 to 2)',
		},
		{
			displayName: 'Webhook URL',
			name: 'webhookUrl',
			type: 'string',
			default: '',
			placeholder: 'e.g. https://n8n.example.com/webhook/0f1e2d3c/webhook',
			description:
				'Post-call URL that receives the results of every call of this agent, such as the Production URL of a ContactShip Trigger node',
		},
	];

	if (kind === 'update') {
		options.push(
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Internal name of the agent, only shown in ContactShip',
			},
			{
				displayName: 'Start Speaker',
				name: 'startSpeaker',
				type: 'options',
				options: [
					{ name: 'Agent', value: 'agent', description: 'The agent says the begin message' },
					{ name: 'User', value: 'user', description: 'The agent waits for the person to speak' },
				],
				default: 'agent',
				description: 'Who talks first on the call',
			},
			{
				displayName: 'Time Zone',
				name: 'timezone',
				type: 'string',
				default: '',
				placeholder: 'e.g. America/Mexico_City',
				description: 'IANA time zone of the agent',
			},
			{
				displayName: 'Voice Name or ID',
				name: 'voiceId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getVoices' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
		);
	}

	return options.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * The "Configuration" switch, the field collection and the JSON field used by
 * Create, Update and Update Draft.
 */
export function agentConfigFields(
	resource: string,
	operation: string,
	kind: 'create' | 'update',
): INodeProperties[] {
	const show = { resource: [resource], operation: [operation] };
	return [
		{
			displayName: 'Configuration',
			name: 'configMode',
			type: 'options',
			noDataExpression: true,
			options: [
				{
					name: 'Define Below',
					value: 'define',
					description: 'Set each field of the agent',
				},
				{
					name: 'Using JSON',
					value: 'json',
					description: 'Send the agent fields as a JSON object, with the API field names',
				},
			],
			default: 'define',
			displayOptions: { show },
		},
		{
			displayName: kind === 'create' ? 'Additional Fields' : 'Update Fields',
			name: kind === 'create' ? 'additionalFields' : 'updateFields',
			type: 'collection',
			placeholder: 'Add Field',
			default: {},
			displayOptions: { show: { ...show, configMode: ['define'] } },
			options: configOptions(kind),
		},
		{
			displayName: 'Agent Fields (JSON)',
			name: 'configJson',
			type: 'json',
			default: '{\n  "prompt": ""\n}',
			description:
				'Agent fields as a JSON object, for example {"prompt": "...", "voice_speed": 1.1}. See the ContactShip API reference for every field.',
			displayOptions: { show: { ...show, configMode: ['json'] } },
		},
	];
}

const CONFIG_FIELD_MAP: Record<string, string> = {
	agentTag: 'agent_tag',
	ambientSoundVolume: 'ambient_sound_volume',
	beginMessage: 'begin_message',
	beginMessageDelayMs: 'begin_message_delay_ms',
	conversationPurpose: 'conversation_purpose',
	interruptionSensitivity: 'interruption_sensitivity',
	language: 'language',
	name: 'name',
	personName: 'person_name',
	prompt: 'prompt',
	responsiveness: 'responsiveness',
	startSpeaker: 'start_speaker',
	timezone: 'timezone',
	voiceId: 'voice_id',
	voiceModel: 'voice_model',
	voiceSpeed: 'voice_speed',
	voiceTemperature: 'voice_temperature',
	volume: 'volume',
	webhookUrl: 'webhook_url',
};

function parseJsonList(
	this: IExecuteFunctions,
	value: unknown,
	label: string,
	itemIndex: number,
): IDataObject[] | undefined {
	const parsed = parseJsonParameter.call(this, value, label, itemIndex);
	if (parsed === undefined) return undefined;
	if (!Array.isArray(parsed)) {
		throw new NodeOperationError(this.getNode(), `'${label}' must be a JSON array`, {
			description: 'Enter a list such as [{"type": "end_call", "description": "..."}].',
			itemIndex,
		});
	}
	return parsed;
}

/** Turns the field collection into the body of POST, PUT or PATCH agent requests. */
function buildAgentConfig(
	this: IExecuteFunctions,
	fields: IDataObject,
	itemIndex: number,
): IDataObject {
	const body: IDataObject = {};
	for (const [parameter, apiField] of Object.entries(CONFIG_FIELD_MAP)) {
		const value = fields[parameter];
		if (value === undefined || value === '') continue;
		body[apiField] = typeof value === 'string' ? value.trim() : value;
	}
	if (fields.ambientSound !== undefined) {
		body.ambient_sound = fields.ambientSound === 'none' ? null : fields.ambientSound;
	}
	if (fields.maxCallDurationMinutes !== undefined) {
		body.max_call_duration_ms = Math.round(Number(fields.maxCallDurationMinutes) * 60_000);
	}
	if (fields.boostedKeywords !== undefined) {
		body.boosted_keywords = splitList(fields.boostedKeywords);
	}
	const tools = parseJsonList.call(this, fields.tools, 'Tools (JSON)', itemIndex);
	if (tools) body.tools = tools;
	const analysis = parseJsonList.call(
		this,
		fields.postCallAnalysisData,
		'Post-Call Analysis Fields (JSON)',
		itemIndex,
	);
	if (analysis) body.post_call_analysis_data = analysis;
	return body;
}

/** Reads the agent configuration of Create, Update or Update Draft. */
export function readAgentConfig(
	this: IExecuteFunctions,
	itemIndex: number,
	collectionName: 'additionalFields' | 'updateFields',
): IDataObject {
	const mode = this.getNodeParameter('configMode', itemIndex, 'define') as string;
	if (mode === 'json') {
		const parsed = parseJsonParameter.call(
			this,
			this.getNodeParameter('configJson', itemIndex, '{}'),
			'Agent Fields (JSON)',
			itemIndex,
		);
		if (parsed === undefined) return {};
		if (Array.isArray(parsed)) {
			throw new NodeOperationError(this.getNode(), "'Agent Fields (JSON)' must be a JSON object", {
				description: 'Enter an object such as {"prompt": "..."}, not an array.',
				itemIndex,
			});
		}
		return parsed;
	}
	const fields = this.getNodeParameter(collectionName, itemIndex, {}) as IDataObject;
	return buildAgentConfig.call(this, fields, itemIndex);
}

export function assertSomethingToUpdate(
	this: IExecuteFunctions,
	body: IDataObject,
	itemIndex: number,
): void {
	if (Object.keys(body).length) return;
	throw new NodeOperationError(this.getNode(), 'There is nothing to update', {
		description: "Add at least one field in 'Update Fields', or switch 'Configuration' to JSON.",
		itemIndex,
	});
}

export const agentOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a voice agent. Its first version is published right away.',
				action: 'Create agent',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a voice agent permanently',
				action: 'Delete agent',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve the published configuration of a voice agent',
				action: 'Get agent',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve a list of voice agents',
				action: 'Get many agents',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Change a voice agent and publish the change right away',
				action: 'Update agent',
			},
		],
		default: 'getAll',
	},
];

export const agentFields: INodeProperties[] = [
	agentLocator(RESOURCE, ['delete', 'get', 'update']),
	simplifyField(RESOURCE, ['get', 'getAll']),

	// Create
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Showroom assistant',
		description: 'Internal name of the agent, only shown in ContactShip',
		displayOptions: { show: { resource: [RESOURCE], operation: ['create'] } },
	},
	voiceLocator(RESOURCE, ['create']),
	{
		displayName: 'Time Zone',
		name: 'timezone',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. America/Mexico_City',
		description: 'IANA time zone of the agent, used for dates and schedules in its calls',
		displayOptions: { show: { resource: [RESOURCE], operation: ['create'] } },
	},
	{
		displayName:
			'Creating an agent publishes its first version right away. Write the prompt before you connect a phone number or a campaign to it.',
		name: 'createNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RESOURCE], operation: ['create'] } },
	},
	...agentConfigFields(RESOURCE, 'create', 'create'),

	// Update
	{
		displayName:
			'Updating an agent publishes the change right away, and it applies to new calls. If someone has a draft of the agent open in ContactShip, the draft stays open but is based on the previous version. To stage changes for review, use Agent Version → Update Draft and then Publish.',
		name: 'publishNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RESOURCE], operation: ['update'] } },
	},
	...agentConfigFields(RESOURCE, 'update', 'update'),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['update'] } },
		options: [
			{
				displayName: 'Stop If a Draft Is Open',
				name: 'stopIfDraftOpen',
				type: 'boolean',
				default: false,
				description:
					'Whether to stop with an error, instead of publishing, when someone has a draft of the agent open in ContactShip',
			},
		],
	},
];

export const executeAgent: ResourceHandler = async function (this, operation, i) {
	if (operation === 'getAll') {
		const simplify = this.getNodeParameter('simplify', i, true) as boolean;
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			'/v1/agents',
			undefined,
			undefined,
			i,
		);
		const data = unwrap(response);
		const agents = (Array.isArray(data) ? data : data ? [data] : []) as IDataObject[];
		return toExecutionData.call(this, simplify ? agents.map(simplifyAgent) : agents, i);
	}

	if (operation === 'create') {
		const config = readAgentConfig.call(this, i, 'additionalFields');
		const body: IDataObject = {
			// Listed as required in the OpenAPI schema; 1 is also the default in ContactShip.
			responsiveness: 1,
			ambient_sound_volume: 1,
			...config,
			name: (this.getNodeParameter('name', i) as string).trim(),
			voice_id: getIdParameter.call(this, 'voiceId', i, 'Voice'),
			timezone: (this.getNodeParameter('timezone', i) as string).trim(),
		};
		const response = await contactShipApiRequest.call(
			this,
			'POST',
			'/v1/agents',
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	const agentId = encodeURIComponent(getIdParameter.call(this, 'agentId', i, 'Agent'));

	if (operation === 'get') {
		const simplify = this.getNodeParameter('simplify', i, true) as boolean;
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`/v1/agents/${agentId}`,
			undefined,
			undefined,
			i,
		);
		const agent = unwrap(response) as IDataObject;
		return toExecutionData.call(this, simplify ? simplifyAgent(agent) : agent, i);
	}

	if (operation === 'update') {
		const body = readAgentConfig.call(this, i, 'updateFields');
		assertSomethingToUpdate.call(this, body, i);
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		if (options.stopIfDraftOpen === true) {
			const response = await contactShipApiRequest.call(
				this,
				'GET',
				`/v1/agents/${agentId}/versions/draft`,
				undefined,
				undefined,
				i,
			);
			const draft = unwrap(response) as IDataObject | null;
			if (draft && typeof draft === 'object' && draft.id) {
				throw new NodeOperationError(
					this.getNode(),
					`The agent has a draft open (version ${String(draft.version_number ?? '?')}), so the change was not published`,
					{
						description:
							'Use Agent Version → Update Draft and Publish to keep the work in the draft, or turn off "Stop If a Draft Is Open".',
						itemIndex: i,
					},
				);
			}
		}
		const response = await contactShipApiRequest.call(
			this,
			'PUT',
			`/v1/agents/${agentId}`,
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'delete') {
		await contactShipApiRequest.call(
			this,
			'DELETE',
			`/v1/agents/${agentId}`,
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, { deleted: true }, i);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for agents`,
		{
			itemIndex: i,
		},
	);
};
