import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest, contactShipApiRequestAllItems } from '../../shared/transport';
import { parseJsonParameter, splitList, toExecutionData, unwrap } from '../../shared/utils';
import type { ResourceHandler } from './common';
import { limitField, returnAllField } from './common';

const RESOURCE = 'task';

const STATUS_OPTIONS = [
	{ name: 'Backlog', value: 'backlog' },
	{ name: 'Blocked', value: 'blocked' },
	{ name: 'Canceled', value: 'canceled' },
	{ name: 'Done', value: 'done' },
	{ name: 'In Progress', value: 'in_progress' },
	{ name: 'To Do', value: 'todo' },
];

const PRIORITY_OPTIONS = [
	{ name: 'High', value: 'high' },
	{ name: 'Low', value: 'low' },
	{ name: 'Medium', value: 'medium' },
];

const sharedTaskFields: INodeProperties[] = [
	{
		displayName: 'Additional Data (JSON)',
		name: 'additionalData',
		type: 'json',
		default: '{}',
		description: 'Your own data to store on the task, as a JSON object',
	},
	{
		displayName: 'Assignee Emails',
		name: 'assignedTo',
		type: 'string',
		default: '',
		placeholder: 'e.g. nathan@example.com, ana@example.com',
		description: 'Comma-separated emails of the organization members to assign',
	},
	{
		displayName: 'Priority',
		name: 'priority',
		type: 'options',
		options: PRIORITY_OPTIONS,
		default: 'medium',
	},
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		options: STATUS_OPTIONS,
		default: 'todo',
	},
];

export const taskOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{ name: 'Create', value: 'create', description: 'Create a new task', action: 'Create task' },
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a task permanently',
				action: 'Delete task',
			},
			{ name: 'Get', value: 'get', description: 'Retrieve a task', action: 'Get task' },
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve a list of tasks',
				action: 'Get many tasks',
			},
			{ name: 'Update', value: 'update', description: 'Update a task', action: 'Update task' },
		],
		default: 'create',
	},
];

export const taskFields: INodeProperties[] = [
	{
		displayName: 'Task ID',
		name: 'taskId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
		displayOptions: { show: { resource: [RESOURCE], operation: ['delete', 'get', 'update'] } },
	},
	{
		displayName: 'Title',
		name: 'brief',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Call back about the quote',
		description: 'Short description of the task',
		displayOptions: { show: { resource: [RESOURCE], operation: ['create'] } },
	},
	{
		displayName: 'Details',
		name: 'details',
		type: 'string',
		required: true,
		typeOptions: { rows: 4 },
		default: '',
		description: 'What needs to be done, at least four characters',
		displayOptions: { show: { resource: [RESOURCE], operation: ['create'] } },
	},
	{
		displayName: 'Creator Email',
		name: 'createdBy',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. nathan@example.com',
		description: 'Email of the organization member who creates the task',
		displayOptions: { show: { resource: [RESOURCE], operation: ['create'] } },
	},
	{
		displayName: 'Type',
		name: 'type',
		type: 'options',
		options: [
			{ name: 'AI', value: 'AI' },
			{ name: 'Automation', value: 'automatization' },
			{ name: 'Custom', value: 'custom', description: 'A task created by a person' },
			{ name: 'System', value: 'system' },
		],
		default: 'automatization',
		displayOptions: { show: { resource: [RESOURCE], operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['create'] } },
		options: sharedTaskFields,
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['update'] } },
		options: [
			sharedTaskFields[0],
			sharedTaskFields[1],
			{
				displayName: 'Details',
				name: 'details',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
			},
			sharedTaskFields[2],
			sharedTaskFields[3],
			{
				displayName: 'Title',
				name: 'brief',
				type: 'string',
				default: '',
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
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				options: PRIORITY_OPTIONS,
				default: 'high',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: STATUS_OPTIONS,
				default: 'todo',
			},
		],
	},
	{
		displayName: 'Sort',
		name: 'sort',
		type: 'collection',
		placeholder: 'Add Sort Option',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Direction',
				name: 'orderDirection',
				type: 'options',
				options: [
					{ name: 'Ascending', value: 'ASCENDENT' },
					{ name: 'Descending', value: 'DESCENDENT' },
				],
				default: 'DESCENDENT',
			},
			{
				displayName: 'Sort By',
				name: 'orderBy',
				type: 'options',
				options: [
					{ name: 'Created At', value: 'created_at' },
					{ name: 'Updated At', value: 'updated_at' },
				],
				default: 'created_at',
			},
		],
	},
];

function applyTaskFields(
	this: IExecuteFunctions,
	body: IDataObject,
	fields: IDataObject,
	itemIndex: number,
): void {
	if (fields.status) body.status = fields.status;
	if (fields.priority) body.priority = fields.priority;
	if (fields.details) body.details = fields.details;
	if (fields.brief) body.brief = String(fields.brief).trim();
	if (fields.assignedTo !== undefined && fields.assignedTo !== '') {
		body.assigned_to = splitList(fields.assignedTo);
	}
	const additionalData = parseJsonParameter.call(
		this,
		fields.additionalData,
		'Additional Data (JSON)',
		itemIndex,
	);
	if (additionalData && !Array.isArray(additionalData) && Object.keys(additionalData).length) {
		body.additional_data = additionalData;
	}
}

export const executeTask: ResourceHandler = async function (this, operation, i) {
	if (operation === 'create') {
		const details = this.getNodeParameter('details', i) as string;
		if (details.trim().length < 4) {
			throw new NodeOperationError(this.getNode(), "'Details' must have at least four characters", {
				description: 'Describe what needs to be done in a few words.',
				itemIndex: i,
			});
		}
		const body: IDataObject = {
			brief: (this.getNodeParameter('brief', i) as string).trim(),
			details,
			created_by: (this.getNodeParameter('createdBy', i) as string).trim(),
			type: this.getNodeParameter('type', i) as string,
		};
		const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
		applyTaskFields.call(this, body, additionalFields, i);
		const response = await contactShipApiRequest.call(
			this,
			'POST',
			'/v1/tasks',
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const sort = this.getNodeParameter('sort', i, {}) as IDataObject;
		const conditions: IDataObject[] = [];
		if (filters.status)
			conditions.push({ field: 'status', operator: 'EQUAL', value: filters.status });
		if (filters.priority) {
			conditions.push({ field: 'priority', operator: 'EQUAL', value: filters.priority });
		}
		const tasks = await contactShipApiRequestAllItems.call(
			this,
			'/v1/tasks',
			{
				orderBy: sort.orderBy ?? 'created_at',
				orderDirection: sort.orderDirection ?? 'DESCENDENT',
				filters: conditions.length ? JSON.stringify(conditions) : undefined,
			},
			{ returnAll, limit, pageSize: 100, itemIndex: i },
		);
		return toExecutionData.call(this, tasks, i);
	}

	const taskId = encodeURIComponent((this.getNodeParameter('taskId', i) as string).trim());

	if (operation === 'get') {
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`/v1/tasks/${taskId}`,
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'update') {
		const updateFields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
		const body: IDataObject = {};
		applyTaskFields.call(this, body, updateFields, i);
		if (!Object.keys(body).length) {
			throw new NodeOperationError(this.getNode(), 'There is nothing to update', {
				description: "Add at least one field in 'Update Fields'.",
				itemIndex: i,
			});
		}
		const response = await contactShipApiRequest.call(
			this,
			'PUT',
			`/v1/tasks/${taskId}`,
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
			`/v1/tasks/${taskId}`,
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, { deleted: true }, i);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for tasks`,
		{
			itemIndex: i,
		},
	);
};
