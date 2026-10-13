import type { IDataObject, ResourceMapperField } from 'n8n-workflow';

import type { ContactShipContext } from './transport';
import { contactShipApiRequest } from './transport';
import { extractList } from './utils';

/** `{{1}}` (positional) or `{{first_name}}` (named) placeholders in a template text. */
const PLACEHOLDER = /\{\{\s*([^{}\s]+)\s*\}\}/g;

/** Separates the template name from its language in the value of the template list. */
const LANGUAGE_SEPARATOR = ':';

const MEDIA_FORMATS = ['image', 'video', 'document'];

export interface TemplateReference {
	name: string;
	language?: string;
}

/** Reads `welcome` or `welcome:es_MX` (the value used by the template list). */
export function parseTemplateValue(value: unknown): TemplateReference {
	const raw = String(value ?? '').trim();
	const separator = raw.indexOf(LANGUAGE_SEPARATOR);
	if (separator <= 0) return { name: raw };
	const language = raw.slice(separator + 1).trim();
	return { name: raw.slice(0, separator).trim(), language: language || undefined };
}

/** The value stored when a template is picked from the list: name and language. */
export function templateValue(template: IDataObject): string {
	const name = String(template.name ?? '');
	return template.language ? `${name}${LANGUAGE_SEPARATOR}${String(template.language)}` : name;
}

export function isApproved(template: IDataObject): boolean {
	return !template.status || String(template.status).toUpperCase() === 'APPROVED';
}

function findPaging(response: unknown): IDataObject | undefined {
	let node: unknown = response;
	for (let depth = 0; depth < 4; depth++) {
		if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
		const paging = (node as IDataObject).paging;
		if (paging && typeof paging === 'object') return paging as IDataObject;
		node = (node as IDataObject).data;
	}
	return undefined;
}

/**
 * Lists the templates of a WhatsApp channel. The list can arrive wrapped once
 * or twice, and the cursor may be ignored, so pages are deduplicated and the
 * loop stops as soon as a page brings nothing new.
 */
export async function fetchChannelTemplates(
	this: ContactShipContext,
	channelId: string,
	options: { returnAll: boolean; limit?: number; itemIndex?: number },
): Promise<IDataObject[]> {
	const { returnAll, limit = 100, itemIndex } = options;
	const templates: IDataObject[] = [];
	const seen = new Set<string>();
	let after: string | undefined;

	for (let page = 0; page < 50; page++) {
		const pageSize = returnAll ? 100 : Math.min(100, limit - templates.length);
		if (pageSize <= 0) break;
		const response = await contactShipApiRequest.call(
			this,
			'GET',
			'/v1/waba/templates',
			undefined,
			{ channel_id: channelId, limit: pageSize, after },
			itemIndex,
		);
		let added = 0;
		for (const template of extractList(response)) {
			const key = String(template.id ?? templateValue(template));
			if (seen.has(key)) continue;
			seen.add(key);
			templates.push(template);
			added++;
		}
		const paging = findPaging(response);
		const next = (paging?.cursors as IDataObject | undefined)?.after as string | undefined;
		if (!added || !next || next === after || !paging?.next) break;
		after = next;
	}

	return returnAll ? templates : templates.slice(0, limit);
}

/** Finds the approved template a reference points to. */
export function findTemplate(
	templates: IDataObject[],
	reference: TemplateReference,
): { template?: IDataObject; languages: string[] } {
	const matching = templates.filter(
		(template) => template.name === reference.name && isApproved(template),
	);
	const languages = [...new Set(matching.map((template) => String(template.language ?? '')))];
	if (reference.language) {
		return {
			template: matching.find((template) => template.language === reference.language),
			languages,
		};
	}
	return { template: matching.length === 1 ? matching[0] : undefined, languages };
}

function placeholders(text: unknown): string[] {
	if (typeof text !== 'string') return [];
	const names: string[] = [];
	for (const match of text.matchAll(PLACEHOLDER)) {
		if (!names.includes(match[1])) names.push(match[1]);
	}
	return names;
}

function components(template: IDataObject): IDataObject[] {
	return Array.isArray(template.components) ? (template.components as IDataObject[]) : [];
}

function componentOfType(template: IDataObject, type: string): IDataObject | undefined {
	return components(template).find((component) => String(component.type).toUpperCase() === type);
}

/** Example values Meta keeps for a text with placeholders, keyed by placeholder. */
function examples(example: unknown, prefix: 'body' | 'header'): Record<string, string> {
	const result: Record<string, string> = {};
	if (!example || typeof example !== 'object') return result;
	const data = example as IDataObject;
	const positional = data[`${prefix}_text`];
	if (Array.isArray(positional)) {
		const row = (Array.isArray(positional[0]) ? positional[0] : positional) as unknown[];
		row.forEach((value, index) => {
			result[String(index + 1)] = String(value);
		});
	}
	const named = data[`${prefix}_text_named_params`];
	if (Array.isArray(named)) {
		for (const entry of named as IDataObject[]) {
			if (entry?.param_name) result[String(entry.param_name)] = String(entry.example ?? '');
		}
	}
	return result;
}

function withExample(label: string, example: unknown): string {
	const text = Array.isArray(example) ? example[0] : example;
	if (text === undefined || text === null || String(text).trim() === '') return label;
	const short = String(text).length > 40 ? `${String(text).slice(0, 40)}…` : String(text);
	return `${label} (e.g. ${short})`;
}

