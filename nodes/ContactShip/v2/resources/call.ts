import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest, contactShipApiRequestAllItems } from '../../shared/transport';
import {
	formatScheduleTime,
	getIdParameter,
	normalizePhoneNumber,
	parseJsonParameter,
	simplifyCall,
	toExecutionData,
	toKeyValueList,
	unwrap,
} from '../../shared/utils';
import type { ResourceHandler } from './common';
import {
	agentLocator,
	contactIdField,
	getMappedValues,
	limitField,
	resolveContactId,
	returnAllField,
	simplifyField,
	sortField,
} from './common';

const RESOURCE = 'call';

const callIdField: INodeProperties = {
	displayName: 'Call ID',
	name: 'callId',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890',
	description: "ID of the call, as returned in 'call_id' when the call was created",
	displayOptions: {
		show: { resource: [RESOURCE], operation: ['cancel', 'get', 'getStatus', 'stop'] },
	},
};

const variablesOption: INodeProperties = {
	displayName: 'Extra Variables',
	name: 'variables',
	type: 'fixedCollection',
	placeholder: 'Add Variable',
	default: {},
	typeOptions: { multipleValues: true },
	description:
		"Other context passed to the agent for this call, such as an account balance or a product name. It overrides a variable of the same name in 'Agent Variables'.",
	options: [
		{
			displayName: 'Variable',
			name: 'variable',
			values: [
				{
					displayName: 'Key',
					name: 'key',
					type: 'string',
					default: '',
					placeholder: 'e.g. amount_due',
				},
				{
					displayName: 'Value',
					name: 'value',
					type: 'string',
					default: '',
					placeholder: 'e.g. 120.50',
				},
			],
		},
	],
};

const variablesJsonOption: INodeProperties = {
	displayName: 'Extra Variables (JSON)',
	name: 'variablesJson',
	type: 'json',
	default: '{}',
	description:
		'More variables as a JSON object of names and values, for example {"amount_due": "120.50"}. It overrides variables with the same name.',
};

const agentVariablesField: INodeProperties = {
	displayName: 'Agent Variables',
	name: 'agentVariables',
	type: 'resourceMapper',
	noDataExpression: true,
	default: { mappingMode: 'defineBelow', value: null },
	description: 'Values for the {{variables}} in the prompt of the agent, sent with this call',
	typeOptions: {
		loadOptionsDependsOn: ['agentId.value'],
		resourceMapper: {
			resourceMapperMethod: 'getAgentVariables',
			mode: 'add',
			fieldWords: { singular: 'variable', plural: 'variables' },
			addAllFields: true,
			multiKeyMatch: false,
			supportAutoMap: false,
			noFieldsError:
				"This agent's prompt has no {{variables}} to fill. Add any extra context in 'Additional Fields → Extra Variables'.",
		},
	},
	displayOptions: { show: { resource: [RESOURCE], operation: ['makeCall', 'callContact'] } },
};

const metadataOption: INodeProperties = {
	displayName: 'Metadata (JSON)',
	name: 'metadata',
	type: 'json',
	default: '{}',
	description: 'Your own data to attach to the call for tracking, as a JSON object',
};

const scheduleOption: INodeProperties = {
	displayName: 'Schedule',
	name: 'schedule',
	type: 'fixedCollection',
	placeholder: 'Add Schedule',
	default: {},
	description: 'Place the call at a specific date and time instead of right away',
	options: [
		{
			displayName: 'Schedule',
			name: 'values',
			values: [
				{
					displayName: 'Date and Time',
					name: 'dateTime',
					type: 'dateTime',
					default: '',
					description:
						'When to place the call. A date without a time zone offset is read in the time zone below.',
				},
				{
					displayName: 'Time Zone',
					name: 'timeZone',
					type: 'string',
					default: '',
					placeholder: 'e.g. America/Mexico_City',
					description: 'IANA time zone of the date. Leave empty to use the workflow time zone.',
				},
			],
		},
	],
};

const includeToolsOption: INodeProperties = {
	displayName: 'Include Tool Calls',
	name: 'includeTools',
	type: 'boolean',
	default: false,
	description: 'Whether to include the transcript with the tool calls the agent made',
};

const includeWordsOption: INodeProperties = {
	displayName: 'Include Word Timing',
	name: 'includeWords',
	type: 'boolean',
	default: false,
	description: 'Whether to include per-word timing in the transcript',
};

