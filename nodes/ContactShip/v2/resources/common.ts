import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';

/** Values shared by every item of one execution (for example, cached lookups). */
export interface ExecutionCache {
	templates: Map<string, IDataObject[]>;
	contactProperties?: IDataObject[];
}

export type ResourceHandler = (
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
	cache: ExecutionCache,
) => Promise<INodeExecutionData[]>;

export function returnAllField(resource: string, operation: string): INodeProperties {
	return {
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: [resource], operation: [operation] } },
	};
}

export function limitField(resource: string, operation: string): INodeProperties {
	return {
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: { show: { resource: [resource], operation: [operation], returnAll: [false] } },
	};
}

export function sortField(resource: string, operation: string): INodeProperties {
	return {
		displayName: 'Sort',
		name: 'sort',
		type: 'collection',
		placeholder: 'Add Sort Option',
		default: {},
		displayOptions: { show: { resource: [resource], operation: [operation] } },
		options: [
			{
				displayName: 'Direction',
				name: 'order',
				type: 'options',
				options: [
					{ name: 'Newest First', value: 'desc' },
					{ name: 'Oldest First', value: 'asc' },
				],
				default: 'desc',
				description: 'Order by creation date',
			},
		],
	};
}

export function simplifyField(resource: string, operations: string[]): INodeProperties {
	return {
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return a simplified version of the response instead of the raw data',
		displayOptions: { show: { resource: [resource], operation: operations } },
	};
}

export function contactIdField(
	resource: string,
	operations: string[],
	description = 'ID of the contact in ContactShip',
): INodeProperties {
	return {
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 3f2c1a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b',
		description,
		displayOptions: { show: { resource: [resource], operation: operations } },
	};
}

export function agentLocator(resource: string, operations: string[]): INodeProperties {
	return {
		displayName: 'Agent',
		name: 'agentId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		description: 'The voice agent',
		displayOptions: { show: { resource: [resource], operation: operations } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchAgents', searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. a1b2c3d4-e5f6-4890-abcd-ef1234567890',
			},
		],
	};
}
