/** HTTP date parsing is private protocol policy, shared by conditions and retry planning. @module */
const Months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const Days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LongDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Accept all three RFC 9110 date grammars without accepting native Date.parse's extra wire formats. */
export function date(value: string | null | undefined, now: number): number | undefined {
	if (value == null || value.length > 40) return undefined;
	let match = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(
		value,
	);
	let weekday: number;
	let year: number;
	let day: number;
	let month: number;
	let hour: number;
	let minute: number;
	let second: number;
	let obsolete = false;
	if (match) {
		weekday = Days.indexOf(match[1]!);
		day = Number(match[2]);
		month = Months.indexOf(match[3]!);
		year = Number(match[4]);
		hour = Number(match[5]);
		minute = Number(match[6]);
		second = Number(match[7]);
	} else {
		match =
			/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/
				.exec(value);
		if (match) {
			weekday = LongDays.indexOf(match[1]!);
			day = Number(match[2]);
			month = Months.indexOf(match[3]!);
			year = Math.floor(new Date(now).getUTCFullYear() / 100) * 100 + Number(match[4]);
			obsolete = true;
			hour = Number(match[5]);
			minute = Number(match[6]);
			second = Number(match[7]);
		} else {
			match = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) ([A-Z][a-z]{2}) (\d{2}| \d) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(value);
			if (!match) return undefined;
			weekday = Days.indexOf(match[1]!);
			month = Months.indexOf(match[2]!);
			day = Number(match[3]);
			year = Number(match[7]);
			hour = Number(match[4]);
			minute = Number(match[5]);
			second = Number(match[6]);
		}
	}
	if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return undefined;
	// Native Date normalizes impossible dates. Build then compare every calendar
	// component below so February 31 cannot silently become a March timestamp.
	const parsed = new Date(0);
	parsed.setUTCFullYear(year, month, day);
	parsed.setUTCHours(hour, minute, Math.min(second, 59), 0);
	// Obsolete two-digit years are interpreted against the caller's clock,
	// moving a date more than 50 years ahead into the previous century.
	if (obsolete) {
		const horizon = new Date(now);
		horizon.setUTCFullYear(horizon.getUTCFullYear() + 50);
		if (parsed.getTime() > horizon.getTime()) {
			year -= 100;
			parsed.setUTCFullYear(year);
		}
	}
	if (
		parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month || parsed.getUTCDate() !== day ||
		parsed.getUTCDay() !== weekday
	) return undefined;
	// ECMAScript epoch time cannot represent a distinct leap second; map :60 to the following epoch second.
	return parsed.getTime() + (second === 60 ? 1000 : 0);
}