const transcriptFormatOption: INodeProperties = {
	displayName: 'Transcript Format',
	name: 'transcriptFormat',
	type: 'options',
	options: [
		{ name: 'JSON', value: 'json' },
		{
			name: 'TOON',
			value: 'toon',
			description: 'Compact text encoding that uses fewer tokens when passed to an AI model',
		},
	],
	default: 'json',
};

export const callOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Call Contact',
				value: 'callContact',
				description: 'Call an existing contact with an AI voice agent',
				action: 'Make AI phone call to contact',
			},
			{
				name: 'Cancel Scheduled Call',
				value: 'cancel',
				description: 'Cancel a scheduled call before it is placed',
				action: 'Cancel scheduled call',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve a call with its analysis and transcript',
				action: 'Get call',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve a list of calls',
				action: 'Get many calls',
			},
			{
				name: 'Get Status',
				value: 'getStatus',
				description: 'Check whether a call is ringing, in progress or finished',
				action: 'Get call status',
			},
			{
				name: 'Make Phone Call',
				value: 'makeCall',
				description: 'Call a phone number with an AI voice agent',
				action: 'Make AI phone call',
			},
			{
				name: 'Stop',
				value: 'stop',
				description: 'Hang up a call that is ringing or in progress',
				action: 'Stop call',
			},
		],
		default: 'makeCall',
	},
];

export const callFields: INodeProperties[] = [
	// Make Phone Call and Call Contact
	agentLocator(RESOURCE, ['makeCall', 'callContact']),
	{
		displayName: 'From Number',
		name: 'fromNumber',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		description: 'Phone number of your organization that places the call',
		displayOptions: { show: { resource: [RESOURCE], operation: ['makeCall'] } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchPhoneNumbers', searchable: true },
			},
			{
				displayName: 'Phone Number',
				name: 'phoneNumber',
				type: 'string',
				placeholder: 'e.g. +12125551234',
			},
		],
	},
	{
		displayName: 'From Number',
		name: 'fromNumberId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		description: 'Phone number of your organization that places the call',
		displayOptions: { show: { resource: [RESOURCE], operation: ['callContact'] } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchPhoneNumberIds', searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 8d7c6b5a-4e3f-4a2b-9c1d-0e9f8a7b6c5d',
			},
		],
	},
	{
		displayName: 'To Number',
		name: 'toNumber',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. +12125551234',
		description: 'Phone number to call, in international format',
		displayOptions: { show: { resource: [RESOURCE], operation: ['makeCall'] } },
	},
	{
		displayName: 'Full Name',
		name: 'fullName',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Nathan Smith',
		description: 'Name of the person to call. The agent uses it in the conversation.',
		displayOptions: { show: { resource: [RESOURCE], operation: ['makeCall'] } },
	},
	contactIdField(
		RESOURCE,
		['callContact'],
		'The contact to call. Their phone number and profile are used.',
	),
	agentVariablesField,
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['makeCall'] } },
		options: [
			{
				displayName: 'Country',
				name: 'country',
				type: 'string',
				default: '',
				placeholder: 'e.g. Mexico',
				description: 'Country of the person to call, passed to the agent as context',
			},
			{
				displayName: 'Delay (Minutes)',
				name: 'delay',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description: 'Minutes to wait before placing the call',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'e.g. nathan@example.com',
				default: '',
				description: 'Email of the person to call, passed to the agent as context',
			},
			variablesOption,
			variablesJsonOption,
			metadataOption,
			scheduleOption,
			{
				displayName: 'Update Existing Contact',
				name: 'shouldUpdate',
				type: 'boolean',
				default: false,
				description:
					'Whether to update the contact that already has this phone number with the name, email and country sent here',
			},
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://n8n.example.com/webhook/0f1e2d3c/webhook',
				description:
					'URL that receives the results of this call. Paste the Production URL of a ContactShip Trigger node to handle them in n8n.',
			},
		],
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['callContact'] } },
		options: [variablesOption, variablesJsonOption, metadataOption, scheduleOption],
	},

	// Get, Get Status, Stop, Cancel
	callIdField,

	// Get Many
	returnAllField(RESOURCE, 'getAll'),
	limitField(RESOURCE, 'getAll'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Agent Name or ID',
				name: 'agentId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAgents' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Call Result',
				name: 'callResult',
				type: 'options',
				options: [
					{ name: 'Answered', value: 'answered' },
					{ name: 'Busy', value: 'busy' },
					{ name: 'Failed', value: 'failed' },
					{ name: 'No Answer', value: 'no_answer' },
					{ name: 'Voicemail', value: 'voicemail' },
				],
				default: 'answered',
			},
			{
				displayName: 'Call Status',
				name: 'callStatus',
				type: 'options',
				options: [
					{ name: 'Answering Machine', value: 'answering-machine' },
					{ name: 'Busy', value: 'busy' },
					{ name: 'Completed', value: 'completed' },
					{ name: 'Failed', value: 'failed' },
					{ name: 'In Progress', value: 'in-progress' },
					{ name: 'In Queue', value: 'in-queue' },
					{ name: 'Incomplete', value: 'incomplete' },
					{ name: 'No Answer', value: 'no-answer' },
					{ name: 'Scheduled', value: 'scheduled' },
					{ name: 'Voicemail', value: 'voice_mail' },
				],
				default: 'completed',
			},
			{
				displayName: 'Campaign ID',
				name: 'campaignId',
				type: 'string',
				default: '',
			},
			{
				displayName: 'Created After',
				name: 'dateFrom',
				type: 'dateTime',
				default: '',
				description: 'Only calls created on or after this date',
			},
			{
				displayName: 'Created Before',
				name: 'dateTo',
				type: 'dateTime',
				default: '',
				description: 'Only calls created on or before this date',
			},
			{
				displayName: 'Phone Number',
				name: 'phoneNumber',
				type: 'string',
				default: '',
				placeholder: 'e.g. +12125551234',
				description: 'Only calls with this phone number',
			},
		],
	},

	// Get and Get Many
	simplifyField(RESOURCE, ['get', 'getAll']),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['get'], simplify: [false] } },
		options: [
			includeToolsOption,
			{
				displayName: 'Include Transcript',
				name: 'includeTranscript',
				type: 'boolean',
				default: true,
				description: 'Whether to include the transcript of the call',
			},
			includeWordsOption,
			transcriptFormatOption,
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['getAll'], simplify: [false] } },
		options: [
			includeToolsOption,
			{
				displayName: 'Include Transcript',
				name: 'includeTranscript',
				type: 'boolean',
				default: false,
				description: 'Whether to include the transcript of each call',
			},
			includeWordsOption,
			transcriptFormatOption,
		],
	},
	sortField(RESOURCE, 'getAll'),
];

