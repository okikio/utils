/** Native child deliberately runs without read/net grants; inspection must neither request nor acquire them. */
import { inspect } from '../inspect.ts';
const result = await inspect([{ name: 'read' }, { name: 'net' }, { name: 'env' }], { maximumQueries: 3 });
console.log(JSON.stringify(result.permissions.map((entry) => entry.state)));
