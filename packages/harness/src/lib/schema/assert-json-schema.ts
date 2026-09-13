import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
const schemaAjv = new Ajv2020({ allErrors: true, strict: true });
addFormats(schemaAjv);

export function compileJsonSchema(schema: object): ValidateFunction {
  return schemaAjv.compile(schema);
}

export function schemaErrorsText(validate: ValidateFunction): string {
  return schemaAjv.errorsText(validate.errors, { separator: '; ' });
}

export function assertMatchesSchema(
  label: string,
  validate: ValidateFunction,
  value: unknown,
): void {
  if (!validate(value)) {
    throw new Error(`Invalid ${label}: ${schemaErrorsText(validate)}`);
  }
}