function transcriptQuery(options: IDataObject, includeByDefault: boolean): IDataObject {
	const includeTranscript = (options.includeTranscript as boolean | undefined) ?? includeByDefault;
	const qs: IDataObject = { include_transcript: includeTranscript };
	if (options.includeTools) qs.include_tools = true;
	if (options.includeWords) qs.include_words = true;
	if (options.transcriptFormat && options.transcriptFormat !== 'json') {
		qs.transcript_format = options.transcriptFormat;
	}
	return qs;
}

function readSchedule(
	this: IExecuteFunctions,
	additionalFields: IDataObject,
	itemIndex: number,
): IDataObject | undefined {
	const schedule = (additionalFields.schedule as IDataObject | undefined)?.values as
		| IDataObject
		| undefined;
	if (!schedule?.dateTime) return undefined;
	const timeZone = String(schedule.timeZone || '').trim() || this.getTimezone();
	return {
		scheduled_call_time: formatScheduleTime.call(
			this,
			String(schedule.dateTime),
			timeZone,
			itemIndex,
		),
		timezone: timeZone,
	};
}

function applyCommonCallFields(
	this: IExecuteFunctions,
	body: IDataObject,
	additionalFields: IDataObject,
	itemIndex: number,
): void {
	// Agent Variables, then Extra Variables, then the JSON: a later value replaces an earlier one.
	const variables = new Map<string, string>();
	const { values } = getMappedValues.call(this, 'agentVariables', itemIndex);
	for (const [key, value] of Object.entries(values)) variables.set(key, String(value));
	for (const { key, value } of toKeyValueList(
		additionalFields.variables as IDataObject | undefined,
		'variable',
	)) {
		variables.set(key, value);
	}
	const extra = parseJsonParameter.call(
		this,
		additionalFields.variablesJson,
		'Extra Variables (JSON)',
		itemIndex,
	);
	if (Array.isArray(extra)) {
		throw new NodeOperationError(this.getNode(), "'Extra Variables (JSON)' must be a JSON object", {
			description: 'Enter an object such as {"amount_due": "120.50"}, not an array.',
			itemIndex,
		});
	}
	for (const [key, value] of Object.entries(extra ?? {})) {
		if (!key.trim() || value === undefined || value === null) continue;
		variables.set(key.trim(), typeof value === 'object' ? JSON.stringify(value) : String(value));
	}
	if (variables.size) {
		body.additional_data = [...variables].map(([key, value]) => ({ key, value }));
	}

	const metadata = parseJsonParameter.call(
		this,
		additionalFields.metadata,
		'Metadata (JSON)',
		itemIndex,
	);
	if (metadata && !Array.isArray(metadata) && Object.keys(metadata).length)
		body.metadata = metadata;
	if (Array.isArray(metadata)) {
		throw new NodeOperationError(this.getNode(), "'Metadata (JSON)' must be a JSON object", {
			description: 'Enter an object such as {"order_id": "10025"}, not an array.',
			itemIndex,
		});
	}

	const schedule = readSchedule.call(this, additionalFields, itemIndex);
	if (schedule) body.schedule = schedule;
}

