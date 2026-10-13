import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest } from '../../shared/transport';
import { getIdParameter, parseJsonParameter, toExecutionData, unwrap } from '../../shared/utils';
import {
	buildTemplateComponents,
	fetchChannelTemplates,
	findTemplate,
	parseTemplateValue,
} from '../../shared/whatsappTemplates';
import type { ExecutionCache, ResourceHandler } from './common';
import {
	contactIdField,
	getMappedValues,
	limitField,
	resolveContactId,
	returnAllField,
} from './common';

const RESOURCE = 'whatsapp';
const SEND_OPERATIONS = ['sendMedia', 'sendMessage', 'sendTemplate', 'sendVoice'];
const FILE_OPERATIONS = ['sendMedia', 'sendVoice'];

const saveMessageOption: INodeProperties = {
	displayName: 'Save to Conversation',
	name: 'saveMessage',
	type: 'boolean',
	default: true,
	description: 'Whether to store the message in the conversation of the contact in ContactShip',
};

const threadIdOption: INodeProperties = {
	displayName: 'Conversation ID',
	name: 'threadId',
	type: 'string',
	default: '',
	description: 'ID of an existing conversation (thread) to send the message in',
};

export const whatsappOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Get Many Templates',
				value: 'getTemplates',
				description: 'Retrieve the approved message templates of a WhatsApp channel',
				action: 'Get many templates',
			},
			{
				name: 'Send Media',
				value: 'sendMedia',
				description: 'Send an image, video, audio or document',
				action: 'Send media',
			},
			{
				name: 'Send Message',
				value: 'sendMessage',
				description: 'Send a text message inside the 24-hour customer service window',
				action: 'Send message',
			},
			{
				name: 'Send Template',
				value: 'sendTemplate',
				description: 'Send an approved template, required to start or reopen a conversation',
				action: 'Send template',
			},
			{
				name: 'Send Voice Note',
				value: 'sendVoice',
				description: 'Send an audio file as a voice note',
				action: 'Send voice note',
			},
		],
		default: 'sendTemplate',
	},
];

