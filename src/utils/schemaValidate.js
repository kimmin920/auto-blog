function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function validateNode(value, schema, path, issues) {
  const schemaType = typeOf(schema);

  if (schemaType === "string") {
    if (typeOf(value) !== schema) {
      issues.push(`${path} expected ${schema}, got ${typeOf(value)}`);
    }
    return;
  }

  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) {
      issues.push(`${path} expected array, got ${typeOf(value)}`);
      return;
    }
    if (schema.length > 0) {
      for (let i = 0; i < value.length; i += 1) {
        validateNode(value[i], schema[0], `${path}[${i}]`, issues);
      }
    }
    return;
  }

  if (schema && typeof schema === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      issues.push(`${path} expected object, got ${typeOf(value)}`);
      return;
    }

    for (const key of Object.keys(schema)) {
      if (!(key in value)) {
        issues.push(`${path}.${key} is required`);
        continue;
      }
      validateNode(value[key], schema[key], `${path}.${key}`, issues);
    }
  }
}

export function validateAgainstSchema(value, schema, root = "json") {
  const issues = [];
  validateNode(value, schema, root, issues);
  return { ok: issues.length === 0, issues };
}
