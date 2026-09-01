/** One exact string-keyed entry from a validated data record. */
export type Entry<RecordType extends Readonly<Record<string, unknown>>> = {
	readonly [Key in Extract<keyof RecordType, string>]: readonly [Key, RecordType[Key]];
}[Extract<keyof RecordType, string>];
