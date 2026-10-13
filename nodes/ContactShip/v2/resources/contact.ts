import type { IDataObject, IExecuteFunctions, INodeProperties, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import {
	contactShipApiRequest,
	contactShipApiRequestAllItems,
	isNodeApiError,
} from '../../shared/transport';
import { getIdParameter, normalizePhoneNumber, toExecutionData, unwrap } from '../../shared/utils';
import type { ExecutionCache, ResourceHandler } from './common';
import {
	contactIdField,
	getContactReference,
	getMappedValues,
	limitField,
	resolveContactId,
	returnAllField,
	sortField,
	userLocator,
} from './common';

const RESOURCE = 'contact';

function contactPropertiesField(operations: string[], description: string): INodeProperties {
	return {
		displayName: 'Contact Properties',
		name: 'contactProperties',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		description,
		typeOptions: {
			resourceMapper: {
				resourceMapperMethod: 'getContactPropertyFields',
				mode: 'add',
				fieldWords: { singular: 'property', plural: 'properties' },
				addAllFields: false,
				multiKeyMatch: false,
				supportAutoMap: false,
				noFieldsError:
					"Your organization has no contact properties yet. Define them in ContactShip, or use 'Custom Properties'.",
			},
		},
		displayOptions: { show: { resource: [RESOURCE], operation: operations } },
	};
}

const customPropertiesOption: INodeProperties = {
	displayName: 'Custom Properties',
	name: 'customProperties',
	type: 'fixedCollection',
	placeholder: 'Add Property',
	default: {},
	typeOptions: { multipleValues: true },
	description: 'Free-form data to store on the contact',
	options: [
		{
			displayName: 'Property',
			name: 'property',
			values: [
				{
					displayName: 'Field',
					name: 'field',
					type: 'string',
					default: '',
					placeholder: 'e.g. address',
				},
				{
					displayName: 'Type',
					name: 'type',
					type: 'options',
					options: [
						{ name: 'Calendar (Date)', value: 'calendar' },
						{ name: 'Location', value: 'location' },
						{ name: 'Number', value: 'number' },
						{ name: 'Text', value: 'text' },
						{ name: 'URL', value: 'url' },
					],
					default: 'text',
				},
				{
					displayName: 'Value',
					name: 'value',
					type: 'string',
					default: '',
				},
			],
		},
	],
};

const emailOption: INodeProperties = {
	displayName: 'Email',
	name: 'email',
	type: 'string',
	placeholder: 'e.g. nathan@example.com',
	default: '',
};

export const contactOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Add Tag',
				value: 'addTag',
				description: 'Assign a tag to a contact',
				action: 'Add tag to contact',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Create a new contact',
				action: 'Create contact',
			},
			{
				name: 'Create Comment',
				value: 'createComment',
				description: 'Add a comment to the activity of a contact',
				action: 'Create comment on contact',
			},
			{
				name: 'Create or Update',
				value: 'upsert',
				description:
					'Create a new contact, or update the current one if it already exists (upsert)',
				action: 'Create or update contact',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a contact permanently',
				action: 'Delete contact',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve a contact by ID, phone number or email',
				action: 'Get contact',
			},
			{
				name: 'Get Call History',
				value: 'getCallHistory',
				description: 'Retrieve the calls made to and from a contact',
				action: 'Get contact call history',
			},
			{
				name: 'Get Comments',
				value: 'getComments',
				description: 'Retrieve the comments of a contact',
				action: 'Get contact comments',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve a list of contacts',
				action: 'Get many contacts',
			},
			{
				name: 'Get Tags',
				value: 'getTags',
				description: 'Retrieve the tags assigned to a contact',
				action: 'Get contact tags',
			},
			{
				name: 'Remove Tag',
				value: 'removeTag',
				description: 'Remove a tag from a contact. The tag itself is kept.',
				action: 'Remove tag from contact',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update the details of a contact',
				action: 'Update contact',
			},
			{
				name: 'Update Properties',
				value: 'updateProperties',
				description: 'Update the property values (additional data) of a contact',
				action: 'Update contact properties',
			},
		],
		default: 'create',
	},
];

