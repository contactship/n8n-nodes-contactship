import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeParameterResourceLocator,
	INodeProperties,
	ResourceMapperValue,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest } from '../../shared/transport';
import { normalizePhoneNumber, unwrap } from '../../shared/utils';

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
	description = 'The contact. Search by name, phone number or email, or enter its ID, phone number or email.',
): INodeProperties {
	return {
		displayName: 'Contact',
		name: 'contactId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		description,
		displayOptions: { show: { resource: [resource], operation: operations } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchContacts', searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 3f2c1a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b',
			},
			{
				displayName: 'Phone Number',
				name: 'phone',
				type: 'string',
				placeholder: 'e.g. +12125551234',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'e.g. nathan@example.com',
			},
		],
	};
}

export interface ContactReference {
	identifier: string;
	identifierType: 'id' | 'phone_number' | 'email';
}

/** Reads the contact picker: an ID, or a phone number or email to look the contact up by. */
export function getContactReference(
	this: IExecuteFunctions,
	itemIndex: number,
	name = 'contactId',
): ContactReference {
	const raw = this.getNodeParameter(name, itemIndex, '') as INodeParameterResourceLocator | string;
	const locator = raw !== null && typeof raw === 'object' ? raw : undefined;
	const mode = locator ? String(locator.mode) : 'id';
	const value = String((locator ? locator.value : raw) ?? '').trim();
	if (!value) {
		throw new NodeOperationError(this.getNode(), "The 'Contact' parameter is empty", {
			description: 'Choose a contact from the list, or enter its ID, phone number or email.',
			itemIndex,
		});
	}
	if (mode === 'phone') {
		return {
			identifier: normalizePhoneNumber.call(this, value, 'Contact', itemIndex),
			identifierType: 'phone_number',
		};
	}
	if (mode === 'email') return { identifier: value, identifierType: 'email' };
	return { identifier: value, identifierType: 'id' };
}

/** Returns the ID of the contact in the picker, looking it up when given a phone number or email. */
export async function resolveContactId(
	this: IExecuteFunctions,
	itemIndex: number,
	name = 'contactId',
): Promise<string> {
	const { identifier, identifierType } = getContactReference.call(this, itemIndex, name);
	if (identifierType === 'id') return identifier;
	const response = await contactShipApiRequest.call(
		this,
		'GET',
		`/v1/contacts/${encodeURIComponent(identifier)}`,
		undefined,
		{ identifierType },
		itemIndex,
	);
	const contact = unwrap(response) as IDataObject | undefined;
	if (!contact?.id) {
		throw new NodeOperationError(this.getNode(), `No contact found with ${identifier}`, {
			description:
				'Check the phone number or email, or create the contact first with Contact → Create or Update.',
			itemIndex,
		});
	}
	return String(contact.id);
}

/** Reads the values of a resource mapper parameter, without empty entries. */
export function getMappedValues(
	this: IExecuteFunctions,
	name: string,
	itemIndex: number,
): { values: IDataObject; schema: ResourceMapperValue['schema'] } {
	const mapper = this.getNodeParameter(name, itemIndex, null) as ResourceMapperValue | null;
	const values: IDataObject = {};
	for (const [key, value] of Object.entries(mapper?.value ?? {})) {
		if (value === undefined || value === null || String(value).trim() === '') continue;
		values[key] = value;
	}
	return { values, schema: Array.isArray(mapper?.schema) ? mapper.schema : [] };
}

type DisplayShow = NonNullable<NonNullable<INodeProperties['displayOptions']>['show']>;

export function userLocator(
	name: string,
	displayName: string,
	description: string,
	show: DisplayShow,
	options: { byEmail?: boolean; required?: boolean } = {},
): INodeProperties {
	return {
		displayName,
		name,
		type: 'resourceLocator',
		required: options.required ?? true,
		default: { mode: 'list', value: '' },
		description,
		displayOptions: { show },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: options.byEmail ? 'searchUserEmails' : 'searchUsers',
					searchable: true,
				},
			},
			{
				displayName: options.byEmail ? 'Email' : 'ID',
				name: options.byEmail ? 'email' : 'id',
				type: 'string',
				placeholder: options.byEmail
					? 'e.g. nathan@example.com'
					: 'e.g. 6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d',
			},
		],
	};
}

export function voiceLocator(resource: string, operations: string[]): INodeProperties {
	return {
		displayName: 'Voice',
		name: 'voiceId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		description: 'Voice of the agent. The list shows gender, accent and language.',
		displayOptions: { show: { resource: [resource], operation: operations } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchVoices', searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'ID from Voice → Get Many',
			},
		],
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
