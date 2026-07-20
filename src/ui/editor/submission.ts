import {
    submitFamilyCreation,
    submitFamilyEdit,
    type FamilyCreationInput,
    type FamilyEditBundle,
    type FamilyGraph,
    type SubmissionResult,
} from '../../services/data/familyRepository';

export type PersonFields = {
    first_name: string;
    last_name: string;
    gender: string;
    birth_date: string;
    birthplace: string;
    death_date: string;
    death_place: string;
    occupation: string;
    marriage: string;
    note: string;
    media_url?: string;
};

type IdFactory = () => string;

function compact<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== '' && item !== undefined)) as T;
}

type DateValue = { date_start: string | null; date_end: string | null; date_text: string | null };

export function displayDate(value?: DateValue | null): string {
    if (!value) return '';
    if (value.date_text) return value.date_text;
    if (value.date_start && value.date_end && value.date_end !== value.date_start) {
        return `${value.date_start}/${value.date_end}`;
    }
    return value.date_start ?? '';
}

function mappedDate(text: string, current?: DateValue | null) {
    const value = text.trim();
    if (current && value === displayDate(current)) {
        return compact({
            date_start: current.date_start ?? undefined,
            date_end: current.date_end ?? undefined,
            date_text: current.date_text ?? undefined,
        });
    }
    const exact = /^(\d{4}-\d{2}-\d{2})(?:\/(\d{4}-\d{2}-\d{2}))?$/.exec(value);
    if (exact) {
        return { date_start: exact[1], date_end: exact[2] ?? exact[1], date_text: value };
    }
    return value ? { date_text: value } : {};
}

function currentPerson(graph: FamilyGraph, personId: string) {
    const person = graph.people.find(candidate => candidate.id === personId);
    if (!person?.current_revision) throw new Error('Seçilen kişi bu ailede düzenlenemiyor.');
    return person.current_revision;
}

function personEdit(graph: FamilyGraph, personId: string, fields: PersonFields) {
    const current = currentPerson(graph, personId);
    return compact({
        ref: personId,
        person_id: personId,
        base_revision_id: current.id,
        given_name: fields.first_name.trim(),
        middle_names: current.middle_names ?? '',
        family_name: fields.last_name.trim(),
        display_name: `${fields.first_name} ${fields.last_name}`.trim(),
        aliases: current.aliases,
        gender: fields.gender,
        is_living: current.is_living ?? undefined,
        summary: fields.note.trim(),
        privacy: 'public' as const,
    });
}

function newPerson(ref: string, fields: PersonFields) {
    return compact({
        ref,
        given_name: fields.first_name.trim(),
        family_name: fields.last_name.trim(),
        display_name: `${fields.first_name} ${fields.last_name}`.trim(),
        gender: fields.gender,
        summary: fields.note.trim(),
        privacy: 'public' as const,
    });
}

function eventFor(
    graph: FamilyGraph,
    personRef: string,
    type: 'birth' | 'death' | 'occupation',
    dateText: string,
    place: string,
    details: string,
    id: IdFactory,
) {
    const existing = graph.life_events.find(event => event.person_id === personRef
        && event.current_revision?.event_type === type);
    if (!existing && !dateText && !place && !details) return undefined;
    return compact({
        ref: existing?.id ?? id(),
        event_id: existing?.id ?? '',
        base_revision_id: existing?.current_revision?.id ?? '',
        person_ref: personRef,
        event_type: type,
        ...mappedDate(dateText, existing?.current_revision),
        place_text: place.trim(),
        details: details.trim(),
    });
}

function events(graph: FamilyGraph, personRef: string, fields: PersonFields, id: IdFactory) {
    return [
        eventFor(graph, personRef, 'birth', fields.birth_date, fields.birthplace, '', id),
        eventFor(graph, personRef, 'death', fields.death_date, fields.death_place, '', id),
        eventFor(graph, personRef, 'occupation', '', '', fields.occupation, id),
    ].filter(Boolean) as NonNullable<FamilyEditBundle['events']>;
}

function extras(fields: PersonFields, personRef: string): Pick<FamilyEditBundle, 'media'> {
    const mediaUrl = fields.media_url?.trim();
    return {
        ...(mediaUrl ? { media: [compact({
            person_ref: personRef,
            url: mediaUrl,
            mime_type: 'image/jpeg',
        })] } : {}),
    };
}

export function mapProfileEdit(
    graph: FamilyGraph,
    personId: string,
    fields: PersonFields,
    targetFamilyId?: string,
    id: IdFactory = crypto.randomUUID.bind(crypto),
): FamilyEditBundle {
    const partnerships = graph.partnerships.filter(partnership => partnership.current_revision
        && [partnership.person1_id, partnership.person2_id].includes(personId));
    const partnership = partnerships.length === 1 ? partnerships[0] : undefined;
    const partnershipChanged = partnership
        ? fields.marriage.trim() !== displayDate(partnership.current_revision)
        : Boolean(fields.marriage.trim());
    if (partnershipChanged && (!partnership || !targetFamilyId || !partnershipEndpointsInFamily(graph, partnership.id, targetFamilyId))) {
        throw new Error('Evlilik tarihi bu hedef ailede düzenlenemiyor. Her iki kişiyi içeren aileyi seçin.');
    }
    return {
        people: [personEdit(graph, personId, fields)],
        events: events(graph, personId, fields, id),
        ...(partnershipChanged && partnership ? { partnerships: [compact({
            ref: partnership.id,
            partnership_id: partnership.id,
            base_revision_id: partnership.current_revision!.id,
            person1_ref: partnership.person1_id,
            person2_ref: partnership.person2_id,
            partnership_type: partnership.current_revision!.partnership_type,
            ...mappedDate(fields.marriage, partnership.current_revision),
            status_text: partnership.current_revision!.status_text ?? '',
        })] } : {}),
        ...extras(fields, personId),
    };
}

