import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/** Reads a parameter that can be a resource locator, a plain string or an expression. */
export function getIdParameter(
	this: IExecuteFunctions,
	name: string,
	itemIndex: number,
	label: string,
): string {
	const value = this.getNodeParameter(name, itemIndex, '', { extractValue: true }) as unknown;
	const id = String(value ?? '').trim();
	if (!id) {
		throw new NodeOperationError(this.getNode(), `The '${label}' parameter is empty`, {
			description: `Choose a value from the list or enter it by ID in '${label}'.`,
			itemIndex,
		});
	}
	return id;
}

/**
 * Accepts phone numbers with spaces, dashes, dots or parentheses and returns
 * them in E.164 format (`+12125551234`), the format the ContactShip API expects.
 */
export function normalizePhoneNumber(
	this: IExecuteFunctions,
	value: string,
	label: string,
	itemIndex: number,
): string {
	const raw = String(value ?? '').trim();
	const compact = raw.replace(/[\s().-]/g, '').replace(/^00/, '+');
	if (!/^\+[1-9]\d{6,14}$/.test(compact)) {
		throw new NodeOperationError(
			this.getNode(),
			`The phone number '${raw}' in '${label}' is not in international format`,
			{
				description:
					'Use the international format with the country code, for example +12125551234 or +5215512345678.',
				itemIndex,
			},
		);
	}
	return compact;
}

/** Parses a JSON parameter that can be typed as text or produced by an expression. */
export function parseJsonParameter(
	this: IExecuteFunctions,
	value: unknown,
	label: string,
	itemIndex: number,
): IDataObject | IDataObject[] | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'object') return value as IDataObject;
	try {
		const parsed = JSON.parse(String(value)) as unknown;
		if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
		return parsed as IDataObject;
	} catch {
		throw new NodeOperationError(this.getNode(), `The '${label}' parameter is not valid JSON`, {
			description: `Enter a JSON object or array in '${label}', for example {"key": "value"}.`,
			itemIndex,
		});
	}
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

/**
 * Converts a date (ISO 8601 or `yyyy-MM-dd HH:mm[:ss]`) to the
 * `yyyy-MM-dd HH:mm:ss` wall-clock format ContactShip expects for scheduled calls.
 * Dates without an offset are taken as local time in `timeZone`.
 */
export function formatScheduleTime(
	this: IExecuteFunctions,
	value: string,
	timeZone: string,
	itemIndex: number,
): string {
	const raw = String(value ?? '').trim();
	const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(raw);
	if (local) {
		return `${local[1]} ${local[2]}:${local[3]}:${local[4] ?? '00'}`;
	}

	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) {
		throw new NodeOperationError(
			this.getNode(),
			`The date '${raw}' in 'Date and Time' is not valid`,
			{
				description: 'Use an ISO 8601 date, for example 2026-06-15T14:30:00.',
				itemIndex,
			},
		);
	}

	let parts: Intl.DateTimeFormatPart[];
	try {
		parts = new Intl.DateTimeFormat('en-US', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23',
		}).formatToParts(date);
	} catch {
		throw new NodeOperationError(this.getNode(), `The time zone '${timeZone}' is not valid`, {
			description: 'Use an IANA time zone name, for example America/Mexico_City.',
			itemIndex,
		});
	}
	const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
	return `${get('year')}-${pad(get('month'))}-${pad(get('day'))} ${pad(get('hour'))}:${pad(get('minute'))}:${pad(get('second'))}`;
}

/** Turns a `{ key, value }` fixed collection into the API's `additional_data` array. */
export function toKeyValueList(
	collection: IDataObject | undefined,
	group: string,
): Array<{ key: string; value: string }> {
	const entries = (collection?.[group] as IDataObject[] | undefined) ?? [];
	return entries
		.filter((entry) => String(entry.key ?? '').trim() !== '')
		.map((entry) => ({ key: String(entry.key).trim(), value: String(entry.value ?? '') }));
}

/** Splits comma-separated values (for example, emails) into a clean array. */
export function splitList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
	return String(value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/** Returns the `data` field of a ContactShip response envelope. */
export function unwrap(response: IDataObject): unknown {
	return Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response;
}

/** Converts API data into n8n items linked to the input item. */
export function toExecutionData(
	this: IExecuteFunctions,
	data: unknown,
	itemIndex: number,
): INodeExecutionData[] {
	let json: IDataObject | IDataObject[];
	if (Array.isArray(data)) {
		json = data.map((entry) =>
			entry !== null && typeof entry === 'object' ? (entry as IDataObject) : { value: entry },
		);
	} else if (data !== null && typeof data === 'object') {
		json = data as IDataObject;
	} else if (typeof data === 'boolean') {
		json = { success: data };
	} else {
		json = { value: data as string | number | null };
	}
	return this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(json), {
		itemData: { item: itemIndex },
	});
}

/** A flat, 10-field version of a call record. */
export function simplifyCall(call: IDataObject): IDataObject {
	const contact = (call.contact as IDataObject | undefined) ?? {};
	const analysis = (call.call_analysis as IDataObject | undefined) ?? {};
	return {
		id: call.id ?? call.call_id,
		agent_id: call.agent_id,
		direction: call.direction,
		call_status: call.call_status,
		call_result: call.call_result,
		duration: call.duration,
		created_at: call.created_at,
		contact_name: contact.full_name,
		contact_phone: contact.phone_number,
		summary: analysis.summary ?? analysis.call_summary,
	};
}

/** A 10-field version of a voice agent record. */
export function simplifyAgent(agent: IDataObject): IDataObject {
	return {
		id: agent.id,
		name: agent.name,
		person_name: agent.person_name,
		language: agent.language,
		voice_id: agent.voice_id,
		conversation_purpose: agent.conversation_purpose,
		timezone: agent.timezone,
		webhook_url: agent.webhook_url,
		created_at: agent.created_at,
		updated_at: agent.updated_at,
	};
}