export const contactFields: INodeProperties[] = [
	// Create and Create or Update
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. +12125551234',
		description:
			'Phone number in international format. Create or Update uses it to find an existing contact.',
		displayOptions: { show: { resource: [RESOURCE], operation: ['create', 'upsert'] } },
	},
	{
		displayName: 'Full Name',
		name: 'fullName',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Nathan Smith',
		displayOptions: { show: { resource: [RESOURCE], operation: ['create', 'upsert'] } },
	},
	{
		displayName: 'Country',
		name: 'country',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Mexico',
		displayOptions: { show: { resource: [RESOURCE], operation: ['create', 'upsert'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['create', 'upsert'] } },
		options: [customPropertiesOption, emailOption],
	},
	contactPropertiesField(
		['create', 'upsert'],
		'Values for the contact properties defined in your organization',
	),

	// Operations on one contact
	contactIdField(RESOURCE, [
		'addTag',
		'createComment',
		'delete',
		'get',
		'getCallHistory',
		'getComments',
		'getTags',
		'removeTag',
		'update',
		'updateProperties',
	]),

	// Add Tag and Remove Tag
	{
		displayName: 'Tag',
		name: 'tagId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		displayOptions: { show: { resource: [RESOURCE], operation: ['addTag', 'removeTag'] } },
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

	// Create Comment
	{
		displayName: 'Comment',
		name: 'content',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 4 },
		placeholder: 'e.g. Asked to be called back next week',
		displayOptions: { show: { resource: [RESOURCE], operation: ['createComment'] } },
	},
	{
		displayName: 'Author Type',
		name: 'createdByType',
		type: 'options',
		options: [
			{ name: 'AI', value: 'AI' },
			{ name: 'Automation', value: 'AUTOMATIZATION' },
			{ name: 'System', value: 'SYSTEM' },
			{
				name: 'User',
				value: 'USER',
				description: 'A member of your organization, identified by email',
			},
		],
		default: 'AUTOMATIZATION',
		description: 'Who the comment is shown as written by',
		displayOptions: { show: { resource: [RESOURCE], operation: ['createComment'] } },
	},
	userLocator(
		'createdBy',
		'Author',
		'Organization member who writes the comment',
		{ resource: [RESOURCE], operation: ['createComment'], createdByType: ['USER'] },
		{ byEmail: true },
	),

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
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'e.g. nathan@example.com',
				default: '',
				description: 'Contacts whose email contains this text',
			},
			{
				displayName: 'Full Name',
				name: 'fullName',
				type: 'string',
				default: '',
				placeholder: 'e.g. Nathan',
				description: 'Contacts whose name contains this text',
			},
			{
				displayName: 'Phone Number',
				name: 'phoneNumber',
				type: 'string',
				default: '',
				placeholder: 'e.g. +1212',
				description: 'Contacts whose phone number contains this text',
			},
		],
	},
	sortField(RESOURCE, 'getAll'),

	// Update
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['update'] } },
		options: [
			{
				displayName: 'Country',
				name: 'country',
				type: 'string',
				default: '',
				placeholder: 'e.g. Mexico',
			},
			{
				...customPropertiesOption,
				description:
					"Replaces all the property values of the contact. To change only some, use the 'Update Properties' operation.",
			},
			emailOption,
			{
				displayName: 'Full Name',
				name: 'fullName',
				type: 'string',
				default: '',
				placeholder: 'e.g. Nathan Smith',
			},
			{
				displayName: 'Phone Number',
				name: 'phoneNumber',
				type: 'string',
				default: '',
				placeholder: 'e.g. +12125551234',
			},
		],
	},

	contactPropertiesField(
		['update'],
		"Values for the contact properties defined in your organization. They replace all the property values of the contact; to change only some, use 'Update Properties'.",
	),

	// Update Properties
	contactPropertiesField(
		['updateProperties'],
		'Values for the contact properties defined in your organization. Other properties of the contact are kept.',
	),
	{
		...customPropertiesOption,
		displayOptions: { show: { resource: [RESOURCE], operation: ['updateProperties'] } },
	},
];

/**
 * Maps the type of an organization property to the types accepted in a
 * contact's `additional_data` (text, url, location, number, calendar).
 */
function toAdditionalDataType(type: unknown): string {
	switch (String(type ?? '').toLowerCase()) {
		case 'number':
			return 'number';
		case 'date':
		case 'calendar':
			return 'calendar';
		case 'url':
			return 'url';
		case 'location':
			return 'location';
		default:
			return 'text';
	}
}

