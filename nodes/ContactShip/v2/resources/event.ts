import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest } from '../../shared/transport';
import { parseJsonParameter } from '../../shared/utils';

const RESOURCE = 'event';
const MAX_EVENTS_PER_REQUEST = 100;

export const eventOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Send',
				value: 'send',
				description:
					'Record something a contact did in another system, such as a purchase or a form, in their activity',
				action: 'Send event',
			},
		],
		default: 'send',
	},
];

export const eventFields: INodeProperties[] = [
	{
		displayName:
			'Each input item becomes one event. Items are sent in batches of up to 100. Events require the Events add-on in ContactShip.',
		name: 'eventNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RESOURCE], operation: ['send'] } },
	},
	{
		displayName: 'Event Name',
		name: 'eventName',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. purchase',
		description:
			'What happened. It is stored in lowercase snake_case (Add To Cart becomes add_to_cart). Names starting with cs_ are reserved.',
		displayOptions: { show: { resource: [RESOURCE], operation: ['send'] } },
	},
	{
		displayName: 'Contact',
		name: 'contact',
		type: 'collection',
		placeholder: 'Add Contact Field',
		default: {},
		description:
			'Who the event happened to. Send at least one of contact ID, external ID, phone or email, unless you send a session ID.',
		displayOptions: { show: { resource: [RESOURCE], operation: ['send'] } },
		options: [
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'string',
				default: '',
				description: 'ID of the contact in ContactShip',
			},
			{
				displayName: 'Country',
				name: 'country',
				type: 'string',
				default: '',
				placeholder: 'e.g. Colombia',
				description: 'Used if the contact has to be created',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'e.g. nathan@example.com',
				default: '',
			},
			{
				displayName: 'External ID',
				name: 'externalId',
				type: 'string',
				default: '',
				placeholder: 'e.g. customer-4821',
				description: 'ID of the contact in your own system',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				placeholder: 'e.g. Nathan Smith',
				description: 'Used if the contact has to be created',
			},
			{
				displayName: 'Phone',
				name: 'phone',
				type: 'string',
				default: '',
				placeholder: 'e.g. +573001234567',
				description: 'Phone number, preferably in international format',
			},
		],
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['send'] } },
		options: [
			{
				displayName: 'Company',
				name: 'group',
				type: 'fixedCollection',
				placeholder: 'Add Company',
				default: {},
				description: 'Company of the contact. The first event with a company ID creates it.',
				options: [
					{
						displayName: 'Company',
						name: 'values',
						values: [
							{
								displayName: 'Company ID',
								name: 'id',
								type: 'string',
								default: '',
								description: 'ID of the company in your own system',
							},
							{
								displayName: 'Company Name',
								name: 'name',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'Create Contact',
				name: 'createContact',
				type: 'boolean',
				default: true,
				description:
					'Whether to create the contact when none matches. Turn it off to add events only to existing contacts.',
			},
			{
				displayName: 'Currency',
				name: 'currency',
				type: 'string',
				default: '',
				placeholder: 'e.g. USD',
				description: 'ISO 4217 currency code of the value',
			},
			{
				displayName: 'Event ID',
				name: 'eventId',
				type: 'string',
				default: '',
				placeholder: 'e.g. order-10025',
				description:
					'Your unique ID for the event. Sending the same ID again does not duplicate it, so retries are safe.',
			},
			{
				displayName: 'Links',
				name: 'links',
				type: 'fixedCollection',
				placeholder: 'Add Link',
				default: {},
				typeOptions: { multipleValues: true },
				description: 'Up to 10 links to the same thing in your systems, such as the invoice',
				options: [
					{
						displayName: 'Link',
						name: 'link',
						values: [
							{
								displayName: 'URL',
								name: 'url',
								type: 'string',
								default: '',
								placeholder: 'e.g. https://billing.example.com/invoices/10025',
							},
							{
								displayName: 'Label',
								name: 'label',
								type: 'string',
								default: '',
								placeholder: 'e.g. Invoice 10025',
							},
						],
					},
				],
			},
			{
				displayName: 'Occurred At',
				name: 'occurredAt',
				type: 'dateTime',
				default: '',
				description: 'When it happened. Defaults to the time ContactShip receives it.',
			},
			{
				displayName: 'Parameters (JSON)',
				name: 'params',
				type: 'json',
				default: '{}',
				description: 'Anything you want to keep about the event, as a JSON object',
			},
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				default: '',
				placeholder: 'e.g. GA1.1.1234567890.1726000000',
				description:
					'ID of the visit, such as the Google Analytics client ID. Events with only a session ID wait until the visitor is identified.',
			},
			{
				displayName: 'Value',
				name: 'value',
				type: 'number',
				default: 0,
				description: 'Value of the event, such as the amount of a purchase',
			},
		],
	},
];

function buildEvent(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const event: IDataObject = {
		event_name: (this.getNodeParameter('eventName', itemIndex) as string).trim(),
	};

	const contactFields = this.getNodeParameter('contact', itemIndex, {}) as IDataObject;
	const contact: IDataObject = {};
	const contactMap: Record<string, string> = {
		contactId: 'contact_id',
		externalId: 'external_id',
		phone: 'phone',
		email: 'email',
		name: 'name',
		country: 'country',
	};
	for (const [parameter, apiField] of Object.entries(contactMap)) {
		const value = String(contactFields[parameter] ?? '').trim();
		if (value) contact[apiField] = value;
	}
	if (Object.keys(contact).length) event.contact = contact;

	const additionalFields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	if (additionalFields.eventId) event.event_id = String(additionalFields.eventId).trim();
	if (additionalFields.occurredAt) event.occurred_at = additionalFields.occurredAt;
	if (additionalFields.sessionId) event.session_id = String(additionalFields.sessionId).trim();
	if (additionalFields.createContact === false) event.create_contact = false;
	if (additionalFields.value !== undefined && additionalFields.value !== '') {
		event.value = Number(additionalFields.value);
	}
	if (additionalFields.currency)
		event.currency = String(additionalFields.currency).trim().toUpperCase();

	const params = parseJsonParameter.call(
		this,
		additionalFields.params,
		'Parameters (JSON)',
		itemIndex,
	);
	if (params && !Array.isArray(params) && Object.keys(params).length) event.params = params;

	const links =
		((additionalFields.links as IDataObject | undefined)?.link as IDataObject[] | undefined) ?? [];
	const cleanLinks = links
		.filter((link) => String(link.url ?? '').trim())
		.map((link) => {
			const entry: IDataObject = { url: String(link.url).trim() };
			if (link.label) entry.label = String(link.label);
			return entry;
		});
	if (cleanLinks.length) event.links = cleanLinks;

	const group = (additionalFields.group as IDataObject | undefined)?.values as
		| IDataObject
		| undefined;
	if (group?.id) {
		event.group = { id: String(group.id).trim(), ...(group.name ? { name: group.name } : {}) };
	}

	if (!event.contact && !event.session_id) {
		throw new NodeOperationError(this.getNode(), 'The event has no contact or session', {
			description:
				"Fill at least one field in 'Contact' (contact ID, external ID, phone or email), or add a 'Session ID'.",
			itemIndex,
		});
	}

	return event;
}

function failedItem(error: Error, itemIndex: number): INodeExecutionData {
	return { json: { error: error.message }, pairedItem: { item: itemIndex } };
}

/**
 * Sends one event per input item, grouped in requests of up to 100 events,
 * and returns the per-event result in the same order as the input.
 */
export async function executeEvents(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const output: Array<INodeExecutionData | undefined> = new Array(items.length);
	const pending: Array<{ itemIndex: number; event: IDataObject }> = [];

	for (let i = 0; i < items.length; i++) {
		try {
			pending.push({ itemIndex: i, event: buildEvent.call(this, i) });
		} catch (error) {
			if (this.continueOnFail()) {
				output[i] = failedItem(error as Error, i);
				continue;
			}
			throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
		}
	}

	for (let start = 0; start < pending.length; start += MAX_EVENTS_PER_REQUEST) {
		const batch = pending.slice(start, start + MAX_EVENTS_PER_REQUEST);
		let results: IDataObject[] = [];
		try {
			const response = await contactShipApiRequest.call(
				this,
				'POST',
				'/v1/events',
				{ events: batch.map((entry) => entry.event) },
				undefined,
				batch[0].itemIndex,
			);
			const data = (response.data as IDataObject | undefined) ?? {};
			results = Array.isArray(data.results) ? (data.results as IDataObject[]) : [];
		} catch (error) {
			if (this.continueOnFail()) {
				for (const entry of batch)
					output[entry.itemIndex] = failedItem(error as Error, entry.itemIndex);
				continue;
			}
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				itemIndex: batch[0].itemIndex,
			});
		}

		batch.forEach((entry, position) => {
			const result =
				results.find((candidate) => Number(candidate.index) === position) ??
				results[position] ??
				{};
			const status = String(result.status ?? '');
			if (status === 'invalid' || status === 'rejected') {
				const reasons = Array.isArray(result.errors)
					? (result.errors as string[]).join('; ')
					: String(result.reason ?? status);
				const error = new NodeOperationError(
					this.getNode(),
					`ContactShip did not store the event: ${reasons}`,
					{
						description:
							'Check the event name, the contact fields and the links. Other events in the same request were processed on their own.',
						itemIndex: entry.itemIndex,
					},
				);
				if (!this.continueOnFail()) throw error;
				output[entry.itemIndex] = {
					json: { ...result, error: error.message },
					pairedItem: { item: entry.itemIndex },
				};
				return;
			}
			output[entry.itemIndex] = { json: result, pairedItem: { item: entry.itemIndex } };
		});
	}

	return output.filter((entry): entry is INodeExecutionData => entry !== undefined);
}
