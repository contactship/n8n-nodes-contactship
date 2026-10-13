import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

type NodeApiErrorOptions = NonNullable<ConstructorParameters<typeof NodeApiError>[2]>;

export type ContactShipContext = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions;

export const CREDENTIAL_NAME = 'contactShipApi';

const DEFAULT_BASE_URL = 'https://api.contactship.ai';

/** Removes empty values so they are not sent as query parameters. */
function cleanQuery(qs?: IDataObject): IDataObject | undefined {
	if (!qs) return undefined;
	const cleaned: IDataObject = {};
	for (const [key, value] of Object.entries(qs)) {
		if (value === undefined || value === null || value === '') continue;
		cleaned[key] = value;
	}
	return Object.keys(cleaned).length ? cleaned : undefined;
}

interface ErrorSource {
	status?: number;
	apiMessage?: string;
	retryAfterMs?: number;
}

function asObject(value: unknown): JsonObject | undefined {
	return value !== null && typeof value === 'object' ? (value as JsonObject) : undefined;
}

function readMessage(data: unknown): string | undefined {
	if (typeof data === 'string') return data.trim() || undefined;
	const object = asObject(data);
	if (!object) return undefined;
	const message = object.message;
	if (Array.isArray(message)) return message.map(String).join('; ');
	if (typeof message === 'string' && message.trim()) return message.trim();
	const nested = object.error;
	if (typeof nested === 'string' && nested.trim()) return nested.trim();
	return readMessage(asObject(nested));
}

/**
 * Reads the HTTP status, the message ContactShip sent and the Retry-After
 * header, whether the request helper threw the raw HTTP error or already
 * wrapped it in a NodeApiError.
 */
function inspectError(error: JsonObject): ErrorSource {
	const cause = asObject(error.cause);
	const responses = [asObject(error.response), asObject(cause?.response)].filter(
		(response): response is JsonObject => response !== undefined,
	);

	let status: number | undefined;
	for (const candidate of [
		error.httpCode,
		...responses.map((response) => response.status ?? response.statusCode),
		error.statusCode,
	]) {
		const code = Number(candidate);
		if (Number.isInteger(code) && code >= 100 && code < 600) {
			status = code;
			break;
		}
	}

	const context = asObject(error.context);
	let apiMessage: string | undefined;
	for (const source of [
		...responses.map((response) => response.data ?? response.body),
		context?.data,
		error.error,
	]) {
		apiMessage = readMessage(source);
		if (apiMessage) break;
	}

	let retryAfterMs: number | undefined;
	for (const response of responses) {
		const headers = asObject(response.headers);
		const seconds = Number(headers?.['retry-after'] ?? headers?.['Retry-After']);
		if (Number.isFinite(seconds) && seconds > 0) {
			retryAfterMs = seconds * 1000;
			break;
		}
	}

	return { status, apiMessage, retryAfterMs };
}

/**
 * Checks for a NodeApiError without relying on `instanceof`, which fails when
 * n8n and this package load different copies of n8n-workflow.
 */
export function isNodeApiError(error: unknown): error is NodeApiError {
	if (error instanceof NodeApiError) return true;
	const candidate = asObject(error);
	return (
		candidate !== undefined &&
		(candidate.constructor as { name?: string } | undefined)?.name === 'NodeApiError' &&
		'httpCode' in candidate
	);
}

/**
 * Turns a failed request into a NodeApiError that says what happened (message)
 * and how to get unstuck (description), following the n8n UX guidelines.
 */
