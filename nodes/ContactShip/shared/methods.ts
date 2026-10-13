import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest, contactShipApiRequestAllItems } from './transport';

const MAX_LIST_ITEMS = 1000;

function matches(filter: string | undefined, ...values: unknown[]): boolean {
	if (!filter) return true;
	const needle = filter.toLowerCase();
	return values.some((value) =>
		String(value ?? '')
			.toLowerCase()
			.includes(needle),
	);
}

function byName<T extends { name: string }>(a: T, b: T): number {
	return a.name.localeCompare(b.name);
}

function getCurrentId(this: ILoadOptionsFunctions, name: string): string {
	const value = this.getCurrentNodeParameter(name, { extractValue: true }) as unknown;
	return String(value ?? '').trim();
}

async function fetchAgents(this: ILoadOptionsFunctions): Promise<IDataObject[]> {
	const response = await contactShipApiRequest.call(this, 'GET', '/v1/agents');
	return Array.isArray(response.data) ? (response.data as IDataObject[]) : [];
}

async function fetchPhoneNumbers(this: ILoadOptionsFunctions): Promise<IDataObject[]> {
	return await contactShipApiRequestAllItems.call(
		this,
		'/v1/phone-numbers',
		{ order: 'desc' },
		{ returnAll: false, limit: MAX_LIST_ITEMS, pageSize: 100 },
	);
}

async function fetchBoards(this: ILoadOptionsFunctions): Promise<IDataObject[]> {
	const response = await contactShipApiRequest.call(this, 'GET', '/v1/board/list', undefined, {
		entityType: 'CONTACT',
	});
	return Array.isArray(response.data) ? (response.data as IDataObject[]) : [];
}

async function fetchTags(this: ILoadOptionsFunctions): Promise<IDataObject[]> {
	return await contactShipApiRequestAllItems.call(
		this,
		'/v1/tags',
		{ order: 'desc' },
		{ returnAll: false, limit: MAX_LIST_ITEMS, pageSize: 100 },
	);
}

async function fetchWhatsAppChannels(this: ILoadOptionsFunctions): Promise<IDataObject[]> {
	const response = await contactShipApiRequest.call(this, 'GET', '/v1/channels', undefined, {
		type: 'WABA',
		limit: 100,
		offset: 0,
		order: 'desc',
	});
	const channels = Array.isArray(response.data) ? (response.data as IDataObject[]) : [];
	return channels.filter(
		(channel) => !channel.type || String(channel.type).toUpperCase() === 'WABA',
	);
}

function phoneLabel(phone: IDataObject): string {
	const parts = [phone.alias, phone.type].filter(Boolean).join(', ');
	return parts ? `${String(phone.phone_number)} (${parts})` : String(phone.phone_number);
}

export const listSearch = {
	async searchAgents(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		const agents = await fetchAgents.call(this);
		const results: INodeListSearchItems[] = agents
			.filter((agent) => matches(filter, agent.name, agent.person_name, agent.id))
			.map((agent) => ({
				name: String(agent.name || agent.person_name || agent.id),
				value: String(agent.id),
			}))
			.sort(byName);
		return { results };
	},

	async searchPhoneNumbers(
		this: ILoadOptionsFunctions,
		filter?: string,
	): Promise<INodeListSearchResult> {
		const phones = await fetchPhoneNumbers.call(this);
		const results: INodeListSearchItems[] = phones
			.filter((phone) => matches(filter, phone.phone_number, phone.alias))
			.map((phone) => ({ name: phoneLabel(phone), value: String(phone.phone_number) }));
		return { results };
	},

	async searchPhoneNumberIds(
		this: ILoadOptionsFunctions,
		filter?: string,
	): Promise<INodeListSearchResult> {
		const phones = await fetchPhoneNumbers.call(this);
		const results: INodeListSearchItems[] = phones
			.filter((phone) => matches(filter, phone.phone_number, phone.alias, phone.id))
			.map((phone) => ({ name: phoneLabel(phone), value: String(phone.id) }));
		return { results };
	},

	async searchBoards(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		const boards = await fetchBoards.call(this);
		const results: INodeListSearchItems[] = boards
			.filter((board) => matches(filter, board.name, board.id))
			.map((board) => ({ name: String(board.name ?? board.id), value: String(board.id) }))
			.sort(byName);
		return { results };
	},

	async searchTags(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		const tags = await fetchTags.call(this);
		const results: INodeListSearchItems[] = tags
			.filter((tag) => matches(filter, tag.label, tag.name, tag.id))
			.map((tag) => ({ name: String(tag.label || tag.name || tag.id), value: String(tag.id) }))
			.sort(byName);
		return { results };
	},

	async searchWhatsAppChannels(
		this: ILoadOptionsFunctions,
		filter?: string,
	): Promise<INodeListSearchResult> {
		const channels = await fetchWhatsAppChannels.call(this);
		const results: INodeListSearchItems[] = channels
			.filter((channel) => matches(filter, channel.name, channel.id))
			.map((channel) => ({ name: String(channel.name ?? channel.id), value: String(channel.id) }))
			.sort(byName);
		return { results };
	},
};

