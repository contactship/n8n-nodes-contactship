import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest, contactShipApiRequestAllItems } from '../../shared/transport';
import { extractList, getIdParameter, toExecutionData, unwrap } from '../../shared/utils';
import type { ResourceHandler } from './common';
import { limitField, returnAllField, sortField, userLocator } from './common';

const RESOURCE = 'conversation';

export const conversationOperations: INodeProperties[] = [
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
				description: 'Retrieve a conversation with its channel, contact, status and assignee',
				action: 'Get conversation',
			},
			{
				name: 'Get Message',
				value: 'getMessage',
				description: 'Retrieve one message of a conversation',
				action: 'Get message',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Close or reopen a conversation, or change who it is assigned to',
				action: 'Update conversation',
			},
		],
		default: 'get',
	},
];

export const conversationFields: INodeProperties[] = [
	{
		displayName: 'Conversation ID',
		name: 'conversationId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d',
		description:
			"ID of the conversation (thread), as returned in 'thread_id' when a WhatsApp message is sent",
		displayOptions: { show: { resource: [RESOURCE], operation: ['get', 'update'] } },
	},
	{
		displayName: 'Message ID',
		name: 'messageId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 9c8b7a6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
		description: "ID of the message, as returned in 'message_id' when it was sent",
		displayOptions: { show: { resource: [RESOURCE], operation: ['getMessage'] } },
	},

	// Update
	{
		displayName: 'Assign To',
		name: 'assignTo',
		type: 'options',
		options: [
			{
				name: 'AI Agent',
				value: 'agent',
				description: 'A ContactShip text agent (WhatsApp or chat)',
			},
			{ name: 'Keep Current', value: 'keep', description: 'Do not change the assignee' },
			{ name: 'Nobody', value: 'none', description: 'Remove the current assignee' },
			{ name: 'User', value: 'user', description: 'A member of your organization' },
		],
		default: 'keep',
		description:
			'Who handles the conversation. If your organization protects assignments, ContactShip refuses changes made with an API key; change them in the inbox instead.',
		displayOptions: { show: { resource: [RESOURCE], operation: ['update'] } },
	},
	userLocator('userId', 'User', 'Member of your organization to assign the conversation to', {
		resource: [RESOURCE],
		operation: ['update'],
		assignTo: ['user'],
	}),
	{
		displayName: 'AI Agent ID',
		name: 'textAgentId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 1f2e3d4c-5b6a-4798-8a7b-6c5d4e3f2a1b',
		description:
			'ID of the ContactShip text agent (WhatsApp or chat) to assign the conversation to',
		displayOptions: { show: { resource: [RESOURCE], operation: ['update'], assignTo: ['agent'] } },
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
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{
						name: 'Closed',
						value: 'closed',
						description:
							'Close the conversation. It runs the on-close automations of your inbox and does not notify the contact.',
					},
					{ name: 'Open', value: 'open' },
				],
				default: 'closed',
			},
		],
	},
];

export const executeConversation: ResourceHandler = async function (this, operation, i) {
	if (operation === 'getMessage') {
		const messageId = encodeURIComponent((this.getNodeParameter('messageId', i) as string).trim());
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`/v1/messages/${messageId}`,
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	const conversationId = encodeURIComponent(
		(this.getNodeParameter('conversationId', i) as string).trim(),
	);
	if (!conversationId) {
		throw new NodeOperationError(this.getNode(), "The 'Conversation ID' parameter is empty", {
			description: "Enter the conversation ID, for example the 'thread_id' of a sent message.",
			itemIndex: i,
		});
	}

	if (operation === 'get') {
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`/v1/thread/${conversationId}`,
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'update') {
		const updateFields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
		const assignTo = this.getNodeParameter('assignTo', i, 'keep') as string;
		const body: IDataObject = {};
		if (updateFields.status) body.status = updateFields.status;
		if (assignTo === 'user') {
			body.assignee = getIdParameter.call(this, 'userId', i, 'User');
			body.assignee_type = 'user';
		} else if (assignTo === 'agent') {
			body.assignee = (this.getNodeParameter('textAgentId', i) as string).trim();
			body.assignee_type = 'agent';
		} else if (assignTo === 'none') {
			body.assignee = null;
			body.assignee_type = null;
		}
		if (!Object.keys(body).length) {
			throw new NodeOperationError(this.getNode(), 'There is nothing to update', {
				description:
					"Choose who to assign the conversation to, or add 'Status' in 'Update Fields'.",
				itemIndex: i,
			});
		}
		const response = await contactShipApiRequest.call(
			this,
			'PUT',
			`/v1/thread/${conversationId}`,
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for conversations`,
		{ itemIndex: i },
	);
};

// Channels

const CHANNEL_RESOURCE = 'channel';

export const channelOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [CHANNEL_RESOURCE] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve the messaging channels of your organization (WhatsApp, Instagram…)',
				action: 'Get many channels',
			},
		],
		default: 'getAll',
	},
];

export const channelFields: INodeProperties[] = [
	returnAllField(CHANNEL_RESOURCE, 'getAll'),
	limitField(CHANNEL_RESOURCE, 'getAll'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: [CHANNEL_RESOURCE], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Answered By',
				name: 'answerMethod',
				type: 'options',
				options: [
					{ name: 'AI Agent', value: 'auto' },
					{ name: 'People', value: 'manual' },
				],
				default: 'auto',
				description: 'Who answers new messages in the channel',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Channels whose name contains this text',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'string',
				default: '',
				placeholder: 'e.g. active',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				options: [
					{ name: 'Instagram', value: 'INSTAGRAM' },
					{ name: 'Messenger', value: 'MESSENGER' },
					{ name: 'TikTok', value: 'TIKTOK' },
					{ name: 'Web Chat', value: 'WEBCHAT' },
					{ name: 'WhatsApp', value: 'WABA' },
				],
				default: 'WABA',
			},
		],
	},
	sortField(CHANNEL_RESOURCE, 'getAll'),
];

/**
 * The fields of a channel that are safe to pass on. Channel records can carry
 * provider credentials, so anything not listed here is left out.
 */
function publicChannel(channel: IDataObject): IDataObject {
	return {
		id: channel.id,
		name: channel.name,
		type: channel.type,
		status: channel.status,
		answer_method: channel.answer_method,
		provider_display_value: channel.provider_display_value,
		created_at: channel.created_at,
		updated_at: channel.updated_at,
	};
}

export const executeChannel: ResourceHandler = async function (this, operation, i) {
	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const sort = this.getNodeParameter('sort', i, {}) as IDataObject;
		const channels = await contactShipApiRequestAllItems.call(
			this,
			'/v1/channels',
			{
				order: sort.order ?? 'desc',
				type: filters.type,
				status: filters.status,
				answer_method: filters.answerMethod,
				name: filters.name,
			},
			{ returnAll, limit, pageSize: 100, itemIndex: i, extract: extractList },
		);
		return toExecutionData.call(
			this,
			channels.filter((channel) => !channel.deleted_at).map(publicChannel),
			i,
		);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for channels`,
		{ itemIndex: i },
	);
};
