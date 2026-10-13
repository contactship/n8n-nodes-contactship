import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest } from '../../shared/transport';
import { extractList, getIdParameter, toExecutionData, unwrap } from '../../shared/utils';
import type { ResourceHandler } from './common';
import { limitField, returnAllField } from './common';

const RESOURCE = 'voice';

export const voiceOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve a voice by ID',
				action: 'Get voice',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve the voices available for voice agents',
				action: 'Get many voices',
			},
		],
		default: 'getAll',
	},
];

export const voiceFields: INodeProperties[] = [
	{
		displayName: 'Voice',
		name: 'voiceId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		displayOptions: { show: { resource: [RESOURCE], operation: ['get'] } },
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
				displayName: 'Gender',
				name: 'gender',
				type: 'string',
				default: '',
				placeholder: 'e.g. female',
				description: 'Voices whose gender contains this text',
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'string',
				default: '',
				placeholder: 'e.g. Spanish',
				description: 'Voices whose language contains this text',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				placeholder: 'e.g. warm',
				description: 'Voices whose name, accent or description contains this text',
			},
		],
	},
];

function contains(value: unknown, needle: unknown): boolean {
	const text = String(needle ?? '')
		.trim()
		.toLowerCase();
	return (
		!text ||
		String(value ?? '')
			.toLowerCase()
			.includes(text)
	);
}

export const executeVoice: ResourceHandler = async function (this, operation, i) {
	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			'/v1/agents/voices',
			undefined,
			undefined,
			i,
		);
		let voices = extractList(response).filter(
			(voice) =>
				contains(voice.gender, filters.gender) &&
				contains(voice.language, filters.language) &&
				(contains(voice.name, filters.search) ||
					contains(voice.accent, filters.search) ||
					contains(voice.description, filters.search)),
		);
		if (!returnAll) voices = voices.slice(0, limit);
		return toExecutionData.call(this, voices, i);
	}

	if (operation === 'get') {
		const voiceId = encodeURIComponent(getIdParameter.call(this, 'voiceId', i, 'Voice'));
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`/v1/agents/voices/${voiceId}`,
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for voices`,
		{ itemIndex: i },
	);
};
