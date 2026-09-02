import * as workflow from './mod.ts';

type ActivityOptions = NonNullable<Parameters<typeof workflow.activity>[2]>;

const affinity: ActivityOptions = { affinity: { region: 'east', capacity: 2, gpu: false } };
void affinity;

// @ts-expect-error activity affinity fields are scalar placement facts, not nested objects.
const invalidAffinity: ActivityOptions = { affinity: { region: { name: 'east' } } };
void invalidAffinity;
