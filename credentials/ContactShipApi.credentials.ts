import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ContactShipApi implements ICredentialType {
	name = 'contactShipApi';

	displayName = 'ContactShip API';

	icon: Icon = {
		light: 'file:../icons/contactship.svg',
		dark: 'file:../icons/contactship.dark.svg',
	};

	documentationUrl = 'https://github.com/contactship/n8n-nodes-contactship#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description:
				'Your organization API key. In ContactShip, open Organization → API Keys to generate it. Your plan must include API access.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.contactship.ai',
			required: true,
			description:
				'Address of the ContactShip API. Change it only if ContactShip support asks you to.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/credits',
			method: 'GET',
		},
	};
}
