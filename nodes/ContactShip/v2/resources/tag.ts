import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest, contactShipApiRequestAllItems } from '../../shared/transport';
import { getIdParameter, toExecutionData, unwrap } from '../../shared/utils';
import type { ResourceHandler } from './common';
import { limitField, returnAllField, sortField } from './common';

const RESOURCE = 'tag';

export const tagOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{ name: 'Create', value: 'create', description: 'Create a new tag', action: 'Create tag' },
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a tag permanently and remove it from every contact',
				action: 'Delete tag',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve a list of tags',
				action: 'Get many tags',
			},
			{ name: 'Update', value: 'update', description: 'Update a tag', action: 'Update tag' },
		],
		default: 'getAll',
	},
];

export const tagFields: INodeProperties[] = [
	{
		displayName: 'Tag',
		name: 'tagId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		displayOptions: { show: { resource: [RESOURCE], operation: ['delete', 'update'] } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchTags', searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. c1b2c3d4-e5f6-4890-abcd-ef1234567890',
			},
		],
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. hot-lead',
		description: 'Internal name of the tag',
		displayOptions: { show: { resource: [RESOURCE], operation: ['create'] } },
	},
	{
		displayName: 'Label',
		name: 'label',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Hot Lead',
		description: 'Name shown in ContactShip',
		displayOptions: { show: { resource: [RESOURCE], operation: ['create'] } },
	},
	{
		displayName: 'Color',
		name: 'color',
		type: 'color',
		required: true,
		default: '#0252FF',
		displayOptions: { show: { resource: [RESOURCE], operation: ['create'] } },
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['update'] } },
		options: [
			{ displayName: 'Color', name: 'color', type: 'color', default: '#0252FF' },
			{
				displayName: 'Label',
				name: 'label',
				type: 'string',
				default: '',
				placeholder: 'e.g. Hot Lead',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				placeholder: 'e.g. hot-lead',
			},
		],
	},
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
				displayName: 'Label',
				name: 'label',
				type: 'string',
				default: '',
				description: 'Tags whose label contains this text',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Tags whose name contains this text',
			},
		],
	},
	sortField(RESOURCE, 'getAll'),
];

export const executeTag: ResourceHandler = async function (this, operation, i) {
	if (operation === 'create') {
		const body: IDataObject = {
			name: (this.getNodeParameter('name', i) as string).trim(),
			label: (this.getNodeParameter('label', i) as string).trim(),
			color: this.getNodeParameter('color', i) as string,
		};
		const response = await contactShipApiRequest.call(this, 'POST', '/v1/tags', body, undefined, i);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const sort = this.getNodeParameter('sort', i, {}) as IDataObject;
		const tags = await contactShipApiRequestAllItems.call(
			this,
			'/v1/tags',
			{ order: sort.order ?? 'desc', name: filters.name, label: filters.label },
			{ returnAll, limit, pageSize: 100, itemIndex: i },
		);
		return toExecutionData.call(this, tags, i);
	}

	const tagId = encodeURIComponent(getIdParameter.call(this, 'tagId', i, 'Tag'));

	if (operation === 'update') {
		const updateFields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
		const body: IDataObject = {};
		for (const key of ['name', 'label', 'color']) {
			if (updateFields[key]) body[key] = String(updateFields[key]).trim();
		}
		if (!Object.keys(body).length) {
			throw new NodeOperationError(this.getNode(), 'There is nothing to update', {
				description: "Add at least one field in 'Update Fields'.",
				itemIndex: i,
			});
		}
		const response = await contactShipApiRequest.call(
			this,
			'PATCH',
			`/v1/tags/${tagId}`,
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'delete') {
		await contactShipApiRequest.call(this, 'DELETE', `/v1/tags/${tagId}`, undefined, undefined, i);
		return toExecutionData.call(this, { deleted: true }, i);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for tags`,
		{
			itemIndex: i,
		},
	);
};
