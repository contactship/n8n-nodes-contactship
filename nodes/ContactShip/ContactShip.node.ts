import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';

import { ContactShipV1 } from './v1/ContactShipV1';
import { ContactShipV2 } from './v2/ContactShipV2';

export class ContactShip extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'ContactShip',
			name: 'contactShip',
			icon: {
				light: 'file:../../icons/contactship.svg',
				dark: 'file:../../icons/contactship.dark.svg',
			},
			group: ['transform'],
			subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
			description:
				'Make AI phone calls, manage contacts, boards and tasks, and send WhatsApp messages with ContactShip',
			defaultVersion: 2,
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new ContactShipV1(baseDescription),
			2: new ContactShipV2(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}
