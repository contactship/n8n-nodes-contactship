import type {
	FieldType,
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
	INodePropertyOptions,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';

import { contactShipApiRequest, contactShipApiRequestAllItems } from './transport';
import { extractList, phoneCountry, unwrap } from './utils';
import {
	fetchChannelTemplates,
	findTemplate,
	isApproved,
	parseTemplateValue,
	templateFields,
	templateValue,
} from './whatsappTemplates';

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
	return extractList(response).filter(
		(channel) => String(channel.type ?? '').toUpperCase() === 'WABA' && !channel.deleted_at,
	);
}

/**
 * When a list has nothing to choose from, shows one entry that says why
 * instead of an empty dropdown. Picking it leaves the value empty, and the
 * node then asks for a value when it runs.
 */
function withEmptyHint(
	results: INodeListSearchItems[],
	filter: string | undefined,
	hint: string,
): INodeListSearchResult {
	if (results.length || filter) return { results };
	return { results: [hintOption(hint)] };
}

function hintOption(hint: string): INodePropertyOptions {
	return { name: hint, value: '' };
}

function optionsOrHint(options: INodePropertyOptions[], hint: string): INodePropertyOptions[] {
	return options.length ? options : [hintOption(hint)];
}

/** Native variables ContactShip fills itself; they are not asked for per call. */
const NATIVE_AGENT_VARIABLES = new Set([
	'call_history',
	'contact_data',
	'contact_info',
	'contact_name',
	'contact_properties',
	'current_day_time',
	'current_time',
	'language',
	'last_transcript',
	'timezone',
]);

const PROMPT_VARIABLE = /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g;

function phoneLabelWithCountry(phone: IDataObject): string {
	const country = phoneCountry(phone.phone_number);
	const details = [country, phone.alias, phone.type].filter(Boolean).join(', ');
	return details ? `${String(phone.phone_number)} (${details})` : String(phone.phone_number);
}

function channelLabel(channel: IDataObject): string {
	const status = String(channel.status ?? '').toLowerCase();
	const details = [
		channel.provider_display_value,
		status && !['active', 'connected'].includes(status) ? status : undefined,
	].filter(Boolean);
	const name = String(channel.name ?? channel.id);
	return details.length ? `${name} (${details.join(', ')})` : name;
}

function userLabel(user: IDataObject): string {
	const name = String(user.full_name || user.username || '').trim();
	if (name && user.email) return `${name} (${String(user.email)})`;
	return String(name || user.email || user.id);
}

function voiceLabel(voice: IDataObject): string {
	const details = [voice.gender, voice.accent, voice.language].filter(Boolean).join(', ');
	const name = String(voice.name || voice.id);
	return details ? `${name} (${details})` : name;
}

function versionLabel(version: IDataObject): string {
	const changelog = String(version.changelog ?? '').trim();
	const label = `Version ${String(version.version_number)} (${String(version.status)})`;
	return changelog
		? `${label}: ${changelog.length > 60 ? `${changelog.slice(0, 60)}…` : changelog}`
		: label;
}

async function fetchUsers(this: ILoadOptionsFunctions): Promise<IDataObject[]> {
	const response = await contactShipApiRequest.call(this, 'GET', '/v1/organization/users');
	return extractList(response);
}

async function fetchVoices(this: ILoadOptionsFunctions): Promise<IDataObject[]> {
	const response = await contactShipApiRequest.call(this, 'GET', '/v1/agents/voices');
	return extractList(response);
}

async function fetchAgentVersions(this: ILoadOptionsFunctions): Promise<IDataObject[] | undefined> {
	const agentId = getCurrentId.call(this, 'agentId');
	if (!agentId) return undefined;
	const response = await contactShipApiRequest.call(
		this,
		'GET',
		`/v1/agents/${encodeURIComponent(agentId)}/versions`,
	);
	return extractList(response).sort(
		(a, b) => Number(b.version_number ?? 0) - Number(a.version_number ?? 0),
	);
}

