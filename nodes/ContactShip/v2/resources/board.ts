import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest } from '../../shared/transport';
import { getIdParameter, toExecutionData, unwrap } from '../../shared/utils';
import type { ResourceHandler } from './common';
import { contactIdField, resolveContactId } from './common';

const RESOURCE = 'board';

export const boardOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Add Contact',
				value: 'addContact',
				description: 'Add a contact to a stage of a board (pipeline) by creating its card',
				action: 'Add contact to board',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve a board with its stages',
				action: 'Get board',
			},
			{
				name: 'Get Contact Card',
				value: 'getCard',
				description: 'Retrieve the card of a contact on a board',
				action: 'Get contact card from board',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve a list of boards',
				action: 'Get many boards',
			},
			{
				name: 'Move Card',
				value: 'moveCard',
				description: "Move a contact's card to another stage",
				action: 'Move card to stage',
			},
			{
				name: 'Remove Card',
				value: 'removeCard',
				description: "Remove a contact's card from a board. The contact itself is kept.",
				action: 'Remove card from board',
			},
		],
		default: 'addContact',
	},
];

export const boardFields: INodeProperties[] = [
	{
		displayName: 'Board',
		name: 'boardId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		displayOptions: {
			show: { resource: [RESOURCE], operation: ['addContact', 'get', 'getCard', 'moveCard'] },
		},
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchBoards', searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c',
			},
		],
	},
	contactIdField(RESOURCE, ['addContact', 'getCard']),
	{
		displayName: 'Card ID',
		name: 'cardId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d',
		description:
			"ID of the contact's card. Use the 'Get Contact Card' operation to find it from the contact ID.",
		displayOptions: { show: { resource: [RESOURCE], operation: ['moveCard', 'removeCard'] } },
	},
	{
		displayName: 'Stage Name or ID',
		name: 'stageId',
		type: 'options',
		required: true,
		typeOptions: {
			loadOptionsMethod: 'getStages',
			loadOptionsDependsOn: ['boardId.value'],
		},
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: { show: { resource: [RESOURCE], operation: ['addContact', 'moveCard'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['addContact', 'moveCard'] } },
		options: [
			{
				displayName: 'Position',
				name: 'position',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description: 'Position of the card inside the stage. 0 puts it first.',
			},
		],
	},
	{
		displayName: 'Board Type',
		name: 'entityType',
		type: 'options',
		options: [
			{ name: 'Contact Boards', value: 'CONTACT' },
			{ name: 'Agent Boards', value: 'AGENT' },
		],
		default: 'CONTACT',
		description: 'Which kind of boards to list',
		displayOptions: { show: { resource: [RESOURCE], operation: ['getAll'] } },
	},
];

export const executeBoard: ResourceHandler = async function (this, operation, i) {
	if (operation === 'getAll') {
		const entityType = this.getNodeParameter('entityType', i, 'CONTACT') as string;
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			'/v1/board/list',
			undefined,
			{ entityType },
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'removeCard') {
		const cardId = encodeURIComponent((this.getNodeParameter('cardId', i) as string).trim());
		await contactShipApiRequest.call(this, 'DELETE', `/v1/card/${cardId}`, undefined, undefined, i);
		return toExecutionData.call(this, { deleted: true }, i);
	}

	const boardId = getIdParameter.call(this, 'boardId', i, 'Board');

	if (operation === 'get') {
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`/v1/board/${encodeURIComponent(boardId)}`,
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'getCard') {
		const contactId = await resolveContactId.call(this, i);
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`/v1/board/${encodeURIComponent(boardId)}/contact/${encodeURIComponent(contactId)}`,
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	const position = String(options.position ?? 0);
	const stageId = String(this.getNodeParameter('stageId', i) ?? '').trim();
	if (!stageId) {
		throw new NodeOperationError(this.getNode(), "The 'Stage' parameter is empty", {
			description: 'Choose a stage of the selected board.',
			itemIndex: i,
		});
	}

	if (operation === 'addContact') {
		const body: IDataObject = {
			entity_id: await resolveContactId.call(this, i),
			entity_type: 'CONTACT',
			stage_id: stageId,
			order: position,
		};
		const response = await contactShipApiRequest.call(this, 'POST', '/v1/card', body, undefined, i);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'moveCard') {
		const body: IDataObject = {
			id: (this.getNodeParameter('cardId', i) as string).trim(),
			stage_id: stageId,
			order: position,
		};
		const response = await contactShipApiRequest.call(
			this,
			'PUT',
			'/v1/card/move',
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for boards`,
		{
			itemIndex: i,
		},
	);
};