export const executeCall: ResourceHandler = async function (this, operation, i) {
	if (operation === 'makeCall') {
		const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const body: IDataObject = {
			agent_id: getIdParameter.call(this, 'agentId', i, 'Agent'),
			from_number: normalizePhoneNumber.call(
				this,
				getIdParameter.call(this, 'fromNumber', i, 'From Number'),
				'From Number',
				i,
			),
			to_number: normalizePhoneNumber.call(
				this,
				this.getNodeParameter('toNumber', i) as string,
				'To Number',
				i,
			),
			full_name: (this.getNodeParameter('fullName', i) as string).trim(),
		};
		if (additionalFields.country) body.country = additionalFields.country;
		if (additionalFields.email) body.email = additionalFields.email;
		if (additionalFields.delay) body.delay = Number(additionalFields.delay);
		if (additionalFields.webhookUrl) body.webhook_url = String(additionalFields.webhookUrl).trim();
		// Listed as required in the OpenAPI schema; send it explicitly (false unless the user opts in).
		body.should_update = additionalFields.shouldUpdate === true;
		applyCommonCallFields.call(this, body, additionalFields, i);

		const response = await contactShipApiRequest.call(
			this,
			'POST',
			'/v1/calls/single-phone-call',
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'callContact') {
		const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const body: IDataObject = {
			contact_id: await resolveContactId.call(this, i),
			agent_id: getIdParameter.call(this, 'agentId', i, 'Agent'),
			from_number_id: getIdParameter.call(this, 'fromNumberId', i, 'From Number'),
		};
		applyCommonCallFields.call(this, body, additionalFields, i);

		const response = await contactShipApiRequest.call(
			this,
			'POST',
			'/v1/calls/single-contact-call',
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'get') {
		const callId = encodeURIComponent((this.getNodeParameter('callId', i) as string).trim());
		const simplify = this.getNodeParameter('simplify', i, true) as boolean;
		const options = simplify ? {} : (this.getNodeParameter('options', i, {}) as IDataObject);
		const qs = simplify ? { include_transcript: false } : transcriptQuery(options, true);
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`/v1/calls/${callId}`,
			undefined,
			qs,
			i,
		);
		const call = unwrap(response) as IDataObject;
		return toExecutionData.call(this, simplify ? simplifyCall(call) : call, i);
	}

	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const sort = this.getNodeParameter('sort', i, {}) as IDataObject;
		const simplify = this.getNodeParameter('simplify', i, true) as boolean;
		const options = simplify ? {} : (this.getNodeParameter('options', i, {}) as IDataObject);

		const qs: IDataObject = {
			order: sort.order ?? 'desc',
			agent_id: filters.agentId,
			call_result: filters.callResult,
			call_status: filters.callStatus,
			campaign_id: filters.campaignId,
			date_from: filters.dateFrom,
			date_to: filters.dateTo,
			phoneNumber: filters.phoneNumber,
			...(simplify ? { include_transcript: false } : transcriptQuery(options, false)),
		};

		const calls = await contactShipApiRequestAllItems.call(this, '/v1/calls', qs, {
			returnAll,
			limit,
			pageSize: 1000,
			itemIndex: i,
		});
		return toExecutionData.call(this, simplify ? calls.map(simplifyCall) : calls, i);
	}

	if (operation === 'getStatus') {
		const callId = encodeURIComponent((this.getNodeParameter('callId', i) as string).trim());
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`/v1/calls/${callId}/status`,
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'stop' || operation === 'cancel') {
		const callId = encodeURIComponent((this.getNodeParameter('callId', i) as string).trim());
		const response = await contactShipApiRequest.call(
			this,
			'POST',
			`/v1/calls/single-phone-call/${callId}/${operation}`,
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for calls`,
		{
			itemIndex: i,
		},
	);
};