async function getPropertyTypes(
	this: IExecuteFunctions,
	cache: ExecutionCache,
	itemIndex: number,
): Promise<IDataObject[]> {
	if (!cache.contactProperties) {
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			'/v1/organization/contact-properties',
			undefined,
			undefined,
			itemIndex,
		);
		const data = (response.data as IDataObject | undefined) ?? {};
		cache.contactProperties = Array.isArray(data.properties)
			? (data.properties as IDataObject[])
			: [];
	}
	return cache.contactProperties;
}

/** Builds the API's `additional_data` array from the property mapper and the custom properties. */
async function buildAdditionalData(
	this: IExecuteFunctions,
	customProperties: IDataObject | undefined,
	cache: ExecutionCache,
	itemIndex: number,
): Promise<IDataObject[]> {
	const additionalData: IDataObject[] = [];

	const { values } = getMappedValues.call(this, 'contactProperties', itemIndex);
	if (Object.keys(values).length) {
		const definitions = await getPropertyTypes.call(this, cache, itemIndex);
		for (const [field, value] of Object.entries(values)) {
			const definition = definitions.find((property) => property.field === field);
			additionalData.push({
				type: toAdditionalDataType(definition?.type),
				field,
				value: String(value),
			});
		}
	}

	const custom = (customProperties?.property as IDataObject[] | undefined) ?? [];
	for (const entry of custom) {
		const field = String(entry.field ?? '').trim();
		if (!field) continue;
		additionalData.push({
			type: String(entry.type ?? 'text'),
			field,
			value: String(entry.value ?? ''),
		});
	}

	return additionalData;
}

async function contactPath(
	this: IExecuteFunctions,
	itemIndex: number,
	suffix = '',
): Promise<string> {
	const contactId = await resolveContactId.call(this, itemIndex);
	return `/v1/contacts/${encodeURIComponent(contactId)}${suffix}`;
}

