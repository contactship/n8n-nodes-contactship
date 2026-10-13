import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeBaseDescription,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { listSearch, loadOptions, resourceMapping } from '../shared/methods';
import { isNodeApiError } from '../shared/transport';
import {
	creditsOperations,
	executeCredits,
	executePhoneNumber,
	phoneNumberFields,
	phoneNumberOperations,
} from './resources/account';
import { agentFields, agentOperations, executeAgent } from './resources/agent';
import {
	agentVersionFields,
	agentVersionOperations,
	executeAgentVersion,
} from './resources/agentVersion';
import { boardFields, boardOperations, executeBoard } from './resources/board';
import { callFields, callOperations, executeCall } from './resources/call';
import type { ExecutionCache, ResourceHandler } from './resources/common';
import { contactFields, contactOperations, executeContact } from './resources/contact';
import {
	channelFields,
	channelOperations,
	conversationFields,
	conversationOperations,
	executeChannel,
	executeConversation,
} from './resources/conversation';
import {
	eventFields,
	eventOperations,
	executeEvent,
	executeEvents,
	identifyFields,
} from './resources/event';
import { executeTag, tagFields, tagOperations } from './resources/tag';
import { executeTask, taskFields, taskOperations } from './resources/task';
import { executeVoice, voiceFields, voiceOperations } from './resources/voice';
import { executeWhatsApp, whatsappFields, whatsappOperations } from './resources/whatsapp';

const HANDLERS: Record<string, ResourceHandler> = {
	agent: executeAgent,
	agentVersion: executeAgentVersion,
	board: executeBoard,
	call: executeCall,
	channel: executeChannel,
	contact: executeContact,
	conversation: executeConversation,
	credits: executeCredits,
	event: executeEvent,
	phoneNumber: executePhoneNumber,
	tag: executeTag,
	task: executeTask,
	voice: executeVoice,
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
						{ name: 'Agent Version', value: 'agentVersion' },
						{ name: 'Board', value: 'board' },
						{ name: 'Call', value: 'call' },
						{ name: 'Channel', value: 'channel' },
						{ name: 'Contact', value: 'contact' },
						{ name: 'Conversation', value: 'conversation' },
						{ name: 'Credit', value: 'credits' },
						{ name: 'Event', value: 'event' },
						{ name: 'Phone Number', value: 'phoneNumber' },
						{ name: 'Tag', value: 'tag' },
						{ name: 'Task', value: 'task' },
						{ name: 'Voice', value: 'voice' },
						{ name: 'WhatsApp', value: 'whatsapp' },
					],
					default: 'call',
				},
				...agentOperations,
				...agentFields,
				...agentVersionOperations,
				...agentVersionFields,
				...boardOperations,
				...boardFields,
				...callOperations,
				...callFields,
				...channelOperations,
				...channelFields,
				...contactOperations,
				...contactFields,
				...conversationOperations,
				...conversationFields,
				...creditsOperations,
				...eventOperations,
				...eventFields,
				...identifyFields,
				...phoneNumberOperations,
				...phoneNumberFields,
				...tagOperations,
				...tagFields,
				...taskOperations,
				...taskFields,
				...voiceOperations,
				...voiceFields,
				...whatsappOperations,
				...whatsappFields,
			],
		};
	}

	methods = {
		listSearch,
		loadOptions,
		resourceMapping,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		// Send Event batches the input items; every other operation runs once per item.
		if (resource === 'event' && operation === 'send') {
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
