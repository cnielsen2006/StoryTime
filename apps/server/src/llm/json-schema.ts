import { z } from 'zod';

/**
 * Minimal Zod v3 to JSON Schema converter.
 *
 * Only covers the shapes used by our structured outputs: objects, arrays,
 * strings, numbers, booleans, enums, optionals, nullables, and descriptions.
 * The Anthropic and OpenAI SDKs ship their own converters; this exists for
 * Ollama, whose `format` field takes a plain JSON Schema.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convert(schema);
}

function withDescription(node: Record<string, unknown>, schema: z.ZodTypeAny): Record<string, unknown> {
  const description = schema.description;
  return description ? { ...node, description } : node;
}

function convert(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def as { typeName?: string } & Record<string, unknown>;

  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodString:
      return withDescription({ type: 'string' }, schema);

    case z.ZodFirstPartyTypeKind.ZodNumber:
      return withDescription({ type: 'number' }, schema);

    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return withDescription({ type: 'boolean' }, schema);

    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return withDescription({ const: (def as { value: unknown }).value }, schema);

    case z.ZodFirstPartyTypeKind.ZodEnum:
      return withDescription({ type: 'string', enum: [...((def as { values: string[] }).values ?? [])] }, schema);

    case z.ZodFirstPartyTypeKind.ZodArray:
      return withDescription({ type: 'array', items: convert((def as { type: z.ZodTypeAny }).type) }, schema);

    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        const field = value as z.ZodTypeAny;
        properties[key] = convert(field);
        if (!field.isOptional()) required.push(key);
      }
      return withDescription(
        { type: 'object', properties, required, additionalProperties: false },
        schema,
      );
    }

    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodDefault:
      return convert((def as { innerType: z.ZodTypeAny }).innerType);

    case z.ZodFirstPartyTypeKind.ZodNullable: {
      const inner = convert((def as { innerType: z.ZodTypeAny }).innerType);
      const innerType = inner.type;
      return withDescription(
        { ...inner, type: Array.isArray(innerType) ? [...innerType, 'null'] : [innerType, 'null'] },
        schema,
      );
    }

    case z.ZodFirstPartyTypeKind.ZodEffects:
      return convert((def as { schema: z.ZodTypeAny }).schema);

    case z.ZodFirstPartyTypeKind.ZodUnion: {
      const options = (def as { options: z.ZodTypeAny[] }).options ?? [];
      return withDescription({ anyOf: options.map(convert) }, schema);
    }

    case z.ZodFirstPartyTypeKind.ZodRecord:
      return withDescription({ type: 'object', additionalProperties: true }, schema);

    default:
      // Anything unmodelled becomes a permissive node rather than failing a run.
      return {};
  }
}
