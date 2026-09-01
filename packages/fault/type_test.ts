import * as fault from './mod.ts';

const encoded: fault.FaultValue = fault.encode(new Error('boom'));
const options: fault.Options = { maximumDepth: 4, maximumEntries: 16 };

void encoded;
void options;

// @ts-expect-error operational limits are numeric, not strings.
fault.encode('boom', { maximumDepth: '4' });
