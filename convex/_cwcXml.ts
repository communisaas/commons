/**
 * CWC XML Generator (Convex runtime)
 *
 * Generates XML payloads for the US CWC (Communicating With Congress) system.
 * Both House and Senate use the same RELAX NG schema (CWC v2.0).
 * House has additional required fields (Organization, AddressValidation, etc.).
 *
 * Lives in convex/ because it's called by the internal `deliverToCongress`
 * action and Convex functions cannot import from SvelteKit's src/.
 */

interface CwcTemplate {
	id: string;
	title: string;
	description: string;
	message_body: string;
	delivery_config: unknown;
}

interface UserRepresentative {
	bioguideId: string;
	name: string;
	party: string;
	state: string;
	district: string;
	chamber: 'house' | 'senate';
	officeCode: string;
}

interface UserAddress {
	street: string;
	city: string;
	state: string;
	zip: string;
}

interface CWCUser {
	id: string;
	name: string;
	email: string;
	phone?: string;
	prefix?: string;
	address: UserAddress;
	representatives: {
		house: UserRepresentative;
		senate: UserRepresentative[];
	};
}

export interface CWCMessage {
	template: CwcTemplate;
	user: CWCUser;
	_targetRep: UserRepresentative;
	personalizedMessage?: string;
	/** Constituent position on the subject. 'Pro' | 'Con' | 'Undecided'. Omitted if unknown. */
	proOrCon?: 'Pro' | 'Con' | 'Undecided';
}

export interface DeliveryAgentConfig {
	name: string;
	email: string;
	contactName: string;
	contactEmail: string;
	contactPhone: string;
	organization: string;
	organizationAbout: string;
}

/**
 * `contactPhone` has no fallback — a missing env var becomes an empty string so
 * `validateXML` can reject it at submission time rather than silently emitting a
 * reserved-for-fiction number (555-123-4567) to Congressional offices.
 */
function getDefaultAgent(): DeliveryAgentConfig {
	return {
		name: process.env.CWC_DELIVERY_AGENT_NAME || 'Commons',
		email: process.env.CWC_DELIVERY_AGENT_ACKNOWLEDGEMENT_EMAIL || process.env.CWC_DELIVERY_AGENT_ACK_EMAIL || 'noreply@commons.email',
		contactName: process.env.CWC_DELIVERY_AGENT_CONTACT_NAME || process.env.CWC_DELIVERY_AGENT_CONTACT || 'Commons Support',
		contactEmail: process.env.CWC_DELIVERY_AGENT_CONTACT_EMAIL || 'hello@commons.email',
		contactPhone: process.env.CWC_DELIVERY_AGENT_CONTACT_PHONE || '',
		organization: process.env.CWC_ORGANIZATION_NAME || 'Commons Platform',
		organizationAbout: process.env.CWC_ORGANIZATION_ABOUT || 'Civic engagement platform'
	};
}

function getSenateAgent(): DeliveryAgentConfig {
	const base = getDefaultAgent();
	return {
		...base,
		name: process.env.CWC_SENATE_DELIVERY_AGENT_NAME || base.name,
		email: process.env.CWC_SENATE_ACK_EMAIL || base.email
	};
}

export class CWCXmlGenerator {
	static generateOfficeCode(rep: UserRepresentative): string {
		if (rep.chamber === 'senate') {
			return rep.officeCode || rep.bioguideId;
		}
		const state = rep.state.toUpperCase();
		const district = rep.district.padStart(2, '0');
		return `H${state}${district}`;
	}

	static generateUserAdvocacyXML(message: CWCMessage, agent?: DeliveryAgentConfig): string {
		if (message._targetRep.chamber === 'senate') {
			return this.generateSenateXML(message, agent);
		}
		return this.generateHouseXML(message, agent);
	}

