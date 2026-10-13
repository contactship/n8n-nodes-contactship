import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';

import { ContactShipTriggerV1 } from './v1/ContactShipTriggerV1';
import { ContactShipTriggerV2 } from './v2/ContactShipTriggerV2';

export class ContactShipTrigger extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'ContactShip Trigger',
			name: 'contactShipTrigger',
			icon: {
				light: 'file:../../icons/contactship.svg',
				dark: 'file:../../icons/contactship.dark.svg',
			},
			group: ['trigger'],
			description:
				'Starts the workflow when a ContactShip voice agent finishes a call, or when a text agent closes a follow-up',
			defaultVersion: 2,
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new ContactShipTriggerV1(baseDescription),
			2: new ContactShipTriggerV2(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}