function textField(
	section: 'body' | 'header',
	name: string,
	named: boolean,
	example?: string,
): ResourceMapperField {
	const label = `${section === 'body' ? 'Body' : 'Header'} {{${name}}}`;
	return {
		id: `${section}_${named ? 'named' : 'pos'}_${name}`,
		displayName: withExample(label, example),
		required: true,
		defaultMatch: false,
		display: true,
		type: 'string',
		canBeUsedToMatch: false,
	};
}

function field(id: string, displayName: string, required = true): ResourceMapperField {
	return {
		id,
		displayName,
		required,
		defaultMatch: false,
		display: true,
		type: 'string',
		canBeUsedToMatch: false,
	};
}

/**
 * One field per value the template needs: header text or media, body
 * placeholders, and the button parameters Meta allows (URL suffix, coupon
 * code, one-time password).
 */
export function templateFields(template: IDataObject): ResourceMapperField[] {
	const fields: ResourceMapperField[] = [];
	const namedFormat = String(template.parameter_format ?? '').toUpperCase() === 'NAMED';
	const isNamed = (name: string) => namedFormat || !/^\d+$/.test(name);

	const header = componentOfType(template, 'HEADER');
	if (header) {
		const format = String(header.format ?? 'TEXT').toLowerCase();
		if (format === 'text') {
			const headerExamples = examples(header.example, 'header');
			for (const name of placeholders(header.text)) {
				fields.push(textField('header', name, isNamed(name), headerExamples[name]));
			}
		} else if (MEDIA_FORMATS.includes(format)) {
			const label = format.charAt(0).toUpperCase() + format.slice(1);
			fields.push(field(`header_${format}`, `Header ${label} URL`));
		} else if (format === 'location') {
			fields.push(field('header_location_latitude', 'Header Location Latitude (e.g. 19.4326)'));
			fields.push(field('header_location_longitude', 'Header Location Longitude (e.g. -99.1332)'));
			fields.push(field('header_location_name', 'Header Location Name', false));
			fields.push(field('header_location_address', 'Header Location Address', false));
		}
	}

	const body = componentOfType(template, 'BODY');
	if (body) {
		const bodyExamples = examples(body.example, 'body');
		for (const name of placeholders(body.text)) {
			fields.push(textField('body', name, isNamed(name), bodyExamples[name]));
		}
	}

	const buttons = componentOfType(template, 'BUTTONS')?.buttons;
	if (Array.isArray(buttons)) {
		(buttons as IDataObject[]).forEach((button, index) => {
			const type = String(button.type ?? '').toUpperCase();
			const text = button.text ? `"${String(button.text)}"` : String(index + 1);
			if (type === 'URL' && placeholders(button.url).length) {
				fields.push(
					field(
						`button_${index}_url`,
						withExample(`Button ${text} URL Variable`, button.example ?? button.url),
					),
				);
			} else if (type === 'COPY_CODE') {
				fields.push(
					field(
						`button_${index}_copy_code`,
						withExample(`Button ${text} Coupon Code`, button.example),
					),
				);
			} else if (type === 'OTP') {
				fields.push(field(`button_${index}_otp`, `Button ${text} One-Time Password`));
			}
		});
	}

	return fields;
}

function isEmpty(value: unknown): boolean {
	return value === undefined || value === null || String(value).trim() === '';
}

/**
 * Builds the `components` array (Meta Cloud API format, as ContactShip
 * expects it) from the values mapped to the fields of `templateFields`.
 */
export function buildTemplateComponents(values: IDataObject): IDataObject[] {
	const headerParameters: IDataObject[] = [];
	const bodyParameters: Array<{ order: number; parameter: IDataObject }> = [];
	const buttons = new Map<number, IDataObject>();
	const location: IDataObject = {};

	let namedPosition = 0;
	for (const [id, rawValue] of Object.entries(values)) {
		if (isEmpty(rawValue)) continue;
		const value = String(rawValue).trim();

		let match = /^(body|header)_(pos|named)_(.+)$/.exec(id);
		if (match) {
			const parameter: IDataObject = { type: 'text', text: value };
			if (match[2] === 'named') parameter.parameter_name = match[3];
			if (match[1] === 'header') {
				headerParameters.push(parameter);
			} else {
				const order = match[2] === 'pos' ? Number(match[3]) : 1000 + namedPosition++;
				bodyParameters.push({ order, parameter });
			}
			continue;
		}

		match = /^header_(image|video|document)$/.exec(id);
		if (match) {
			headerParameters.push({ type: match[1], [match[1]]: { link: value } });
			continue;
		}

		match = /^header_location_(latitude|longitude|name|address)$/.exec(id);
		if (match) {
			location[match[1]] = value;
			continue;
		}

		match = /^button_(\d+)_(url|copy_code|otp)$/.exec(id);
		if (match) {
			const index = Number(match[1]);
			const parameter =
				match[2] === 'copy_code'
					? { type: 'coupon_code', coupon_code: value }
					: { type: 'text', text: value };
			buttons.set(index, {
				type: 'BUTTON',
				sub_type: match[2] === 'copy_code' ? 'copy_code' : 'url',
				index: String(index),
				parameters: [parameter],
			});
		}
	}

	if (location.latitude !== undefined || location.longitude !== undefined) {
		headerParameters.push({ type: 'location', location });
	}

	const result: IDataObject[] = [];
	if (headerParameters.length) result.push({ type: 'HEADER', parameters: headerParameters });
	if (bodyParameters.length) {
		result.push({
			type: 'BODY',
			parameters: bodyParameters.sort((a, b) => a.order - b.order).map((entry) => entry.parameter),
		});
	}
	for (const index of [...buttons.keys()].sort((a, b) => a - b)) {
		result.push(buttons.get(index) as IDataObject);
	}
	return result;
}