	static generateHouseXML(message: CWCMessage, agent?: DeliveryAgentConfig): string {
		const a = agent || getDefaultAgent();
		const { template, user, _targetRep, personalizedMessage, proOrCon } = message;
		const deliveryId = this.generateDeliveryId(user.id, template.id, _targetRep.bioguideId);
		const deliveryDate = new Date().toISOString().split('T')[0].replace(/-/g, '');
		const [firstName, ...lastNameParts] = (user.name || 'Constituent').split(' ');
		const lastName = lastNameParts.join(' ') || 'User';
		const topics = this.generateLibraryOfCongressTopics(template.title || '');
		const phoneLine = this.formatPhoneLine(user.phone);
		const prefixLine = user.prefix ? `        <Prefix>${this.escapeXML(user.prefix)}</Prefix>\n` : '';
		const proOrConLine = proOrCon ? `        <ProOrCon>${proOrCon}</ProOrCon>\n` : '';

		return `<?xml version="1.0" ?>
<CWC>
    <CWCVersion>2.0</CWCVersion>
    <Delivery>
        <DeliveryId>${deliveryId}</DeliveryId>
        <DeliveryDate>${deliveryDate}</DeliveryDate>
        <DeliveryAgent>${this.escapeXML(a.name)}</DeliveryAgent>
        <DeliveryAgentAckEmailAddress>${this.escapeXML(a.email)}</DeliveryAgentAckEmailAddress>
        <DeliveryAgentContact>
            <DeliveryAgentContactName>${this.escapeXML(a.contactName)}</DeliveryAgentContactName>
            <DeliveryAgentContactEmail>${this.escapeXML(a.contactEmail)}</DeliveryAgentContactEmail>
            <DeliveryAgentContactPhone>${this.escapeXML(a.contactPhone)}</DeliveryAgentContactPhone>
        </DeliveryAgentContact>
        <Organization>${this.escapeXML(a.organization)}</Organization>
        <OrganizationContact>
            <OrganizationContactName>${this.escapeXML(a.contactName)}</OrganizationContactName>
            <OrganizationContactEmail>${this.escapeXML(a.contactEmail)}</OrganizationContactEmail>
            <OrganizationContactPhone>${this.escapeXML(a.contactPhone)}</OrganizationContactPhone>
        </OrganizationContact>
        <OrganizationAbout>${this.escapeXML(a.organizationAbout)}</OrganizationAbout>
        <CampaignId>${(template.id || 'commons').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)}</CampaignId>
    </Delivery>
    <Recipient>
        <MemberOffice>${this.generateOfficeCode(_targetRep)}</MemberOffice>
        <IsResponseRequested>N</IsResponseRequested>
        <NewsletterOptIn>N</NewsletterOptIn>
    </Recipient>
    <Constituent>
${prefixLine}        <FirstName>${this.escapeXML(firstName)}</FirstName>
        <LastName>${this.escapeXML(lastName)}</LastName>
        <Address1>${this.escapeXML(user.address.street)}</Address1>
        <City>${this.escapeXML(user.address.city)}</City>
        <StateAbbreviation>${this.escapeXML(user.address.state)}</StateAbbreviation>
        <Zip>${this.escapeXML(user.address.zip)}</Zip>
${phoneLine}        <AddressValidation>N</AddressValidation>
        <Email>${this.escapeXML(user.email)}</Email>
        <EmailValidation>Y</EmailValidation>
    </Constituent>
    <Message>
        <Subject>${this.escapeXML(template.title || 'Legislative Communication')}</Subject>
        <LibraryOfCongressTopics>
            ${topics.map((topic) => `<LibraryOfCongressTopic>${topic}</LibraryOfCongressTopic>`).join('\n            ')}
        </LibraryOfCongressTopics>
${proOrConLine}        <OrganizationStatement>${this.escapeXML(template.title || 'Constituent message')}</OrganizationStatement>
        <ConstituentMessage>${this.escapeXML(personalizedMessage || template.message_body || '')}</ConstituentMessage>
    </Message>
</CWC>`;
	}

	static generateSenateXML(message: CWCMessage, agent?: DeliveryAgentConfig): string {
		const a = agent || getSenateAgent();
		const { template, user, _targetRep, personalizedMessage } = message;
		const deliveryId = this.generateDeliveryId(user.id, template.id, _targetRep.bioguideId);
		const deliveryDate = new Date().toISOString().split('T')[0].replace(/-/g, '');
		const [firstName, ...lastNameParts] = (user.name || 'Constituent').split(' ');
		const lastName = lastNameParts.join(' ') || 'User';
		const topics = this.generateLibraryOfCongressTopics(template.title || '');
		const prefixLine = user.prefix ? `        <Prefix>${this.escapeXML(user.prefix)}</Prefix>\n` : '';

		return `<?xml version="1.0" encoding="UTF-8"?>
<CWC>
    <CWCVersion>2.0</CWCVersion>
    <Delivery>
        <DeliveryId>${deliveryId}</DeliveryId>
        <DeliveryDate>${deliveryDate}</DeliveryDate>
        <DeliveryAgent>${this.escapeXML(a.name)}</DeliveryAgent>
        <DeliveryAgentAckEmailAddress>${this.escapeXML(a.email)}</DeliveryAgentAckEmailAddress>
        <DeliveryAgentContact>
            <DeliveryAgentContactName>${this.escapeXML(a.contactName)}</DeliveryAgentContactName>
            <DeliveryAgentContactEmail>${this.escapeXML(a.contactEmail)}</DeliveryAgentContactEmail>
            <DeliveryAgentContactPhone>${this.escapeXML(a.contactPhone)}</DeliveryAgentContactPhone>
        </DeliveryAgentContact>
        <CampaignId>${(template.id || 'commons').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)}</CampaignId>
    </Delivery>
    <Recipient>
        <MemberOffice>${this.generateOfficeCode(_targetRep)}</MemberOffice>
        <IsResponseRequested>Y</IsResponseRequested>
        <NewsletterOptIn>N</NewsletterOptIn>
    </Recipient>
    <Constituent>
${prefixLine}        <FirstName>${this.escapeXML(firstName)}</FirstName>
        <LastName>${this.escapeXML(lastName)}</LastName>
        <Address1>${this.escapeXML(user.address.street)}</Address1>
        <City>${this.escapeXML(user.address.city)}</City>
        <StateAbbreviation>${this.escapeXML(user.address.state)}</StateAbbreviation>
        <Zip>${this.escapeXML(user.address.zip)}</Zip>
        <Email>${this.escapeXML(user.email)}</Email>
    </Constituent>
    <Message>
        <Subject>${this.escapeXML(template.title || 'Legislative Communication')}</Subject>
        <LibraryOfCongressTopics>
            ${topics.map((topic) => `<LibraryOfCongressTopic>${topic}</LibraryOfCongressTopic>`).join('\n            ')}
        </LibraryOfCongressTopics>
        <ConstituentMessage>${this.escapeXML(personalizedMessage || template.message_body || '')}</ConstituentMessage>
    </Message>
</CWC>`;
	}

