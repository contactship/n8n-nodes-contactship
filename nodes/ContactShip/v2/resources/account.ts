import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest, contactShipApiRequestAllItems } from '../../shared/transport';
import { toExecutionData, unwrap } from '../../shared/utils';
import type { ResourceHandler } from './common';
import { limitField, returnAllField, sortField } from './common';

export const phoneNumberOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['phoneNumber'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve the phone numbers of your organization',
				action: 'Get many phone numbers',
			},
		],
		default: 'getAll',
	},
];

export const phoneNumberFields: INodeProperties[] = [
	returnAllField('phoneNumber', 'getAll'),
	limitField('phoneNumber', 'getAll'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['phoneNumber'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				options: [
					{ name: 'Inbound', value: 'inbound' },
					{ name: 'Outbound', value: 'outbound' },
				],
				default: 'outbound',
			},
		],
	},
	sortField('phoneNumber', 'getAll'),
];

export const creditsOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['credits'] } },
		options: [
			{
				name: 'Get Balance',
				value: 'get',
				description: 'Retrieve the current credit balance of your organization',
				action: 'Get credit balance',
			},
		],
		default: 'get',
	},
];

export const executePhoneNumber: ResourceHandler = async function (this, operation, i) {
	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const sort = this.getNodeParameter('sort', i, {}) as IDataObject;
		const phoneNumbers = await contactShipApiRequestAllItems.call(
			this,
			'/v1/phone-numbers',
			{ order: sort.order ?? 'desc', type: filters.type },
			{ returnAll, limit, pageSize: 100, itemIndex: i },
		);
		return toExecutionData.call(this, phoneNumbers, i);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for phone numbers`,
		{ itemIndex: i },
	);
};

export const executeCredits: ResourceHandler = async function (this, operation, i) {
	if (operation === 'get') {
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			'/v1/credits',
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for credits`,
		{
			itemIndex: i,
		},
	);
};
