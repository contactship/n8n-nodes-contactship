import type {
	INodeType,
	INodeTypeBaseDescription,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import {
	authenticationProperties,
	getOutputIndexV2,
	handleWebhook,
	webhookMethods,
} from '../shared';

/**
 * Version 2: the five post-call outputs of version 1, in the same order, plus
 * a sixth output for the follow-up closure webhook of text agents.
 */
export class ContactShipTriggerV2 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = {
			...baseDescription,
			version: 2,
			subtitle: 'Call results and follow-up closures',
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
				NodeConnectionTypes.Main,
			],
			outputNames: ['Answered', 'Voicemail', 'No Answer', 'Failed', 'Other', 'Follow-Up Closed'],
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
						"Paste this node's Production URL in ContactShip and activate the workflow. Call results: open the voice agent, go to Advanced → Post-call, paste the URL and publish the agent, or send it in 'Webhook URL' when making a call. Follow-up closures: open the text agent, go to Advanced → Follow-ups → Close webhook, paste the URL and choose the POST method.",
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
		return await handleWebhook.call(this, 6, getOutputIndexV2);
	}
}