export function buildApiError(node: INode, error: JsonObject, itemIndex?: number): NodeApiError {
	const { status, apiMessage, retryAfterMs } = inspectError(error);
	let message: string | undefined;
	let description: string | undefined;
	let failure: NodeApiErrorOptions['failure'];

	switch (status) {
		case 400:
			message = apiMessage
				? `ContactShip did not accept the request: ${apiMessage}`
				: 'ContactShip did not accept the request';
			description =
				'Check the values in the node parameters. Phone numbers must be in international format, for example +12125551234.';
			break;
		case 401:
			message = 'The ContactShip API key was not accepted';
			description =
				'Check the API key in your ContactShip credential. Generate a new one in ContactShip under Organization → API Keys; your plan must include API access.';
			failure = { cause: 'credential-invalid' };
			break;
		case 403:
			message = apiMessage ?? 'ContactShip did not allow this request';
			description =
				'Your plan or add-ons may not include this feature (for example, sending events requires the Events add-on). Contact ContactShip support to enable it.';
			break;
		case 404:
			message = apiMessage ?? 'The requested record was not found in ContactShip';
			description =
				'Check that the ID is correct and that the record belongs to the organization of the API key.';
			break;
		case 409:
			message = apiMessage ?? 'The request conflicts with the current state of the record';
			description =
				'For example, a contact with the same phone number may already exist, or a call may not have been placed yet. Check the record and try again.';
			break;
		case 429:
			message = 'ContactShip received too many requests';
			description =
				'Wait a moment and run the node again, or turn on Retry On Fail in the node settings. Listing contacts and calls has a lower request limit.';
			failure = retryAfterMs ? { cause: 'rate-limited', retryAfterMs } : { cause: 'rate-limited' };
			break;
		default:
			if (status !== undefined && status >= 500) {
				message = 'ContactShip could not process the request';
				description = `${apiMessage ? `${apiMessage}. ` : ''}Try again in a few minutes. If the request starts a call or sends a message, check that it was not already created before running it again.`;
				failure = { cause: 'temporarily-unavailable' };
			} else if (apiMessage) {
				message = apiMessage;
			}
	}

	// The request helper usually throws a NodeApiError already; reuse it so the
	// response details stay attached, and only replace the texts.
	const apiError = isNodeApiError(error)
		? error
		: new NodeApiError(node, error, {
				httpCode: status !== undefined ? String(status) : undefined,
				itemIndex,
			});
	if (message) apiError.message = message;
	if (description) apiError.description = description;
	if (failure) apiError.failure = failure;
	if (itemIndex !== undefined) apiError.context.itemIndex = itemIndex;
	return apiError;
}

/**
 * Sends an authenticated request to the ContactShip public API.
 * Authentication (the x-api-key header) is added by the credential.
 */
export async function contactShipApiRequest(
	this: ContactShipContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject | IDataObject[],
	qs?: IDataObject,
	itemIndex?: number,
): Promise<IDataObject> {
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	const baseUrl = String(credentials.baseUrl || DEFAULT_BASE_URL)
		.trim()
		.replace(/\/+$/, '');

	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${endpoint}`,
		headers: { Accept: 'application/json' },
		json: true,
	};

	const query = cleanQuery(qs);
	if (query) options.qs = query;
	if (body !== undefined && method !== 'GET') options.body = body;

	try {
		const response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			options,
		)) as unknown;
		if (response === undefined || response === null || response === '') return {};
		if (typeof response !== 'object' || Array.isArray(response))
			return { data: response } as IDataObject;
		return response as IDataObject;
	} catch (error) {
		throw buildApiError(this.getNode(), error as JsonObject, itemIndex);
	}
}

interface PaginationOptions {
	/** Return every record instead of stopping at `limit`. */
	returnAll: boolean;
	/** Maximum number of records when `returnAll` is false. */
	limit?: number;
	/** Largest page the endpoint accepts. */
	pageSize?: number;
	itemIndex?: number;
}

/**
 * Reads a list endpoint that uses `limit`/`offset` and answers
 * `{ data: [], pagination: { total_rows } }`.
 */
export async function contactShipApiRequestAllItems(
	this: ContactShipContext,
	endpoint: string,
	qs: IDataObject,
	{ returnAll, limit = 50, pageSize = 100, itemIndex }: PaginationOptions,
): Promise<IDataObject[]> {
	const results: IDataObject[] = [];
	let offset = 0;

	for (;;) {
		const remaining = returnAll ? pageSize : Math.min(pageSize, limit - results.length);
		if (remaining <= 0) break;

		const response = await contactShipApiRequest.call(
			this,
			'GET',
			endpoint,
			undefined,
			{ ...qs, limit: remaining, offset },
			itemIndex,
		);
		const page = Array.isArray(response.data) ? (response.data as IDataObject[]) : [];
		results.push(...page);
		offset += page.length;

		const totalRows = Number((response.pagination as IDataObject | undefined)?.total_rows);
		const reachedTotal = Number.isFinite(totalRows) && offset >= totalRows;
		if (page.length < remaining || reachedTotal) break;
	}

	return returnAll ? results : results.slice(0, limit);
}
