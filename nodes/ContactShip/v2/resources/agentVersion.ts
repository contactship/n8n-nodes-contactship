import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { contactShipApiRequest } from '../../shared/transport';
import {
	extractList,
	getIdParameter,
	simplifyAgentVersion,
	toExecutionData,
	unwrap,
} from '../../shared/utils';
import { agentConfigFields, assertSomethingToUpdate, readAgentConfig } from './agent';
import type { ResourceHandler } from './common';
import { agentLocator, limitField, returnAllField, simplifyField } from './common';

const RESOURCE = 'agentVersion';

function versionLocator(
	name: string,
	displayName: string,
	description: string,
	searchListMethod: string,
	operations: string[],
	required: boolean,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'resourceLocator',
		required,
		default: { mode: 'list', value: '' },
		description,
		displayOptions: { show: { resource: [RESOURCE], operation: operations } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod, searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e',
			},
		],
	};
}

export const agentVersionOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Get Draft',
				value: 'getDraft',
				description: 'Retrieve the open draft of an agent: changes that are not live yet',
				action: 'Get agent draft',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve the version history of an agent: draft, published and archived',
				action: 'Get many agent versions',
			},
			{
				name: 'Get Published',
				value: 'getPublished',
				description: 'Retrieve the version that is live for calls',
				action: 'Get published agent version',
			},
			{
				name: 'Open Draft',
				value: 'openDraft',
				description:
					'Open a draft from the published version, or return the draft that is already open',
				action: 'Open agent draft',
			},
			{
				name: 'Publish',
				value: 'publish',
				description: 'Publish the draft, or a given version, so it is live for calls',
				action: 'Publish agent version',
			},
			{
				name: 'Rollback',
				value: 'rollback',
				description: 'Publish an archived version again, as a new version',
				action: 'Roll back agent version',
			},
			{
				name: 'Update Draft',
				value: 'updateDraft',
				description: 'Change the draft of an agent without publishing it',
				action: 'Update agent draft',
			},
		],
		default: 'getAll',
	},
];

export const agentVersionFields: INodeProperties[] = [
	agentLocator(RESOURCE, [
		'getAll',
		'getDraft',
		'getPublished',
		'openDraft',
		'publish',
		'rollback',
		'updateDraft',
	]),

	// Get Many
	returnAllField(RESOURCE, 'getAll'),
	limitField(RESOURCE, 'getAll'),
	simplifyField(RESOURCE, ['getAll']),

	// Update Draft
	{
		displayName:
			'Changes go to the draft and are not live until you publish them. If no draft is open, one is opened from the published version. Booking tools cannot be staged in a draft.',
		name: 'draftNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RESOURCE], operation: ['updateDraft'] } },
	},
	...agentConfigFields(RESOURCE, 'updateDraft', 'update'),

	// Publish
	{
		displayName: 'Publishing makes the version live for new calls right away.',
		name: 'publishVersionNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RESOURCE], operation: ['publish', 'rollback'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: [RESOURCE], operation: ['publish'] } },
		options: [
			{
				displayName: 'Changelog',
				name: 'changelog',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				placeholder: 'e.g. Shorter greeting and a new transfer to sales',
				description:
					'What changed, up to 500 characters. It is shown next to the version number in the history.',
			},
		],
	},
	versionLocator(
		'versionId',
		'Version',
		'Version to publish. Leave empty to publish the open draft.',
		'searchAgentVersions',
		['publish'],
		false,
	),

	// Rollback
	versionLocator(
		'versionId',
		'Version',
		'Archived version to bring back. It is published again as a new version, so the history keeps every step.',
		'searchArchivedAgentVersions',
		['rollback'],
		true,
	),
];

export const executeAgentVersion: ResourceHandler = async function (this, operation, i) {
	const agentId = encodeURIComponent(getIdParameter.call(this, 'agentId', i, 'Agent'));
	const base = `/v1/agents/${agentId}/versions`;

	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
		const simplify = this.getNodeParameter('simplify', i, true) as boolean;
		const response = await contactShipApiRequest.call(this, 'GET', base, undefined, undefined, i);
		let versions = extractList(response).sort(
			(a, b) => Number(b.version_number ?? 0) - Number(a.version_number ?? 0),
		);
		if (!returnAll) versions = versions.slice(0, limit);
		return toExecutionData.call(this, simplify ? versions.map(simplifyAgentVersion) : versions, i);
	}

	if (operation === 'getDraft' || operation === 'getPublished') {
		const suffix = operation === 'getDraft' ? 'draft' : 'published';
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			`${base}/${suffix}`,
			undefined,
			undefined,
			i,
		);
		const version = unwrap(response);
		if (!version || typeof version !== 'object') {
			return toExecutionData.call(
				this,
				{ agent_id: decodeURIComponent(agentId), [suffix]: null },
				i,
			);
		}
		return toExecutionData.call(this, version, i);
	}

	if (operation === 'openDraft') {
		const response = await contactShipApiRequest.call(
			this,
			'POST',
			`${base}/draft`,
			undefined,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'updateDraft') {
		const body = readAgentConfig.call(this, i, 'updateFields');
		assertSomethingToUpdate.call(this, body, i);
		// Opening is idempotent: it returns the draft that is already open.
		await contactShipApiRequest.call(this, 'POST', `${base}/draft`, undefined, undefined, i);
		const response = await contactShipApiRequest.call(
			this,
			'PATCH',
			`${base}/draft`,
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'publish') {
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const body: IDataObject = {};
		const changelog = String(options.changelog ?? '').trim();
		if (changelog) body.changelog = changelog;
		const versionId = String(
			this.getNodeParameter('versionId', i, '', { extractValue: true }) ?? '',
		).trim();
		if (versionId) body.version_id = versionId;
		const response = await contactShipApiRequest.call(
			this,
			'POST',
			`${base}/publish`,
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	if (operation === 'rollback') {
		const body: IDataObject = { version_id: getIdParameter.call(this, 'versionId', i, 'Version') };
		const response = await contactShipApiRequest.call(
			this,
			'POST',
			`${base}/rollback`,
			body,
			undefined,
			i,
		);
		return toExecutionData.call(this, unwrap(response), i);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation '${operation}' is not supported for agent versions`,
		{ itemIndex: i },
	);
};