async function searchVersions(
	this: ILoadOptionsFunctions,
	filter: string | undefined,
	onlyArchived: boolean,
): Promise<INodeListSearchResult> {
	const versions = await fetchAgentVersions.call(this);
	if (!versions) return { results: [hintOption('Choose an agent first')] };
	const results = versions
		.filter((version) => !onlyArchived || String(version.status) === 'archived')
		.filter((version) =>
			matches(filter, version.version_number, version.changelog, version.status, version.id),
		)
		.map((version) => ({ name: versionLabel(version), value: String(version.id) }));
	return withEmptyHint(
		results,
		filter,
		onlyArchived
			? 'This agent has no archived versions to roll back to'
			: 'This agent has no versions yet',
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
		return withEmptyHint(results, filter, 'No voice agents yet. Create one in ContactShip first.');
	},

	async searchPhoneNumbers(
		this: ILoadOptionsFunctions,
		filter?: string,
	): Promise<INodeListSearchResult> {
		const phones = await fetchPhoneNumbers.call(this);
		const results: INodeListSearchItems[] = phones
			.filter((phone) => matches(filter, phone.phone_number, phone.alias))
			.map((phone) => ({ name: phoneLabelWithCountry(phone), value: String(phone.phone_number) }));
		return withEmptyHint(results, filter, 'No phone numbers in this organization yet');
	},

	async searchPhoneNumberIds(
		this: ILoadOptionsFunctions,
		filter?: string,
	): Promise<INodeListSearchResult> {
		const phones = await fetchPhoneNumbers.call(this);
		const results: INodeListSearchItems[] = phones
			.filter((phone) => matches(filter, phone.phone_number, phone.alias, phone.id))
			.map((phone) => ({ name: phoneLabelWithCountry(phone), value: String(phone.id) }));
		return withEmptyHint(results, filter, 'No phone numbers in this organization yet');
	},

	async searchBoards(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		const boards = await fetchBoards.call(this);
		const results: INodeListSearchItems[] = boards
			.filter((board) => matches(filter, board.name, board.id))
			.map((board) => ({ name: String(board.name ?? board.id), value: String(board.id) }))
			.sort(byName);
		return withEmptyHint(
			results,
			filter,
			'No contact boards yet. Create one in ContactShip first.',
		);
	},

	async searchTags(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		const tags = await fetchTags.call(this);
		const results: INodeListSearchItems[] = tags
			.filter((tag) => matches(filter, tag.label, tag.name, tag.id))
			.map((tag) => ({ name: String(tag.label || tag.name || tag.id), value: String(tag.id) }))
			.sort(byName);
		return withEmptyHint(results, filter, 'No tags yet. Create one with Tag → Create.');
	},

	async searchWhatsAppChannels(
		this: ILoadOptionsFunctions,
		filter?: string,
	): Promise<INodeListSearchResult> {
		const channels = await fetchWhatsAppChannels.call(this);
		const results: INodeListSearchItems[] = channels
			.filter((channel) =>
				matches(filter, channel.name, channel.provider_display_value, channel.id),
			)
			.map((channel) => ({ name: channelLabel(channel), value: String(channel.id) }))
			.sort(byName);
		return withEmptyHint(
			results,
			filter,
			'No WhatsApp channels. Connect a WhatsApp Business number in ContactShip first.',
		);
	},

	async searchContacts(
		this: ILoadOptionsFunctions,
		filter?: string,
		paginationToken?: string,
	): Promise<INodeListSearchResult> {
		const pageSize = 50;
		const offset = Number(paginationToken) || 0;
		const qs: IDataObject = { limit: pageSize, offset, order: 'desc' };
		const term = String(filter ?? '').trim();
		if (term.includes('@')) qs.email = term;
		else if (/^\+?[\d\s().-]{4,}$/.test(term)) qs.phone_number = term.replace(/[\s().-]/g, '');
		else if (term) qs.full_name = term;
		const response = await contactShipApiRequest.call(this, 'GET', '/v1/contacts', undefined, qs);
		const contacts = extractList(response);
		const results: INodeListSearchItems[] = contacts.map((contact) => {
			const name = String(contact.full_name || contact.email || contact.id);
			return {
				name: contact.phone_number ? `${name} (${String(contact.phone_number)})` : name,
				value: String(contact.id),
			};
		});
		const next = contacts.length === pageSize ? String(offset + pageSize) : undefined;
		if (offset > 0) return { results, paginationToken: next };
		return {
			...withEmptyHint(results, term, 'No contacts yet. Create one with Contact → Create.'),
			paginationToken: next,
		};
	},

	async searchUsers(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		const users = await fetchUsers.call(this);
		const results: INodeListSearchItems[] = users
			.filter((user) => matches(filter, user.full_name, user.email, user.username, user.id))
			.map((user) => ({ name: userLabel(user), value: String(user.id) }))
			.sort(byName);
		return withEmptyHint(results, filter, 'No members found in this organization');
	},

	async searchUserEmails(
		this: ILoadOptionsFunctions,
		filter?: string,
	): Promise<INodeListSearchResult> {
		const users = await fetchUsers.call(this);
		const results: INodeListSearchItems[] = users
			.filter((user) => user.email && matches(filter, user.full_name, user.email, user.username))
			.map((user) => ({ name: userLabel(user), value: String(user.email) }))
			.sort(byName);
		return withEmptyHint(results, filter, 'No members found in this organization');
	},

	async searchVoices(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		const voices = await fetchVoices.call(this);
		const results: INodeListSearchItems[] = voices
			.filter((voice) =>
				matches(
					filter,
					voice.name,
					voice.gender,
					voice.accent,
					voice.language,
					voice.description,
					voice.id,
				),
			)
			.map((voice) => ({ name: voiceLabel(voice), value: String(voice.id) }))
			.sort(byName);
		return withEmptyHint(results, filter, 'No voices available');
	},

	async searchAgentVersions(
		this: ILoadOptionsFunctions,
		filter?: string,
	): Promise<INodeListSearchResult> {
		return await searchVersions.call(this, filter, false);
	},

	async searchArchivedAgentVersions(
		this: ILoadOptionsFunctions,
		filter?: string,
	): Promise<INodeListSearchResult> {
		return await searchVersions.call(this, filter, true);
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
		if (!channelId) return [hintOption('Choose a WhatsApp channel first')];
		const templates = await fetchChannelTemplates.call(this, channelId, { returnAll: true });
		const options = templates
			.filter(isApproved)
			.map((template) => ({
				name: template.language
					? `${String(template.name)} (${String(template.language)})`
					: String(template.name),
				value: templateValue(template),
				description: template.category ? String(template.category) : undefined,
			}))
			.sort(byName);
		return optionsOrHint(
			options,
			'No approved templates in this channel. Create one in ContactShip and wait for Meta to approve it.',
		);
	},

	/** Stages of the selected board, with a hint when the board has none (node version 2). */
	async getStages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const boardId = getCurrentId.call(this, 'boardId');
		if (!boardId) return [hintOption('Choose a board first')];
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`/v1/board/${encodeURIComponent(boardId)}`,
		);
		const board = (unwrap(response) as IDataObject | undefined) ?? {};
		const stages = Array.isArray(board.stages) ? (board.stages as IDataObject[]) : [];
		return optionsOrHint(
			stages
				.slice()
				.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
				.map((stage) => ({ name: String(stage.name ?? stage.id), value: String(stage.id) })),
			'This board has no stages yet',
		);
	},

	async getVoices(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const voices = await fetchVoices.call(this);
		return optionsOrHint(
			voices
				.map((voice) => ({
					name: voiceLabel(voice),
					value: String(voice.id),
					description: voice.description ? String(voice.description) : undefined,
				}))
				.sort(byName),
			'No voices available',
		);
	},

	async getUserEmails(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const users = await fetchUsers.call(this);
		return optionsOrHint(
			users
				.filter((user) => user.email)
				.map((user) => ({ name: userLabel(user), value: String(user.email) }))
				.sort(byName),
			'No members found in this organization',
		);
	},

	/** Contact properties with the value format used by node version 1. */
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

