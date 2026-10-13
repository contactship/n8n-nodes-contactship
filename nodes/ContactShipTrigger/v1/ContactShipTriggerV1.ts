import type {
	INodeType,
	INodeTypeBaseDescription,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { authenticationProperties, getOutputIndex, handleWebhook, webhookMethods } from '../shared';

/**
 * Version 1: the five post-call outputs of the 0.x and first 1.0 releases.
 * Kept as it was so workflows built with it behave the same.
 */
export class ContactShipTriggerV1 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = {
			...baseDescription,
			version: 1,
			subtitle: 'Post-call results',
			description:
				'Starts the workflow when a ContactShip voice agent finishes a call and its analysis is ready',
			defaults: {
				name: 'ContactShip Trigger',
			},
			inputs: [],
			outputs: [
				NodeConnectionTypes.Main,
				NodeConnectionTypes.Main,
				NodeConnectionTypes.Main,
				NodeConnectionTypes.Main,
				NodeConnectionTypes.Main,
			],
			outputNames: ['Answered', 'Voicemail', 'No Answer', 'Failed', 'Other'],
			webhooks: [
				{
					name: 'default',
					httpMethod: 'POST',
					responseMode: 'onReceived',
					path: 'webhook',
				},
			],
			properties: [
				{
					displayName:
						"In ContactShip, open your voice agent, go to Advanced → Post-call, paste this node's Production URL as the webhook URL and publish the agent. You can also send the URL in 'Webhook URL' when making a call with the ContactShip node. Activate the workflow so the Production URL accepts calls.",
					name: 'setupNotice',
					type: 'notice',
					default: '',
				},
				...authenticationProperties,
			],
		};
	}

	webhookMethods = webhookMethods;

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		return await handleWebhook.call(this, 5, getOutputIndex);
	}
}