export const whatsappFields: INodeProperties[] = [
	{
		displayName: 'Channel',
		name: 'channelId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		description: 'WhatsApp Business channel that sends the message',
		displayOptions: {
			show: { resource: [RESOURCE], operation: [...SEND_OPERATIONS, 'getTemplates'] },
		},
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchWhatsAppChannels', searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. chn_y0xspd9p1v7vla6wkwc2z01u',
			},
		],
	},
	contactIdField(RESOURCE, SEND_OPERATIONS, 'The contact to message. It needs a WhatsApp number.'),

	// Send Message
	{
		displayName: 'Message',
		name: 'content',
		type: 'string',
		required: true,
		typeOptions: { rows: 4 },
		default: '',
		displayOptions: { show: { resource: [RESOURCE], operation: ['sendMessage'] } },
	},

	// Send Template
	{
		displayName: 'Template Name or ID',
		name: 'templateName',
		type: 'options',
		required: true,
		typeOptions: {
			loadOptionsMethod: 'getWhatsAppTemplates',
			loadOptionsDependsOn: ['channelId.value'],
		},
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'The list shows approved templates as name (language). With an expression, use the name, or name:language such as welcome:es_MX.',
		displayOptions: { show: { resource: [RESOURCE], operation: ['sendTemplate'] } },
	},
	{
		displayName: 'Variables',
		name: 'variablesMode',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Map Each Variable',
				value: 'map',
				description: 'Fill one field per variable of the template',
			},
			{
				name: 'Using JSON',
				value: 'json',
				description: 'Send the components in the Meta Cloud API format',
			},
		],
		default: 'map',
		displayOptions: { show: { resource: [RESOURCE], operation: ['sendTemplate'] } },
	},
	{
		displayName: 'Template Variables',
		name: 'templateVariables',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		typeOptions: {
			loadOptionsDependsOn: ['channelId.value', 'templateName'],
			resourceMapper: {
				resourceMapperMethod: 'getTemplateFields',
				mode: 'add',
				valuesLabel: 'Template Variables',
				fieldWords: { singular: 'variable', plural: 'variables' },
				addAllFields: true,
				multiKeyMatch: false,
				supportAutoMap: false,
				noFieldsError: 'This template has no variables. It is sent as it is.',
			},
		},
		displayOptions: {
			show: { resource: [RESOURCE], operation: ['sendTemplate'], variablesMode: ['map'] },
		},
	},
	{
		displayName: 'Components (JSON)',
		name: 'componentsJson',
		type: 'json',
		default:
			'[\n  {\n    "type": "BODY",\n    "parameters": [{ "type": "text", "text": "Nathan" }]\n  }\n]',
		description:
			'Header, body and button parameters as a JSON array in the Meta Cloud API format. Add "parameter_name" for named variables such as {{first_name}}.',
		displayOptions: {
			show: { resource: [RESOURCE], operation: ['sendTemplate'], variablesMode: ['json'] },
		},
	},

	// Send Media
	{
		displayName: 'Media Type',
		name: 'mediaType',
		type: 'options',
		options: [
			{ name: 'Audio', value: 'audio' },
			{ name: 'Document', value: 'document' },
			{ name: 'Image', value: 'image' },
			{ name: 'Video', value: 'video' },
		],
		default: 'image',
		displayOptions: { show: { resource: [RESOURCE], operation: ['sendMedia'] } },
	},
	{
		displayName: 'File Source',
		name: 'mediaSource',
		type: 'options',
		options: [
			{ name: 'Public URL', value: 'url' },
			{ name: 'Binary File', value: 'binary', description: 'A file from a previous node' },
		],
		default: 'url',
		displayOptions: { show: { resource: [RESOURCE], operation: FILE_OPERATIONS } },
	},
	{
		displayName: 'File URL',
		name: 'mediaUrl',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://example.com/image.png',
		description: 'Publicly accessible URL of the file',
		displayOptions: {
			show: { resource: [RESOURCE], operation: FILE_OPERATIONS, mediaSource: ['url'] },
		},
	},
	{
		displayName: 'Input Data Field Name',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		description: 'Name of the input field that holds the file',
		displayOptions: {
			show: { resource: [RESOURCE], operation: FILE_OPERATIONS, mediaSource: ['binary'] },
		},
	},

	// Options for send operations
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['sendMessage'] } },
		options: [threadIdOption],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['sendTemplate'] } },
		options: [
			threadIdOption,
			{
				displayName: 'Language Code',
				name: 'languageCode',
				type: 'string',
				default: '',
				placeholder: 'e.g. es_MX',
				description:
					'Language of the template. Leave empty to use the language chosen in the list, or the only language the template has.',
			},
			saveMessageOption,
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['sendMedia'] } },
		options: [
			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				default: '',
				description: 'Text shown below the file',
			},
			threadIdOption,
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'e.g. invoice.pdf',
				description: 'Name shown for documents',
			},
			saveMessageOption,
		],
	},

	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['sendVoice'] } },
		options: [threadIdOption, saveMessageOption],
	},

	// Get Many Templates
	returnAllField(RESOURCE, 'getTemplates'),
	limitField(RESOURCE, 'getTemplates'),
];

async function getChannelTemplates(
	this: IExecuteFunctions,
	channelId: string,
	cache: ExecutionCache,
	itemIndex: number,
): Promise<IDataObject[]> {
	const cached = cache.templates.get(channelId);
	if (cached) return cached;
	const templates = await fetchChannelTemplates.call(this, channelId, {
		returnAll: true,
		itemIndex,
	});
	cache.templates.set(channelId, templates);
	return templates;
}

async function resolveTemplateLanguage(
	this: IExecuteFunctions,
	channelId: string,
	templateName: string,
	cache: ExecutionCache,
	itemIndex: number,
): Promise<string | undefined> {
	const templates = await getChannelTemplates.call(this, channelId, cache, itemIndex);
	const { template, languages } = findTemplate(templates, { name: templateName });
	if (!template && languages.length > 1) {
		throw new NodeOperationError(
			this.getNode(),
			`The template '${templateName}' exists in several languages (${languages.join(', ')})`,
			{
				description:
					"Choose the template again from the list, use name:language in the expression, or set 'Language Code' in the options.",
				itemIndex,
			},
		);
	}
	return template?.language ? String(template.language) : undefined;
}

