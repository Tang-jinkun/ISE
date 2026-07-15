import Ajv2020Module from 'ajv/dist/2020.js';

const ajv = new Ajv2020Module.default({ strict: false, validateFormats: false });

export function compileJsonSchema(schema: object) {
  return ajv.compile(schema);
}