export function partnershipEndpointsInFamily(graph: FamilyGraph, partnershipId: string, familyId: string): boolean {
    const partnership = graph.partnerships.find(candidate => candidate.id === partnershipId && candidate.current_revision);
    if (!partnership) return false;
    return [partnership.person1_id, partnership.person2_id].every(personId => graph.memberships.some(membership =>
        membership.family_id === familyId && membership.person_id === personId && membership.current_revision));
}

export function mapSpouseEdit(
    graph: FamilyGraph,
    selectedPersonId: string,
    fields: PersonFields,
    partnershipDate: string,
    id: IdFactory = crypto.randomUUID.bind(crypto),
): FamilyEditBundle {
    currentPerson(graph, selectedPersonId);
    const spouseRef = id();
    return {
        people: [newPerson(spouseRef, fields)],
        events: events(graph, spouseRef, fields, id),
        memberships: [{ ref: id(), person_ref: spouseRef }],
        partnerships: [compact({
            ref: id(),
            person1_ref: selectedPersonId,
            person2_ref: spouseRef,
            partnership_type: 'marriage' as const,
            ...mappedDate(partnershipDate),
        })],
        ...extras(fields, spouseRef),
    };
}

export function mapChildEdit(
    graph: FamilyGraph,
    selectedParentId: string,
    child: PersonFields,
    secondParent: { personId?: string; fields?: PersonFields },
    targetFamilyId?: string,
    id: IdFactory = crypto.randomUUID.bind(crypto),
): FamilyEditBundle {
    currentPerson(graph, selectedParentId);
    const childRef = id();
    const secondRef = secondParent.personId ?? (secondParent.fields ? id() : undefined);
    if (secondParent.personId) currentPerson(graph, secondParent.personId);
    const people = [newPerson(childRef, child)];
    const memberships = [{ ref: id(), person_ref: childRef }];
    if (secondRef && secondParent.fields) {
        people.push(newPerson(secondRef, secondParent.fields));
        memberships.push({ ref: id(), person_ref: secondRef });
    } else if (secondRef && targetFamilyId && !graph.memberships.some(membership =>
        membership.family_id === targetFamilyId && membership.person_id === secondRef && membership.current_revision)) {
        memberships.push({ ref: id(), person_ref: secondRef });
    }
    return {
        people,
        events: [
            ...events(graph, childRef, child, id),
            ...(secondRef && secondParent.fields ? events(graph, secondRef, secondParent.fields, id) : []),
        ],
        memberships,
        parent_links: [selectedParentId, secondRef].filter(Boolean).map(parentRef => ({
            ref: id(),
            parent_ref: parentRef!,
            child_ref: childRef,
            relationship_type: 'biological' as const,
        })),
        ...extras(child, childRef),
    };
}

const ACTOR_SECRET_KEY = 'soyagaci_anonymous_actor_secret';

export function getAnonymousActorSecret(storage: Storage = localStorage): string {
    const existing = storage.getItem(ACTOR_SECRET_KEY);
    if (existing) return existing;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    storage.setItem(ACTOR_SECRET_KEY, secret);
    return secret;
}

export class FamilyEditSubmitter {
    private attempt?: { familyId: string; fingerprint: string; requestId: string };
    private inFlight?: Promise<SubmissionResult>;

    constructor(private readonly submit = submitFamilyEdit) {}

    invalidate() {
        this.attempt = undefined;
    }

    send(familyId: string, bundle: FamilyEditBundle): Promise<SubmissionResult> {
        if (this.inFlight) return this.inFlight;
        const fingerprint = JSON.stringify(bundle);
        if (!this.attempt || this.attempt.familyId !== familyId || this.attempt.fingerprint !== fingerprint) {
            this.attempt = { familyId, fingerprint, requestId: crypto.randomUUID() };
        }
        const attempt = this.attempt;
        this.inFlight = this.submit(familyId, attempt.requestId, bundle, getAnonymousActorSecret())
            .then(result => {
                this.attempt = undefined;
                return result;
            })
            .finally(() => { this.inFlight = undefined; });
        return this.inFlight;
    }
}

export class FamilyEditAttempt {
    private familyId?: string;
    private bundle?: FamilyEditBundle;

    constructor(private readonly submitter: FamilyEditSubmitter) {}

    invalidate() {
        this.familyId = undefined;
        this.bundle = undefined;
        this.submitter.invalidate();
    }

    send(familyId: string, map: () => FamilyEditBundle): Promise<SubmissionResult> {
        if (!this.bundle || this.familyId !== familyId) {
            this.familyId = familyId;
            this.bundle = map();
        }
        return this.submitter.send(familyId, this.bundle).then(result => {
            this.familyId = undefined;
            this.bundle = undefined;
            return result;
        });
    }
}

export class FamilyCreationSubmitter {
    private attempt?: { fingerprint: string; requestId: string };
    private inFlight?: Promise<SubmissionResult>;

    constructor(private readonly submit = submitFamilyCreation) {}

    invalidate() {
        this.attempt = undefined;
    }

    send(input: FamilyCreationInput): Promise<SubmissionResult> {
        if (this.inFlight) return this.inFlight;
        const fingerprint = JSON.stringify(input);
        if (!this.attempt || this.attempt.fingerprint !== fingerprint) {
            this.attempt = { fingerprint, requestId: crypto.randomUUID() };
        }
        const attempt = this.attempt;
        this.inFlight = this.submit(input, attempt.requestId, getAnonymousActorSecret())
            .then(result => { this.attempt = undefined; return result; })
            .finally(() => { this.inFlight = undefined; });
        return this.inFlight;
    }
}
