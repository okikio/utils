import { it } from 'node:test';
import { expect } from '@std/expect';
import { attachmentDisposition } from './filename.ts';

it('retains ordinary attachment names and safely quotes untrusted names', () => {
	expect(attachmentDisposition('Source.csv')).toBe('attachment; filename="Source.csv"');
	expect(attachmentDisposition('folder/source"\r\n.csv')).toBe('attachment; filename="source\\".csv"');
	expect(new Headers({ 'content-disposition': attachmentDisposition('..\\équipe 😀.csv') }).get('content-disposition'))
		.toBe('attachment; filename="_quipe _.csv"; filename*=UTF-8\'\'%C3%A9quipe%20%F0%9F%98%80.csv');
	expect(attachmentDisposition('..')).toBe('attachment; filename="download"');
});
