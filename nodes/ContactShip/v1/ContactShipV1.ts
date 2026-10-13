/**
 * Version 1 of the ContactShip node, kept for workflows created with package
 * versions 0.x. It returns the raw API response (including the `statusCode`
 * and `data` envelope) as one item, like those versions did.
 */
import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeBaseDescription,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { listSearch, loadOptions } from '../shared/methods';
import { contactShipApiRequest, isNodeApiError } from '../shared/transport';
import { v1Properties } from './description';

const E164 = /^\+[1-9]\d{1,14}$/;

function assertE164(
	this: IExecuteFunctions,
	phone: string,
	label: string,
	itemIndex: number,
): void {
	if (!E164.test(phone)) {
		throw new NodeOperationError(this.getNode(), `Invalid ${label} phone number format`, {
			description: 'Use E.164 format, for example +12124567890.',
			itemIndex,
		});
	}
}

function buildContactAdditionalData(
	this: IExecuteFunctions,
	fields: IDataObject,
	itemIndex: number,
): IDataObject[] {
	const additionalData: IDataObject[] = [];

	const properties =
		((fields.contactProperties as IDataObject | undefined)?.property as
			| IDataObject[]
			| undefined) ?? [];
	for (const property of properties) {
		if (!property.property || !property.value) continue;
		let definition: IDataObject;
		try {
			definition = JSON.parse(property.property as string) as IDataObject;
		} catch {
			throw new NodeOperationError(this.getNode(), 'A contact property could not be read', {
				description: "Choose the property again from the list in 'Contact Properties'.",
				itemIndex,
			});
		}
		additionalData.push({
			type: definition.type,
			field: definition.field,
			value: property.value,
			source: 'organization-property',
		});
	}

	const custom =
		((fields.additionalData as IDataObject | undefined)?.data as IDataObject[] | undefined) ?? [];
	for (const entry of custom) {
		additionalData.push({ type: entry.type, field: entry.field, value: entry.value });
	}

	return additionalData;
}