export const executeContact: ResourceHandler = async function (this, operation, i, cache) {
	if (operation === 'create' || operation === 'upsert') {
		const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const phoneNumber = normalizePhoneNumber.call(
			this,
			this.getNodeParameter('phoneNumber', i) as string,
			'Phone Number',
			i,
		);
		const body: IDataObject = {
			full_name: (this.getNodeParameter('fullName', i) as string).trim(),
			phone_number: phoneNumber,
			country: (this.getNodeParameter('country', i) as string).trim(),
		};
		if (additionalFields.email) body.email = String(additionalFields.email).trim();
		const additionalData = await buildAdditionalData.call(
			this,
			additionalFields.customProperties as IDataObject | undefined,
			cache,
			i,
		);
		if (additionalData.length) body.additional_data = additionalData;

		if (operation === 'upsert') {
			let existing: IDataObject | undefined;
			try {
				const response = await contactShipApiRequest.call(
					this,
					'GET',
					`/v1/contacts/${encodeURIComponent(phoneNumber)}`,
					undefined,
					{ identifierType: 'phone_number' },
					i,
				);
				const found = unwrap(response);
				if (found && typeof found === 'object' && (found as IDataObject).id) {
					existing = found as IDataObject;
				}
			} catch (error) {
				const notFound = isNodeApiError(error) && String(error.httpCode) === '404';
				if (!notFound) {
					if (isNodeApiError(error)) {
						throw new NodeApiError(this.getNode(), error as unknown as JsonObject, {
							itemIndex: i,
						});
					}
					throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
				}
			}

			if (existing) {
				const response = await contactShipApiRequest.call(
					this,
					'PATCH',
					`/v1/contacts/${encodeURIComponent(String(existing.id))}`,
					body,
					undefined,
					i,
				);
				return toExecutionData.call(this, unwrap(response), i);
			}
		}

		const response = await contactShipApiRequest.call(
			this,
			'POST',
			'/v1/contacts',
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'get') {
		const { identifier, identifierType } = getContactReference.call(this, i);
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`/v1/contacts/${encodeURIComponent(identifier)}`,
			undefined,
			{ identifierType },
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const sort = this.getNodeParameter('sort', i, {}) as IDataObject;
		const contacts = await contactShipApiRequestAllItems.call(
			this,
			'/v1/contacts',
			{
				order: sort.order ?? 'desc',
				full_name: filters.fullName,
				email: filters.email,
				phone_number: filters.phoneNumber,
			},
			{ returnAll, limit, pageSize: 1000, itemIndex: i },
		);
		return toExecutionData.call(this, contacts, i);
	}

	if (operation === 'update') {
		const updateFields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
		const body: IDataObject = {};
		if (updateFields.fullName) body.full_name = String(updateFields.fullName).trim();
		if (updateFields.country) body.country = String(updateFields.country).trim();
		if (updateFields.email) body.email = String(updateFields.email).trim();
		if (updateFields.phoneNumber) {
			body.phone_number = normalizePhoneNumber.call(
				this,
				String(updateFields.phoneNumber),
				'Phone Number',
				i,
			);
		}
		const additionalData = await buildAdditionalData.call(
			this,
			updateFields.customProperties as IDataObject | undefined,
			cache,
			i,
		);
		if (additionalData.length) body.additional_data = additionalData;
		if (!Object.keys(body).length) {
			throw new NodeOperationError(this.getNode(), 'There is nothing to update', {
				description: "Add at least one field in 'Update Fields'.",
				itemIndex: i,
			});
		}
		const response = await contactShipApiRequest.call(
			this,
			'PATCH',
			await contactPath.call(this, i),
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'updateProperties') {
		const additionalData = await buildAdditionalData.call(
			this,
			this.getNodeParameter('customProperties', i, {}) as IDataObject,
			cache,
			i,
		);
		if (!additionalData.length) {
			throw new NodeOperationError(this.getNode(), 'There are no properties to update', {
				description: "Add at least one value in 'Contact Properties' or 'Custom Properties'.",
				itemIndex: i,
			});
		}
		const response = await contactShipApiRequest.call(
			this,
			'PATCH',
			await contactPath.call(this, i, '/additional-data'),
			{ additional_data: additionalData },
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'delete') {
		await contactShipApiRequest.call(
			this,
			'DELETE',
			await contactPath.call(this, i),
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, { deleted: true }, i);
	}

	if (operation === 'getCallHistory') {
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			await contactPath.call(this, i, '/call-history'),
			undefined,
			undefined,
			i,
		);
		// The API answers { contact, history: { call_attempts, calls, last_call } }: return one item per call.
		const data = unwrap(response) as IDataObject | IDataObject[] | undefined;
		const history = (Array.isArray(data) ? undefined : data?.history) as IDataObject | undefined;
		const calls = Array.isArray(data)
			? data
			: ((history?.calls as IDataObject[] | undefined) ?? []);
		return toExecutionData.call(this, calls, i);
	}

	if (operation === 'getComments') {
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			await contactPath.call(this, i, '/comments'),
			undefined,
			undefined,
			i,
		);
		const data = unwrap(response) as IDataObject | IDataObject[];
		const comments = Array.isArray(data)
			? data
			: ((data?.comments as IDataObject[] | undefined) ?? []);
		return toExecutionData.call(this, comments, i);
	}

	if (operation === 'getTags') {
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			await contactPath.call(this, i, '/tags'),
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'addTag' || operation === 'removeTag') {
		const tagId = encodeURIComponent(getIdParameter.call(this, 'tagId', i, 'Tag'));
		const response = await contactShipApiRequest.call(
			this,
			operation === 'addTag' ? 'POST' : 'DELETE',
			await contactPath.call(this, i, `/tags/${tagId}`),
			undefined,
			undefined,
			i,
		);
		const data = unwrap(response);
		if (operation === 'removeTag')
			return toExecutionData.call(this, { removed: data !== false }, i);
		return toExecutionData.call(this, data, i);
	}

	if (operation === 'createComment') {
		const createdByType = this.getNodeParameter('createdByType', i) as string;
		const body: IDataObject = {
			content: this.getNodeParameter('content', i) as string,
			contact_id: await resolveContactId.call(this, i),
			created_by_type: createdByType,
		};
		if (createdByType === 'USER') {
			body.created_by = getIdParameter.call(this, 'createdBy', i, 'Author');
		}
		const response = await contactShipApiRequest.call(
			this,
			'POST',
			'/v1/comments',
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for contacts`,
		{ itemIndex: i },
	);
};
