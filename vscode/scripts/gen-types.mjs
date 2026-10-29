// Generates src/core/protocol.gen.ts from ../protocol/schema.json, which
// `go generate ./internal/protocol` writes from the Go types.
import { writeFileSync } from 'node:fs';
import { compileFromFile } from 'json-schema-to-typescript';

const banner = '// Generated from protocol/schema.json by scripts/gen-types.mjs. Do not edit.';
const types = await compileFromFile('../protocol/schema.json', {
  bannerComment: banner,
  unreachableDefinitions: true,
  additionalProperties: false,
  cwd: '..',
});
writeFileSync('src/core/protocol.gen.ts', types);