	static generateDeliveryId(_userId: string, _templateId: string, _repBioguideId: string): string {
		return crypto.randomUUID().replace(/-/g, '');
	}

	static formatPhoneLine(phone: string | undefined): string {
		if (!phone) return '';
		try {
			return `        <Phone>${this.escapeXML(this.formatPhoneNumber(phone))}</Phone>\n`;
		} catch {
			return '';
		}
	}

	static formatPhoneNumber(phone: string): string {
		const digits = phone.replace(/\D/g, '');
		if (digits.length === 11 && digits.startsWith('1')) {
			const rest = digits.slice(1);
			return `${rest.slice(0, 3)}-${rest.slice(3, 6)}-${rest.slice(6)}`;
		}
		if (digits.length === 10) {
			return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
		}
		throw new Error(`Invalid phone: expected 10 digits, got ${digits.length}`);
	}

	static generateLibraryOfCongressTopics(title: string): string[] {
		const t = title.toLowerCase();
		const topics: string[] = [];
		if (t.includes('health') || t.includes('medicare') || t.includes('medicaid')) topics.push('Health');
		if (t.includes('environment') || t.includes('climate') || t.includes('pollution')) topics.push('Environmental Protection');
		if (t.includes('education') || t.includes('school') || t.includes('student')) topics.push('Education');
		if (t.includes('economy') || t.includes('jobs') || t.includes('employment')) topics.push('Labor and Employment');
		if (t.includes('immigration') || t.includes('border')) topics.push('Immigration');
		if (t.includes('tax') || t.includes('budget')) topics.push('Taxation');
		if (t.includes('civil rights') || t.includes('equality') || t.includes('discrimination')) topics.push('Civil Rights and Liberties, Minority Issues');
		if (topics.length === 0) topics.push('Government Operations and Politics');
		return topics;
	}

	static escapeXML(str: string): string {
		return str.replace(/[<>&'"]/g, (char) => {
			switch (char) {
				case '<': return '&lt;';
				case '>': return '&gt;';
				case '&': return '&amp;';
				case '"': return '&quot;';
				case "'": return '&#39;';
				default: return char;
			}
		});
	}

	static validateXML(xml: string): { valid: boolean; errors: string[] } {
		const errors: string[] = [];

		for (const el of ['<CWC>', '<CWCVersion>', '<DeliveryId>', '<DeliveryAgent>', '<Constituent>', '<Message>', '<MemberOffice>']) {
			if (!xml.includes(el)) errors.push(`Missing required CWC element: ${el}`);
		}

		for (const el of ['DeliveryAgentContactPhone', 'DeliveryAgentContactEmail', 'DeliveryAgentContactName']) {
			if (new RegExp(`<${el}>\\s*</${el}>`).test(xml)) {
				errors.push(`Empty required CWC field: ${el} (check CWC_DELIVERY_AGENT_* env vars)`);
			}
		}

		for (const el of ['Address1', 'City', 'StateAbbreviation', 'Zip']) {
			if (new RegExp(`<${el}>\\s*</${el}>`).test(xml)) {
				errors.push(`Empty constituent address field: ${el}`);
			}
		}

		return { valid: errors.length === 0, errors };
	}
}