function templateComponentsFromMapper(this: IExecuteFunctions, itemIndex: number): IDataObject[] {
	const { values, schema } = getMappedValues.call(this, 'templateVariables', itemIndex);
	const missing = schema.filter(
		(field) => field.required && !field.removed && values[field.id] === undefined,
	);
	if (missing.length) {
		throw new NodeOperationError(
			this.getNode(),
			`The template needs a value for ${missing.map((field) => `'${field.displayName}'`).join(', ')}`,
			{
				description:
					"Fill every variable in 'Template Variables'. WhatsApp rejects a template with empty variables.",
				itemIndex,
			},
		);
	}
	return buildTemplateComponents(values);
}

export const executeWhatsApp: ResourceHandler = async function (this, operation, i, cache) {
	const channelId = getIdParameter.call(this, 'channelId', i, 'Channel');

	if (operation === 'getTemplates') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
		const templates = await fetchChannelTemplates.call(this, channelId, {
			returnAll,
			limit,
			itemIndex: i,
		});
		return toExecutionData.call(this, templates, i);
	}

	const contactId = await resolveContactId.call(this, i);
	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	const body: IDataObject = { channel_id: channelId, contact_id: contactId };
	if (options.threadId) body.thread_id = String(options.threadId).trim();
	if (options.saveMessage === false) body.save_message = false;

	if (operation === 'sendMessage') {
		body.content = this.getNodeParameter('content', i) as string;
		const response = await contactShipApiRequest.call(
			this,
			'POST',
			'/v1/waba/send',
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'sendTemplate') {
		const reference = parseTemplateValue(this.getNodeParameter('templateName', i));
		if (!reference.name) {
			throw new NodeOperationError(this.getNode(), "The 'Template' parameter is empty", {
				description: 'Choose an approved template of the selected channel.',
				itemIndex: i,
			});
		}
		body.template_name = reference.name;

		const languageCode = String(options.languageCode ?? '').trim();
		const language =
			languageCode ||
			reference.language ||
			(await resolveTemplateLanguage.call(this, channelId, reference.name, cache, i));
		if (language) body.language_code = language;

		const variablesMode = this.getNodeParameter('variablesMode', i, 'map') as string;
		let components: IDataObject[] = [];
		if (variablesMode === 'json') {
			const parsed = parseJsonParameter.call(
				this,
				this.getNodeParameter('componentsJson', i, '[]'),
				'Components (JSON)',
				i,
			);
			if (parsed !== undefined && !Array.isArray(parsed)) {
				throw new NodeOperationError(this.getNode(), "'Components (JSON)' must be a JSON array", {
					description: 'Enter a list such as [{"type": "BODY", "parameters": [...]}].',
					itemIndex: i,
				});
			}
			components = parsed ?? [];
		} else {
			components = templateComponentsFromMapper.call(this, i);
		}
		if (components.length) body.components = components;

		const response = await contactShipApiRequest.call(
			this,
			'POST',
			'/v1/waba/send-template',
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'sendMedia' || operation === 'sendVoice') {
		if (operation === 'sendMedia') {
			body.media_type = this.getNodeParameter('mediaType', i) as string;
			if (options.caption) body.content = options.caption;
			if (options.fileName) body.file_name = String(options.fileName).trim();
		}
		const mediaSource = this.getNodeParameter('mediaSource', i) as string;

		if (mediaSource === 'binary') {
			const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
			const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
			const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
			body.media_data = buffer.toString('base64');
			if (operation === 'sendMedia' && !body.file_name && binaryData.fileName) {
				body.file_name = binaryData.fileName;
			}
		} else {
			body.media_data = (this.getNodeParameter('mediaUrl', i) as string).trim();
		}

		const response = await contactShipApiRequest.call(
			this,
			'POST',
			operation === 'sendMedia' ? '/v1/waba/send-media' : '/v1/waba/send-voice',
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for WhatsApp`,
		{ itemIndex: i },
	);
};
