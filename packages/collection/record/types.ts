/** One statically known entry of a record type. Runtime enumeration may include additional keys and does not return this type. */
export type Entry<RecordType extends Readonly<Record<string, unknown>>> = {
	readonly [Key in Extract<keyof RecordType, string>]: readonly [Key, RecordType[Key]];
}[Extract<keyof RecordType, string>];