export const loadOptions = {
	async getAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const agents = await fetchAgents.call(this);
		return agents
			.map((agent) => ({
				name: String(agent.name || agent.person_name || agent.id),
				value: String(agent.id),
				description: agent.conversation_purpose ? String(agent.conversation_purpose) : undefined,
			}))
			.sort(byName);
	},

	async getPhoneNumbers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const phones = await fetchPhoneNumbers.call(this);
		return phones.map((phone) => ({ name: phoneLabel(phone), value: String(phone.phone_number) }));
	},

	async getTags(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const tags = await fetchTags.call(this);
		return tags
			.map((tag) => ({ name: String(tag.label || tag.name || tag.id), value: String(tag.id) }))
			.sort(byName);
	},

	async getBoards(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const boards = await fetchBoards.call(this);
		return boards
			.map((board) => ({ name: String(board.name ?? board.id), value: String(board.id) }))
			.sort(byName);
	},

	async getBoardStages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const boardId = getCurrentId.call(this, 'boardId');
		if (!boardId) return [];
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`/v1/board/${encodeURIComponent(boardId)}`,
		);
		const board = (response.data as IDataObject | undefined) ?? {};
		const stages = Array.isArray(board.stages) ? (board.stages as IDataObject[]) : [];
		return stages
			.slice()
			.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
			.map((stage) => ({ name: String(stage.name ?? stage.id), value: String(stage.id) }));
	},

	async getWhatsAppTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const channelId = getCurrentId.call(this, 'channelId');
		if (!channelId) {
			throw new NodeOperationError(this.getNode(), 'Choose a WhatsApp channel first', {
				description: "Select a channel in 'Channel' to list its approved templates.",
			});
		}
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			'/v1/waba/templates',
			undefined,
			{
				channel_id: channelId,
				limit: 100,
			},
		);
		const templates = Array.isArray(response.data) ? (response.data as IDataObject[]) : [];
		return templates
			.filter(
				(template) => !template.status || String(template.status).toUpperCase() === 'APPROVED',
			)
			.map((template) => ({
				name: template.language
					? `${String(template.name)} (${String(template.language)})`
					: String(template.name),
				value: String(template.name),
				description: template.category ? String(template.category) : undefined,
			}))
			.sort(byName);
	},

	async getContactProperties(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			'/v1/organization/contact-properties',
		);
		const data = (response.data as IDataObject | undefined) ?? {};
		const properties = Array.isArray(data.properties) ? (data.properties as IDataObject[]) : [];
		return properties.map((property) => ({
			name: String(property.label || property.field),
			value: String(property.field),
			description: `Type: ${String(property.type)}`,
		}));
	},

	/** Same list as getContactProperties, with the value format used by node version 1. */
	async getContactPropertiesV1(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			'/v1/organization/contact-properties',
		);
		const data = (response.data as IDataObject | undefined) ?? {};
		const properties = Array.isArray(data.properties) ? (data.properties as IDataObject[]) : [];
		return properties.map((property) => {
			let description = `Type: ${String(property.type)}`;
			if (property.type === 'select' && Array.isArray(property.options)) {
				const labels = (property.options as IDataObject[]).map((option) => option.label).join(', ');
				description += ` (Options: ${labels})`;
			}
			return {
				name: String(property.label || property.field),
				value: JSON.stringify({ field: property.field, type: property.type }),
				description,
			};
		});
	},
};
