import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest } from '../../shared/transport';
import { getIdParameter, parseJsonParameter, toExecutionData, unwrap } from '../../shared/utils';
import type { ExecutionCache, ResourceHandler } from './common';
import { contactIdField, limitField, returnAllField } from './common';

const RESOURCE = 'whatsapp';
const SEND_OPERATIONS = ['sendMedia', 'sendMessage', 'sendTemplate'];

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
	contactIdField(
		RESOURCE,
		SEND_OPERATIONS,
		'ID of the contact to message. The contact needs a WhatsApp number.',
	),

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
		displayOptions: { show: { resource: [RESOURCE], operation: ['sendTemplate'] } },
	},
	{
		displayName: 'Body Variables',
		name: 'bodyVariables',
		type: 'fixedCollection',
		placeholder: 'Add Variable',
		default: {},
		typeOptions: { multipleValues: true, sortable: true },
		description:
			'Values for the placeholders in the template body, in order ({{1}}, {{2}}, ...). For named placeholders, also fill Name.',
		displayOptions: { show: { resource: [RESOURCE], operation: ['sendTemplate'] } },
		options: [
			{
				displayName: 'Variable',
				name: 'variable',
				values: [
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						placeholder: 'e.g. Nathan',
					},
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						placeholder: 'e.g. first_name',
						description: 'Name of the placeholder, only for templates with named placeholders',
					},
				],
			},
		],
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
		displayOptions: { show: { resource: [RESOURCE], operation: ['sendMedia'] } },
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
			show: { resource: [RESOURCE], operation: ['sendMedia'], mediaSource: ['url'] },
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
			show: { resource: [RESOURCE], operation: ['sendMedia'], mediaSource: ['binary'] },
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
			{
				displayName: 'Components (JSON)',
				name: 'components',
				type: 'json',
				default: '[]',
				description:
					"Template components in the Meta Cloud API format, for header, body and button parameters. When set, it replaces 'Body Variables'.",
			},
			threadIdOption,
			{
				displayName: 'Language Code',
				name: 'languageCode',
				type: 'string',
				default: '',
				placeholder: 'e.g. es_MX',
				description:
					"Language of the template. Leave empty to use the template's language from the channel.",
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
	const templates = await fetchTemplates.call(this, channelId, true, 0, itemIndex);
	cache.templates.set(channelId, templates);
	return templates;
}

async function fetchTemplates(
	this: IExecuteFunctions,
	channelId: string,
	returnAll: boolean,
	limit: number,
	itemIndex: number,
): Promise<IDataObject[]> {
	const templates: IDataObject[] = [];
	let after: string | undefined;
	for (let page = 0; page < 50; page++) {
		const pageSize = returnAll ? 100 : Math.min(100, limit - templates.length);
		if (pageSize <= 0) break;
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			'/v1/waba/templates',
			undefined,
			{ channel_id: channelId, limit: pageSize, after },
			itemIndex,
		);
		const data = Array.isArray(response.data) ? (response.data as IDataObject[]) : [];
		templates.push(...data);
		const paging = response.paging as IDataObject | undefined;
		const next = (paging?.cursors as IDataObject | undefined)?.after as string | undefined;
		if (!next || data.length < pageSize || !paging?.next) break;
		after = next;
	}
	return returnAll ? templates : templates.slice(0, limit);
}

async function resolveTemplateLanguage(
	this: IExecuteFunctions,
	channelId: string,
	templateName: string,
	cache: ExecutionCache,
	itemIndex: number,
): Promise<string | undefined> {
	const templates = await getChannelTemplates.call(this, channelId, cache, itemIndex);
	const matching = templates.filter(
		(template) =>
			template.name === templateName &&
			(!template.status || String(template.status).toUpperCase() === 'APPROVED'),
	);
	const languages = [
		...new Set(matching.map((template) => String(template.language ?? ''))),
	].filter(Boolean);
	if (languages.length > 1) {
		throw new NodeOperationError(
			this.getNode(),
			`The template '${templateName}' exists in several languages (${languages.join(', ')})`,
			{ description: "Set 'Language Code' in the options to choose one.", itemIndex },
		);
	}
	return languages[0];
}

function buildBodyComponents(collection: IDataObject | undefined): IDataObject[] {
	const variables = (collection?.variable as IDataObject[] | undefined) ?? [];
	if (!variables.length) return [];
	const parameters = variables.map((variable) => {
		const parameter: IDataObject = { type: 'text', text: String(variable.value ?? '') };
		const name = String(variable.name ?? '').trim();
		if (name) parameter.parameter_name = name;
		return parameter;
	});
	return [{ type: 'BODY', parameters }];
}

export const executeWhatsApp: ResourceHandler = async function (this, operation, i, cache) {
	const channelId = getIdParameter.call(this, 'channelId', i, 'Channel');

	if (operation === 'getTemplates') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
		const templates = await fetchTemplates.call(this, channelId, returnAll, limit, i);
		return toExecutionData.call(this, templates, i);
	}

	const contactId = (this.getNodeParameter('contactId', i) as string).trim();
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
		const templateName = String(this.getNodeParameter('templateName', i) ?? '').trim();
		if (!templateName) {
			throw new NodeOperationError(this.getNode(), "The 'Template' parameter is empty", {
				description: 'Choose an approved template of the selected channel.',
				itemIndex: i,
			});
		}
		body.template_name = templateName;

		const languageCode = String(options.languageCode ?? '').trim();
		const language =
			languageCode || (await resolveTemplateLanguage.call(this, channelId, templateName, cache, i));
		if (language) body.language_code = language;

		const customComponents = parseJsonParameter.call(
			this,
			options.components,
			'Components (JSON)',
			i,
		);
		if (Array.isArray(customComponents) && customComponents.length) {
			body.components = customComponents;
		} else {
			const components = buildBodyComponents(
				this.getNodeParameter('bodyVariables', i, {}) as IDataObject,
			);
			if (components.length) body.components = components;
		}

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

	if (operation === 'sendMedia') {
		body.media_type = this.getNodeParameter('mediaType', i) as string;
		const mediaSource = this.getNodeParameter('mediaSource', i) as string;
		if (options.caption) body.content = options.caption;
		if (options.fileName) body.file_name = String(options.fileName).trim();

		if (mediaSource === 'binary') {
			const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
			const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
			const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
			body.media_data = buffer.toString('base64');
			if (!body.file_name && binaryData.fileName) body.file_name = binaryData.fileName;
		} else {
			body.media_data = (this.getNodeParameter('mediaUrl', i) as string).trim();
		}

		const response = await contactShipApiRequest.call(
			this,
			'POST',
			'/v1/waba/send-media',
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
