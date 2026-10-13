import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest } from '../../shared/transport';
import { getIdParameter, simplifyAgent, toExecutionData, unwrap } from '../../shared/utils';
import type { ResourceHandler } from './common';
import { agentLocator, simplifyField } from './common';

const RESOURCE = 'agent';

export const LANGUAGE_OPTIONS = [
	{ name: 'Chinese', value: 'zh-CN' },
	{ name: 'Dutch', value: 'nl-NL' },
	{ name: 'English (India)', value: 'en-IN' },
	{ name: 'English (UK)', value: 'en-GB' },
	{ name: 'English (US)', value: 'en-US' },
	{ name: 'French', value: 'fr-FR' },
	{ name: 'German', value: 'de-DE' },
	{ name: 'Hindi', value: 'hi-IN' },
	{ name: 'Italian', value: 'it-IT' },
	{ name: 'Japanese', value: 'ja-JP' },
	{ name: 'Korean', value: 'ko-KR' },
	{ name: 'Multilingual (Spanish and English)', value: 'multi' },
	{ name: 'Polish', value: 'pl-PL' },
	{ name: 'Portuguese (Brazil)', value: 'pt-BR' },
	{ name: 'Portuguese (Portugal)', value: 'pt-PT' },
	{ name: 'Russian', value: 'ru-RU' },
	{ name: 'Spanish (Latin America)', value: 'es-419' },
	{ name: 'Spanish (Spain)', value: 'es-ES' },
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

export const agentOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
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
				description: 'Change a voice agent and publish the change',
				action: 'Update agent',
			},
		],
		default: 'getAll',
	},
];

export const agentFields: INodeProperties[] = [
	agentLocator(RESOURCE, ['get', 'update']),
	simplifyField(RESOURCE, ['get', 'getAll']),
	{
		displayName:
			'Updating an agent publishes the change right away, and it applies to new calls. Review any open draft of the agent in ContactShip first.',
		name: 'publishNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RESOURCE], operation: ['update'] } },
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['update'] } },
		options: [
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
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Internal name of the agent, only shown in ContactShip',
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
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				description: 'Instructions for the agent, up to 28,000 characters',
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
				displayName: 'Time Zone',
				name: 'timezone',
				type: 'string',
				default: '',
				placeholder: 'e.g. America/Mexico_City',
				description: 'IANA time zone of the agent',
			},
			{
				displayName: 'Voice ID',
				name: 'voiceId',
				type: 'string',
				default: '',
				description: 'ID of the voice to use. Find voice IDs in ContactShip.',
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
		],
	},
];

const UPDATE_FIELD_MAP: Record<string, string> = {
	ambientSoundVolume: 'ambient_sound_volume',
	beginMessage: 'begin_message',
	conversationPurpose: 'conversation_purpose',
	interruptionSensitivity: 'interruption_sensitivity',
	language: 'language',
	name: 'name',
	personName: 'person_name',
	prompt: 'prompt',
	responsiveness: 'responsiveness',
	timezone: 'timezone',
	voiceId: 'voice_id',
	voiceSpeed: 'voice_speed',
	voiceTemperature: 'voice_temperature',
	volume: 'volume',
	webhookUrl: 'webhook_url',
};

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
		const updateFields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
		const body: IDataObject = {};
		for (const [parameter, apiField] of Object.entries(UPDATE_FIELD_MAP)) {
			const value = updateFields[parameter];
			if (value === undefined || value === '') continue;
			body[apiField] = typeof value === 'string' ? value.trim() : value;
		}
		if (updateFields.ambientSound !== undefined) {
			body.ambient_sound = updateFields.ambientSound === 'none' ? null : updateFields.ambientSound;
		}
		if (updateFields.maxCallDurationMinutes !== undefined) {
			body.max_call_duration_ms = Math.round(Number(updateFields.maxCallDurationMinutes) * 60_000);
		}
		if (!Object.keys(body).length) {
			throw new NodeOperationError(this.getNode(), 'There is nothing to update', {
				description: "Add at least one field in 'Update Fields'.",
				itemIndex: i,
			});
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

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for agents`,
		{
			itemIndex: i,
		},
	);
};
