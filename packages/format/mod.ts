/**
 * Read and write CSV records or sitemap entries while keeping source ownership explicit.
 *
 * The csv subpath owns delimiters, quoting, encoding, and record framing. The sitemap subpath reads
 * sitemap XML and sitemap indexes. Both use Streams for reader cancellation and cleanup; neither chooses
 * where an application saves the parsed records.
 *
 * @module
 */
export * as csv from './csv/mod.ts';
export * as sitemap from './sitemap/mod.ts';
