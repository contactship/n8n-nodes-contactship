import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeBaseDescription,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { listSearch, loadOptions } from '../shared/methods';
import { isNodeApiError } from '../shared/transport';
import {
	creditsOperations,
	executeCredits,
	executePhoneNumber,
	phoneNumberFields,
	phoneNumberOperations,
} from './resources/account';
import { agentFields, agentOperations, executeAgent } from './resources/agent';
import { boardFields, boardOperations, executeBoard } from './resources/board';
import { callFields, callOperations, executeCall } from './resources/call';
import type { ExecutionCache, ResourceHandler } from './resources/common';
import { contactFields, contactOperations, executeContact } from './resources/contact';
import { eventFields, eventOperations, executeEvents } from './resources/event';
import { executeTag, tagFields, tagOperations } from './resources/tag';
import { executeTask, taskFields, taskOperations } from './resources/task';
import { executeWhatsApp, whatsappFields, whatsappOperations } from './resources/whatsapp';

const HANDLERS: Record<string, ResourceHandler> = {
	agent: executeAgent,
	board: executeBoard,
	call: executeCall,
	contact: executeContact,
	credits: executeCredits,
	phoneNumber: executePhoneNumber,
	tag: executeTag,
	task: executeTask,
	whatsapp: executeWhatsApp,
};

export class ContactShipV2 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = {
			...baseDescription,
			version: 2,
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
			properties: [
				{
					displayName: 'Resource',
					name: 'resource',
					type: 'options',
					noDataExpression: true,
					options: [
						{ name: 'Agent', value: 'agent' },
						{ name: 'Board', value: 'board' },
						{ name: 'Call', value: 'call' },
						{ name: 'Contact', value: 'contact' },
						{ name: 'Credit', value: 'credits' },
						{ name: 'Event', value: 'event' },
						{ name: 'Phone Number', value: 'phoneNumber' },
						{ name: 'Tag', value: 'tag' },
						{ name: 'Task', value: 'task' },
						{ name: 'WhatsApp', value: 'whatsapp' },
					],
					default: 'call',
				},
				...agentOperations,
				...agentFields,
				...boardOperations,
				...boardFields,
				...callOperations,
				...callFields,
				...contactOperations,
				...contactFields,
				...creditsOperations,
				...eventOperations,
				...eventFields,
				...phoneNumberOperations,
				...phoneNumberFields,
				...tagOperations,
				...tagFields,
				...taskOperations,
				...taskFields,
				...whatsappOperations,
				...whatsappFields,
			],
		};
	}

	methods = {
		listSearch,
		loadOptions,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		if (resource === 'event') {
			if (operation !== 'send') {
				throw new NodeOperationError(
					this.getNode(),
					`The operation '${operation}' is not supported for events`,
				);
			}
			return [await executeEvents.call(this, items)];
		}

		const handler = HANDLERS[resource];
		if (!handler) {
			throw new NodeOperationError(this.getNode(), `The resource '${resource}' is not supported`);
		}

		const cache: ExecutionCache = { templates: new Map() };
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const results = await handler.call(this, operation, i, cache);
				returnData.push(...results);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
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