function mapperNotice(emptyFieldsNotice: string): ResourceMapperFields {
	return { fields: [], emptyFieldsNotice };
}

/**
 * Field type for a contact property. ContactShip properties are text, user,
 * calendar, location, number or boolean; any property with options is a select.
 */
function contactPropertyFieldType(property: IDataObject): FieldType {
	if (Array.isArray(property.options) && property.options.length) return 'options';
	switch (String(property.type ?? '').toLowerCase()) {
		case 'number':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'calendar':
		case 'date':
			return 'dateTime';
		default:
			return 'string';
	}
}

export const resourceMapping = {
	/** One field per variable of the selected WhatsApp template. */
	async getTemplateFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
		const channelId = getCurrentId.call(this, 'channelId');
		const rawTemplate = String(this.getCurrentNodeParameter('templateName') ?? '').trim();
		if (!channelId || !rawTemplate) {
			return mapperNotice('Choose a channel and a template to fill in its variables.');
		}
		if (rawTemplate.startsWith('=')) {
			return mapperNotice(
				"The template is set with an expression, so its variables cannot be listed here. Choose 'Using JSON' in 'Variables' to send them.",
			);
		}
		const reference = parseTemplateValue(rawTemplate);
		const templates = await fetchChannelTemplates.call(this, channelId, { returnAll: true });
		const { template, languages } = findTemplate(templates, reference);
		if (!template) {
			return mapperNotice(
				languages.length > 1
					? `The template '${reference.name}' exists in several languages. Choose it again from the list to pick one.`
					: `The template '${reference.name}' is not among the approved templates of this channel.`,
			);
		}
		const fields = templateFields(template);
		return fields.length
			? { fields }
			: mapperNotice('This template has no variables. It is sent as it is.');
	},

	/** One field per {{variable}} in the prompt of the selected voice agent. */
	async getAgentVariables(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
		const agentId = getCurrentId.call(this, 'agentId');
		if (!agentId) {
			return mapperNotice('Choose an agent to fill in the {{variables}} of its prompt.');
		}
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`/v1/agents/${encodeURIComponent(agentId)}`,
		);
		const agent = (unwrap(response) as IDataObject | undefined) ?? {};
		const names: string[] = [];
		for (const text of [agent.prompt, agent.begin_message, agent.conversation_purpose]) {
			if (typeof text !== 'string') continue;
			for (const match of text.matchAll(PROMPT_VARIABLE)) {
				const name = match[1];
				if (!NATIVE_AGENT_VARIABLES.has(name.toLowerCase()) && !names.includes(name)) {
					names.push(name);
				}
			}
		}
		if (!names.length) {
			return mapperNotice(
				"This agent's prompt has no {{variables}} to fill. Add any extra context in 'Additional Fields → Extra Variables'.",
			);
		}
		const fields: ResourceMapperField[] = names.map((name) => ({
			id: name,
			displayName: name,
			required: false,
			defaultMatch: false,
			display: true,
			type: 'string',
			canBeUsedToMatch: false,
		}));
		return { fields };
	},

	/** One field per contact property defined in the organization. */
	async getContactPropertyFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			'/v1/organization/contact-properties',
		);
		const data = (unwrap(response) as IDataObject | undefined) ?? {};
		const properties = Array.isArray(data.properties) ? (data.properties as IDataObject[]) : [];
		if (!properties.length) {
			return mapperNotice(
				"Your organization has no contact properties yet. Define them in ContactShip, or use 'Custom Properties'.",
			);
		}
		const fields: ResourceMapperField[] = properties
			.slice()
			.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
			.map((property) => {
				const type = contactPropertyFieldType(property);
				const options =
					type === 'options'
						? (property.options as IDataObject[]).map((option) =>
								typeof option === 'object' && option !== null
									? {
											name: String(option.label ?? option.value),
											value: String(option.value ?? option.label),
										}
									: { name: String(option), value: String(option) },
							)
						: undefined;
				const label = String(property.label || property.field);
				const kind = String(property.type ?? '').toLowerCase();
				let displayName = label;
				if (kind === 'user' && type !== 'options') displayName = `${label} (member ID)`;
				if (kind === 'location' && type !== 'options') displayName = `${label} (address)`;
				return {
					id: String(property.field),
					displayName,
					required: false,
					defaultMatch: false,
					display: true,
					type,
					options,
					canBeUsedToMatch: false,
				};
			});
		return { fields };
	},
};
