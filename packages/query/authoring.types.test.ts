import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import * as query from './mod.ts';

/** Compile realistic query authoring while preserving fields, allowed operators, and transformed inputs. */
function authorTypes(): void {
	const Score = codec.define({
		decode: schema.transform(schema.string(), Number),
		encode: schema.transform(schema.number(), String),
	});
	const Search = query.define({
		fields: { name: query.field(schema.string()), score: query.field(schema.number()), converted: query.field(Score) },
		filters: { name: [query.eq, query.in, query.isNull], score: [query.gte, query.between], converted: [query.eq] },
		expressions: ['all', 'any', 'not'],
		pagination: query.offset(),
	});
	void Search.create({
		filter: query.any(Search.condition('name', 'eq', 'Ada'), Search.condition('score', 'gte', 90)),
	});
	void Search.create({ filter: Search.condition('score', 'between', [10, 20]) });
	void Search.create({ filter: Search.condition('name', 'in', ['Ada', 'Lin']) });
	void Search.create({ filter: Search.condition('name', 'isNull') });
	void Search.create({ filter: Search.condition('converted', 'eq', '12') });
	const result: Promise<query.QueryValue<typeof Search.fields>> = Search.create();
	void result;
	// @ts-expect-error A condition field must exist in this definition.
	Search.condition('missing', 'eq', 'Ada');
	// @ts-expect-error score permits gte and between, not eq.
	Search.condition('score', 'eq', 10);
	// @ts-expect-error The numeric field's authored operand remains numeric.
	Search.condition('score', 'gte', '10');
	// @ts-expect-error Ranges require exactly two operands.
	Search.condition('score', 'between', [10]);
	// @ts-expect-error Membership requires a nonempty list.
	Search.condition('name', 'in', []);
	// @ts-expect-error Null checks have no operand argument.
	Search.condition('name', 'isNull', null);
	// @ts-expect-error A transformed field's authored input is the codec decode input.
	Search.condition('converted', 'eq', 12);
	// @ts-expect-error The structural create path also restricts operators.
	void Search.create({ filter: { field: 'score', operator: 'eq', value: 10 } });
	// @ts-expect-error Nonempty Boolean groups avoid vacuous conditions.
	query.all();
}

void authorTypes;