async function executeContactV1(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | undefined> {
	const contactPath = (suffix = '') =>
		`/v1/contacts/${encodeURIComponent(this.getNodeParameter('contactIdentifier', i) as string)}${suffix}`;

	switch (operation) {
		case 'create': {
			const phoneNumber = this.getNodeParameter('phoneNumber', i) as string;
			assertE164.call(this, phoneNumber, 'contact', i);
			const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
			const email = this.getNodeParameter('email', i, '') as string;
			const description = this.getNodeParameter('description', i, '') as string;
			const body: IDataObject = {
				full_name: this.getNodeParameter('fullName', i) as string,
				phone_number: phoneNumber,
				country: this.getNodeParameter('country', i) as string,
			};
			if (email) body.email = email;
			if (description) body.description = description;
			const additionalData = buildContactAdditionalData.call(this, additionalFields, i);
			if (additionalData.length) body.additional_data = additionalData;
			return await contactShipApiRequest.call(this, 'POST', '/v1/contacts', body, undefined, i);
		}
		case 'get':
			return await contactShipApiRequest.call(
				this,
				'GET',
				contactPath(),
				undefined,
				{
					identifierType: this.getNodeParameter('identifierType', i) as string,
				},
				i,
			);
		case 'getAll':
			return await contactShipApiRequest.call(
				this,
				'GET',
				'/v1/contacts',
				undefined,
				this.getNodeParameter('filters', i, {}) as IDataObject,
				i,
			);
		case 'update': {
			const updateFields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
			const body: IDataObject = {};
			if (updateFields.full_name) body.full_name = updateFields.full_name;
			if (updateFields.email) body.email = updateFields.email;
			if (updateFields.description) body.description = updateFields.description;
			const additionalData = buildContactAdditionalData.call(this, updateFields, i);
			if (additionalData.length) body.additional_data = additionalData;
			return await contactShipApiRequest.call(this, 'PATCH', contactPath(), body, undefined, i);
		}
		case 'delete':
			await contactShipApiRequest.call(this, 'DELETE', contactPath(), undefined, undefined, i);
			return { success: true };
		case 'getCallHistory':
			return await contactShipApiRequest.call(
				this,
				'GET',
				contactPath('/call-history'),
				undefined,
				this.getNodeParameter('callHistoryFilters', i, {}) as IDataObject,
				i,
			);
		case 'addComment': {
			const createdBy = this.getNodeParameter('createdBy', i) as string;
			const body: IDataObject = {
				content: this.getNodeParameter('content', i) as string,
				contact_id: this.getNodeParameter('contactIdentifier', i) as string,
			};
			if (createdBy) {
				body.created_by = createdBy;
				body.created_by_type = 'USER';
			} else {
				body.created_by_type = 'AUTOMATIZATION';
			}
			return await contactShipApiRequest.call(this, 'POST', '/v1/comments', body, undefined, i);
		}
		case 'getComments':
			return await contactShipApiRequest.call(
				this,
				'GET',
				contactPath('/comments'),
				undefined,
				undefined,
				i,
			);
		case 'getAllTags':
			return await contactShipApiRequest.call(
				this,
				'GET',
				'/v1/tags',
				undefined,
				this.getNodeParameter('options', i, {}) as IDataObject,
				i,
			);
		case 'addTagToContact':
		case 'removeTagFromContact': {
			const tagId = encodeURIComponent(this.getNodeParameter('tagId', i) as string);
			return await contactShipApiRequest.call(
				this,
				operation === 'addTagToContact' ? 'POST' : 'DELETE',
				contactPath(`/tags/${tagId}`),
				undefined,
				undefined,
				i,
			);
		}
		case 'getTagsByContact':
			return await contactShipApiRequest.call(
				this,
				'GET',
				contactPath('/tags'),
				undefined,
				undefined,
				i,
			);
		case 'getAllBoards':
			return await contactShipApiRequest.call(
				this,
				'GET',
				'/v1/board/list',
				undefined,
				{
					entityType: this.getNodeParameter('entityType', i, 'CONTACT') as string,
				},
				i,
			);
		case 'getBoardById': {
			const boardId = encodeURIComponent(this.getNodeParameter('boardId', i) as string);
			return await contactShipApiRequest.call(
				this,
				'GET',
				`/v1/board/${boardId}`,
				undefined,
				undefined,
				i,
			);
		}
		case 'addContactToBoard':
			return await contactShipApiRequest.call(
				this,
				'POST',
				'/v1/card',
				{
					order: this.getNodeParameter('order', i, '0') as string,
					entity_id: this.getNodeParameter('contactId', i) as string,
					stage_id: this.getNodeParameter('stageId', i) as string,
					entity_type: 'CONTACT',
				},
				undefined,
				i,
			);
		case 'moveContactInBoard':
			return await contactShipApiRequest.call(
				this,
				'PUT',
				'/v1/card/move',
				{
					id: this.getNodeParameter('cardId', i) as string,
					stage_id: this.getNodeParameter('stageId', i) as string,
					order: this.getNodeParameter('order', i, '0') as string,
				},
				undefined,
				i,
			);
		case 'getCardByContactId': {
			const boardId = encodeURIComponent(this.getNodeParameter('boardId', i) as string);
			const contactId = encodeURIComponent(this.getNodeParameter('contactId', i) as string);
			return await contactShipApiRequest.call(
				this,
				'GET',
				`/v1/board/${boardId}/contact/${contactId}`,
				undefined,
				undefined,
				i,
			);
		}
		default:
			return undefined;
	}
}

export class ContactShipV1 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = {
			...baseDescription,
			version: 1,
			defaults: {
				name: 'ContactShip',
			},
			usableAsTool: true,
			inputs: [NodeConnectionTypes.Main],
			outputs: [NodeConnectionTypes.Main],
			credentials: [
				{
					name: 'contactShipApi',
					required: true,
				},
			],
			properties: v1Properties,
		};
	}

	methods = {
		listSearch,
		loadOptions: {
			getAgents: loadOptions.getAgents,
			getPhoneNumbers: loadOptions.getPhoneNumbers,
			getTags: loadOptions.getTags,
			getBoards: loadOptions.getBoards,
			getBoardStages: loadOptions.getBoardStages,
			getContactProperties: loadOptions.getContactPropertiesV1,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;
			let responseData: IDataObject | undefined;

			try {
				if (resource === 'call' && operation === 'makeCall') {
					const fromNumber = this.getNodeParameter('fromNumber', i) as string;
					const toNumber = this.getNodeParameter('toNumber', i) as string;
					assertE164.call(this, fromNumber, '"from"', i);
					assertE164.call(this, toNumber, '"to"', i);
					const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
					const dataItems =
						((additionalFields.additionalData as IDataObject | undefined)?.data as
							| IDataObject[]
							| undefined) ?? [];
					const email = this.getNodeParameter('email', i, '') as string;
					const body: IDataObject = {
						agent_id: this.getNodeParameter('agentId', i) as string,
						from_number: fromNumber,
						to_number: toNumber,
						full_name: this.getNodeParameter('fullName', i) as string,
						country: this.getNodeParameter('country', i) as string,
					};
					if (email) body.email = email;
					if (dataItems.length) {
						body.additional_data = dataItems.map((entry) => ({
							key: entry.key,
							value: entry.value,
						}));
					}
					if (additionalFields.delay) body.delay = Number(additionalFields.delay);
					responseData = await contactShipApiRequest.call(
						this,
						'POST',
						'/v1/calls/single-phone-call',
						body,
						undefined,
						i,
					);
				} else if (resource === 'contact') {
					responseData = await executeContactV1.call(this, operation, i);
				} else if (resource === 'agent') {
					if (operation === 'getAll') {
						responseData = await contactShipApiRequest.call(
							this,
							'GET',
							'/v1/agents',
							undefined,
							undefined,
							i,
						);
					} else if (operation === 'get') {
						const agentId = encodeURIComponent(this.getNodeParameter('agentId', i) as string);
						responseData = await contactShipApiRequest.call(
							this,
							'GET',
							`/v1/agents/${agentId}`,
							undefined,
							undefined,
							i,
						);
					} else if (operation === 'update') {
						const agentId = encodeURIComponent(this.getNodeParameter('agentId', i) as string);
						const updateFields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
						const body: IDataObject = {};
						for (const key of [
							'name',
							'person_name',
							'voice_id',
							'language',
							'webhook_url',
							'conversation_purpose',
							'prompt',
							'voice_speed',
							'voice_temperature',
							'volume',
							'interruption_sensitivity',
						]) {
							if (updateFields[key]) body[key] = updateFields[key];
						}
						if (updateFields.ambient_sound) {
							body.ambient_sound =
								updateFields.ambient_sound === 'null' ? null : updateFields.ambient_sound;
						}
						responseData = await contactShipApiRequest.call(
							this,
							'PUT',
							`/v1/agents/${agentId}`,
							body,
							undefined,
							i,
						);
					}
				} else if (resource === 'credits' && operation === 'get') {
					responseData = await contactShipApiRequest.call(
						this,
						'GET',
						'/v1/credits',
						undefined,
						undefined,
						i,
					);
				} else if (resource === 'phoneNumber' && operation === 'getAll') {
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const response = await contactShipApiRequest.call(
						this,
						'GET',
						'/v1/phone-numbers',
						undefined,
						{
							limit: options.limit || 20,
							offset: options.offset || 0,
							order: options.order || 'desc',
						},
						i,
					);
					responseData = Array.isArray(response.data)
						? {
								data: (response.data as IDataObject[]).map((phone) => ({
									id: phone.id,
									phone_number: phone.phone_number,
									alias: phone.alias,
									type: phone.type,
									created_at: phone.created_at,
								})),
								pagination: response.pagination,
							}
						: response;
				}

				if (responseData === undefined) {
					throw new NodeOperationError(
						this.getNode(),
						`The operation '${operation}' is not supported for '${resource}'`,
						{ itemIndex: i },
					);
				}

				returnData.push({ json: responseData, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (isNodeApiError(error)) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
